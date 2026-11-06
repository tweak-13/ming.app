-- Tweaklr Friendship comments: reuse the full Business comment model safely.
-- Adds Friendship-only RPCs over ming_comments; existing Business RPCs are untouched.
begin;

create or replace function public.get_ming_friendship_space_post_comments(p_content_id uuid)
returns setof jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'id', c.id,
    'parent_comment_id', c.parent_comment_id,
    'is_mine', c.author_id = (select auth.uid()),
    'body', c.body,
    'anonymous', c.visibility = 'anonymous',
    'private_to_author', c.visibility = 'private_to_post_author',
    'voice_path', c.voice_path,
    'voice_duration', c.voice_duration,
    'voice_view_once', c.voice_view_once,
    'voice_viewed', (select auth.uid()) = any(coalesce(c.voice_viewed_by, '{}'::uuid[])),
    'created_at_ms', floor(extract(epoch from c.created_at) * 1000)::bigint,
    'author_display_name', case when c.visibility = 'anonymous' then null else coalesce(pr.display_name, pr.username, 'Space member') end,
    'author_username', case when c.visibility = 'anonymous' then null else pr.username end,
    'author_avatar_url', case when c.visibility = 'anonymous' then null else pr.avatar_url end
  )
  from public.ming_comments c
  join public.ming_space_content p on p.id = c.target_id and p.kind = 'friend_post'
  join public.ming_spaces s on s.id = c.space_id and s.nature = 'friendly'
  join public.ming_space_members m on m.space_id = c.space_id and m.user_id = (select auth.uid()) and m.approved = true
  left join public.profiles pr on pr.id = c.author_id
  where c.target_type = 'space_content'
    and c.target_id = p_content_id
    and (c.visibility <> 'private_to_post_author' or c.author_id = (select auth.uid()) or p.author_id = (select auth.uid()))
  order by c.created_at asc;
$function$;

create or replace function public.add_ming_friendship_space_post_comment_v2(
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
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_text, ''))) > 1000 then raise exception 'Comment must be 1000 characters or fewer'; end if;
  if char_length(btrim(coalesce(p_text, ''))) = 0 and p_voice_path is null then raise exception 'Write a comment or attach a voice note'; end if;
  if coalesce(p_anonymous, false) and coalesce(p_private_to_author, false) then raise exception 'Choose one comment privacy category'; end if;
  if p_voice_duration is not null and p_voice_duration not between 1 and 120 then raise exception 'Voice notes must be 1–120 seconds'; end if;
  if p_voice_path is not null and (p_voice_path ~ '/' or p_voice_path !~ '^[a-zA-Z0-9._-]+$') then raise exception 'Invalid voice note file path'; end if;
  if coalesce(p_voice_view_once, false) and p_voice_path is null then raise exception 'View once is available for voice notes only'; end if;

  -- A post ID creates a top-level comment; a top-level comment ID creates its reply.
  select p.space_id, p.author_id into v_space_id, v_post_author
  from public.ming_space_content p
  join public.ming_spaces s on s.id = p.space_id and s.nature = 'friendly'
  where p.id = p_content_id and p.kind = 'friend_post'
  for update of p;

  if not found then
    if p_voice_path is not null or coalesce(p_voice_view_once, false) then raise exception 'Replies are text-only'; end if;
    select c.* into v_parent
    from public.ming_comments c
    join public.ming_space_content p on p.id = c.target_id and p.kind = 'friend_post'
    join public.ming_spaces s on s.id = c.space_id and s.nature = 'friendly'
    join public.ming_space_members m on m.space_id = c.space_id and m.user_id = v_user and m.approved = true
    where c.id = p_content_id and c.target_type = 'space_content' and c.parent_comment_id is null
      and (c.visibility <> 'private_to_post_author' or c.author_id = v_user or p.author_id = v_user)
    for update of c;
    if not found then raise exception 'Friendship post or parent comment not found, or unavailable'; end if;

    v_visibility := case
      when v_parent.visibility = 'private_to_post_author' then 'private_to_post_author'
      when coalesce(p_private_to_author, false) then 'private_to_post_author'
      when coalesce(p_anonymous, false) then 'anonymous'
      else 'everyone'
    end;
    insert into public.ming_comments(target_type,target_id,space_id,parent_comment_id,author_id,body,visibility)
    values ('space_content',v_parent.target_id,v_parent.space_id,v_parent.id,v_user,btrim(p_text),v_visibility)
    returning * into v_comment;
  else
    if not exists (select 1 from public.ming_space_members m where m.space_id=v_space_id and m.user_id=v_user and m.approved=true) then
      raise exception 'Approved Friendship Space membership required';
    end if;
    if p_voice_path is not null and not exists (
      select 1 from storage.objects o
      where o.bucket_id='ming-business-comment-voice' and o.name=p_voice_path and o.owner_id=v_user::text
    ) then raise exception 'Voice note upload was not found'; end if;
    v_visibility := case when coalesce(p_private_to_author,false) then 'private_to_post_author' when coalesce(p_anonymous,false) then 'anonymous' else 'everyone' end;
    insert into public.ming_comments(target_type,target_id,space_id,author_id,body,visibility,voice_path,voice_duration,voice_view_once)
    values ('space_content',p_content_id,v_space_id,v_user,btrim(coalesce(p_text,'')),v_visibility,p_voice_path,p_voice_duration,coalesce(p_voice_view_once,false))
    returning * into v_comment;
  end if;

  select * into v_profile from public.profiles where id=v_user;
  return jsonb_build_object(
    'id',v_comment.id,'parent_comment_id',v_comment.parent_comment_id,'is_mine',true,
    'body',v_comment.body,'anonymous',v_comment.visibility='anonymous',
    'private_to_author',v_comment.visibility='private_to_post_author',
    'voice_path',v_comment.voice_path,'voice_duration',v_comment.voice_duration,
    'voice_view_once',v_comment.voice_view_once,'voice_viewed',false,
    'created_at_ms',floor(extract(epoch from v_comment.created_at)*1000)::bigint,
    'author_display_name',case when v_comment.visibility='anonymous' then null else coalesce(v_profile.display_name,v_profile.username,'Space member') end,
    'author_username',case when v_comment.visibility='anonymous' then null else v_profile.username end,
    'author_avatar_url',case when v_comment.visibility='anonymous' then null else v_profile.avatar_url end
  );
