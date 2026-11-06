-- Tweaklr: add reply privacy choices to the established Business Space comment RPC.
-- Apply after 20261106050000_business_comment_reply_rpc_compatibility.sql.
-- This preserves the existing RPC signature and avoids adding a new PostgREST endpoint.
begin;

create or replace function public.add_ming_business_space_post_comment_v2(
  p_content_id uuid,
  p_text text default '',
  p_anonymous boolean default false,
  p_private_to_author boolean default false,
  p_voice_path text default null,
  p_voice_duration integer default null,
  p_voice_view_once boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space_id uuid;
  v_post_author uuid;
  v_comment public.ming_comments;
  v_parent public.ming_comments;
  v_profile public.profiles;
  v_visibility text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if char_length(btrim(coalesce(p_text, ''))) > 1000 then
    raise exception 'Comment must be 1000 characters or fewer';
  end if;

  if char_length(btrim(coalesce(p_text, ''))) = 0 and p_voice_path is null then
    raise exception 'Write a comment or attach a voice note';
  end if;

  if coalesce(p_anonymous, false) and coalesce(p_private_to_author, false) then
    raise exception 'Choose one comment privacy category';
  end if;

  if p_voice_duration is not null and p_voice_duration not between 1 and 120 then
    raise exception 'Voice notes must be 1–120 seconds';
  end if;

  if p_voice_path is not null
     and (p_voice_path ~ '/' or p_voice_path !~ '^[a-zA-Z0-9._-]+$') then
    raise exception 'Invalid voice note file path';
  end if;

  if coalesce(p_voice_view_once, false) and p_voice_path is null then
    raise exception 'View once is available for voice notes only';
  end if;

  -- Normal path: p_content_id is the Business Space post ID.
  select p.space_id, p.author_id
    into v_space_id, v_post_author
  from public.ming_space_content p
  join public.ming_spaces s
    on s.id = p.space_id
   and s.nature = 'business'
  where p.id = p_content_id
    and p.kind = 'business_post'
  for update of p;

  -- Reply path: the same established RPC receives the parent comment ID.
  -- This preserves the original RPC endpoint and its PostgREST cache entry.
  if not found then
    if p_voice_path is not null or coalesce(p_voice_view_once, false) then
      raise exception 'Replies are text-only';
    end if;

    select c.*
      into v_parent
    from public.ming_comments c
    join public.ming_space_content p
      on p.id = c.target_id
     and p.kind = 'business_post'
    join public.ming_spaces s
      on s.id = c.space_id
     and s.nature = 'business'
    join public.ming_space_members m
      on m.space_id = c.space_id
     and m.user_id = v_user
     and m.approved = true
    where c.id = p_content_id
      and c.target_type = 'space_content'
      and c.parent_comment_id is null
      and (
        c.visibility <> 'private_to_post_author'
        or c.author_id = v_user
        or p.author_id = v_user
      )
    for update of c;

    if not found then
      raise exception 'Business post or parent comment not found, or unavailable';
    end if;

    -- A reply cannot widen a private parent thread to the whole Space.
    -- Otherwise its selected privacy category is applied independently.
    v_visibility := case
      when v_parent.visibility = 'private_to_post_author' then 'private_to_post_author'
      when coalesce(p_private_to_author, false) then 'private_to_post_author'
      when coalesce(p_anonymous, false) then 'anonymous'
      else 'everyone'
    end;

    insert into public.ming_comments (
      target_type, target_id, space_id, parent_comment_id,
      author_id, body, visibility
    )
    values (
      'space_content', v_parent.target_id, v_parent.space_id, v_parent.id,
      v_user, btrim(p_text), v_visibility
    )
    returning * into v_comment;

    select * into v_profile
    from public.profiles
    where id = v_user;

    return jsonb_build_object(
      'id', v_comment.id,
      'parent_comment_id', v_comment.parent_comment_id,
      'is_mine', true,
      'body', v_comment.body,
      'anonymous', v_comment.visibility = 'anonymous',
      'private_to_author', v_comment.visibility = 'private_to_post_author',
      'voice_path', null,
      'voice_duration', null,
      'voice_view_once', false,
      'voice_viewed', false,
      'created_at_ms', floor(extract(epoch from v_comment.created_at) * 1000)::bigint,
      'author_display_name',
        case when v_comment.visibility = 'anonymous' then null
             else coalesce(v_profile.display_name, v_profile.username, 'Space member') end,
      'author_username',
        case when v_comment.visibility = 'anonymous' then null else v_profile.username end,
      'author_avatar_url',
        case when v_comment.visibility = 'anonymous' then null else v_profile.avatar_url end
    );
  end if;

  if not exists (
    select 1
    from public.ming_space_members m
    where m.space_id = v_space_id
      and m.user_id = v_user
      and m.approved = true
  ) then
    raise exception 'Approved Business Space membership required';
  end if;

  if p_voice_path is not null and not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'ming-business-comment-voice'
      and o.name = p_voice_path
      and o.owner_id = v_user::text
  ) then
    raise exception 'Voice note upload was not found';
  end if;

  v_visibility := case
    when coalesce(p_private_to_author, false) then 'private_to_post_author'
    when coalesce(p_anonymous, false) then 'anonymous'
    else 'everyone'
  end;

  insert into public.ming_comments (
    target_type, target_id, space_id, author_id, body, visibility,
    voice_path, voice_duration, voice_view_once
  )
  values (
    'space_content', p_content_id, v_space_id, v_user,
    btrim(coalesce(p_text, '')), v_visibility,
    p_voice_path, p_voice_duration, coalesce(p_voice_view_once, false)
  )
  returning * into v_comment;

  select * into v_profile
  from public.profiles
  where id = v_user;

  return jsonb_build_object(
    'id', v_comment.id,
    'body', v_comment.body,
    'anonymous', v_comment.visibility = 'anonymous',
    'private_to_author', v_comment.visibility = 'private_to_post_author',
    'voice_path', v_comment.voice_path,
    'voice_duration', v_comment.voice_duration,
    'voice_view_once', v_comment.voice_view_once,
    'voice_viewed', false,
    'created_at_ms', floor(extract(epoch from v_comment.created_at) * 1000)::bigint,
    'author_display_name',
      case when v_comment.visibility = 'anonymous' then null
           else coalesce(v_profile.display_name, v_profile.username, 'Space member') end,
    'author_username',
      case when v_comment.visibility = 'anonymous' then null else v_profile.username end,
    'author_avatar_url',
      case when v_comment.visibility = 'anonymous' then null else v_profile.avatar_url end
  );
end;
$function$;

notify pgrst, 'reload schema';
commit;