end;
$function$;

create or replace function public.claim_ming_friendship_space_comment_voice_once(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_author uuid;
  v_view_once boolean;
  v_viewed_by uuid[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.author_id,c.voice_view_once,c.voice_viewed_by into v_author,v_view_once,v_viewed_by
  from public.ming_comments c
  join public.ming_space_content p on p.id=c.target_id and p.kind='friend_post'
  join public.ming_spaces s on s.id=c.space_id and s.nature='friendly'
  join public.ming_space_members m on m.space_id=c.space_id and m.user_id=v_user and m.approved=true
  where c.id=p_comment_id and c.target_type='space_content'
    and (c.visibility <> 'private_to_post_author' or c.author_id=v_user or p.author_id=v_user)
    and c.voice_path is not null
  for update of c;
  if not found then raise exception 'Voice note is not available to you'; end if;
  if not v_view_once or v_author=v_user then return true; end if;
  if v_user=any(coalesce(v_viewed_by,'{}'::uuid[])) then return false; end if;
  update public.ming_comments set voice_viewed_by=array_append(coalesce(voice_viewed_by,'{}'::uuid[]),v_user),updated_at=now() where id=p_comment_id;
  return true;
end;
$function$;

create or replace function public.delete_ming_friendship_space_post_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space_id uuid;
  v_author uuid;
  v_post_author uuid;
  v_paths text[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.space_id,c.author_id,p.author_id into v_space_id,v_author,v_post_author
  from public.ming_comments c
  join public.ming_space_content p on p.id=c.target_id and p.kind='friend_post'
  join public.ming_spaces s on s.id=c.space_id and s.nature='friendly'
  join public.ming_space_members m on m.space_id=c.space_id and m.user_id=v_user and m.approved=true
  where c.id=p_comment_id and c.target_type='space_content' and c.parent_comment_id is null;
  if not found then raise exception 'Comment not found or unavailable'; end if;
  if v_user <> v_author and v_user <> v_post_author then raise exception 'Only the comment author or post author can delete this comment'; end if;
  select array_agg(x.voice_path) into v_paths from public.ming_comments x
  where x.id=p_comment_id or x.parent_comment_id=p_comment_id;
  delete from public.ming_comments where id=p_comment_id or parent_comment_id=p_comment_id;
  return jsonb_build_object('voice_paths',coalesce(v_paths,'{}'::text[]));
end;
$function$;

-- Permit the same private voice bucket to serve Business and Friendship comments.
create or replace function public.can_read_ming_business_comment_voice(p_voice_path text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $function$
  select exists (
    select 1
    from public.ming_comments c
    join public.ming_space_content p on p.id=c.target_id and p.space_id=c.space_id
      and ((p.kind='business_post' and exists(select 1 from public.ming_spaces sb where sb.id=c.space_id and sb.nature='business'))
        or (p.kind='friend_post' and exists(select 1 from public.ming_spaces sf where sf.id=c.space_id and sf.nature='friendly')))
    join public.ming_space_members m on m.space_id=c.space_id and m.user_id=(select auth.uid()) and m.approved=true
    where c.target_type='space_content' and c.voice_path=p_voice_path
      and (c.visibility <> 'private_to_post_author' or c.author_id=(select auth.uid()) or p.author_id=(select auth.uid()))
  );
$function$;

revoke all on function public.get_ming_friendship_space_post_comments(uuid) from public,anon;
revoke all on function public.add_ming_friendship_space_post_comment_v2(uuid,text,boolean,boolean,text,integer,boolean) from public,anon;
revoke all on function public.claim_ming_friendship_space_comment_voice_once(uuid) from public,anon;
revoke all on function public.delete_ming_friendship_space_post_comment(uuid) from public,anon;
revoke all on function public.can_read_ming_business_comment_voice(text) from public,anon;
grant execute on function public.get_ming_friendship_space_post_comments(uuid) to authenticated;
grant execute on function public.add_ming_friendship_space_post_comment_v2(uuid,text,boolean,boolean,text,integer,boolean) to authenticated;
grant execute on function public.claim_ming_friendship_space_comment_voice_once(uuid) to authenticated;
grant execute on function public.delete_ming_friendship_space_post_comment(uuid) to authenticated;
grant execute on function public.can_read_ming_business_comment_voice(text) to authenticated;

notify pgrst,'reload schema';
commit;
