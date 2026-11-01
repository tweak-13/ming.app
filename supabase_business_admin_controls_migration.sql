-- Business Space admin controls: member removal and post moderation.
-- Safe to re-run. All authority checks happen inside SECURITY DEFINER RPCs.

create or replace function public.remove_ming_business_space_member(
  p_space_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_space_id is null or p_user_id is null then raise exception 'Space and member are required'; end if;

  select m.role into v_actor_role
  from public.ming_space_members m
  join public.ming_spaces s on s.id = m.space_id
  where m.space_id = p_space_id and m.user_id = v_actor
    and m.approved = true and s.nature = 'business';

  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Only the creator or an admin can remove members';
  end if;

  select role into v_target_role
  from public.ming_space_members
  where space_id = p_space_id and user_id = p_user_id;

  if v_target_role is null then raise exception 'Member not found'; end if;
  if v_target_role = 'owner' then raise exception 'The Space creator cannot be removed'; end if;
  if v_target_role = 'admin' and v_actor_role <> 'owner' then
    raise exception 'Only the creator can remove another admin';
  end if;
  if p_user_id = v_actor then raise exception 'Use Leave Space to remove yourself'; end if;

  delete from public.ming_space_members
  where space_id = p_space_id and user_id = p_user_id;

  return jsonb_build_object('ok', true, 'removed_user_id', p_user_id);
end;
$function$;

create or replace function public.delete_ming_business_space_post(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_space_id uuid;
  v_author_id uuid;
  v_role text;
  v_kind text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select c.space_id, c.author_id, c.kind into v_space_id, v_author_id, v_kind
  from public.ming_space_content c
  where c.id = p_content_id;

  if v_space_id is null then raise exception 'Post not found'; end if;
  if v_kind <> 'business_post' then raise exception 'Only Business Home posts can be moderated here'; end if;

  select m.role into v_role
  from public.ming_space_members m
  join public.ming_spaces s on s.id = m.space_id
  where m.space_id = v_space_id and m.user_id = v_actor
    and m.approved = true and s.nature = 'business';

  if v_role is null then raise exception 'Approved Business Space membership required'; end if;
  if v_actor <> v_author_id and v_role not in ('owner','admin','manager') then
    raise exception 'Only the post author, creator, or an admin can remove this post';
  end if;

  delete from public.ming_space_content where id = p_content_id;
  return jsonb_build_object('ok', true, 'deleted_id', p_content_id);
end;
$function$;

revoke all on function public.remove_ming_business_space_member(uuid, uuid) from public, anon;
revoke all on function public.delete_ming_business_space_post(uuid) from public, anon;
grant execute on function public.remove_ming_business_space_member(uuid, uuid) to authenticated;
grant execute on function public.delete_ming_business_space_post(uuid) to authenticated;

-- Enforce the selected Home-feed publishing rule at the database boundary,
-- including requests that bypass the browser UI.
create or replace function public.enforce_ming_business_post_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nature text;
  v_features jsonb;
  v_role text;
begin
  if new.kind <> 'business_post' then return new; end if;

  select s.nature, s.features into v_nature, v_features
  from public.ming_spaces s where s.id = new.space_id;
  if v_nature <> 'business' then
    raise exception 'Business Home posts are only available in Business Spaces';
  end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = new.space_id and m.user_id = auth.uid() and m.approved = true;
  if v_role is null then raise exception 'Approved Business Space membership required'; end if;

  if coalesce(v_features->>'businessMessaging', 'everyone') = 'owner'
     and v_role <> 'owner' then
    raise exception 'Only the creator can publish in this Business Space';
  end if;
  return new;
end;
$function$;

drop trigger if exists ming_business_post_policy_guard on public.ming_space_content;
create trigger ming_business_post_policy_guard
before insert on public.ming_space_content
for each row execute function public.enforce_ming_business_post_policy();

revoke all on function public.enforce_ming_business_post_policy() from public, anon, authenticated;

-- Any approved Business Space member may comment on a Home post, even when
-- the original post belongs to somebody else. Comments are appended atomically.
create or replace function public.add_ming_business_space_post_comment(
  p_content_id uuid,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_kind text;
  v_comments jsonb;
  v_comment jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 1000 then
    raise exception 'Comment must be between 1 and 1000 characters';
  end if;

  select c.space_id, c.kind, coalesce(c.payload->'comments','[]'::jsonb)
    into v_space_id, v_kind, v_comments
  from public.ming_space_content c
  where c.id = p_content_id
  for update;

  if v_space_id is null or v_kind <> 'business_post' then raise exception 'Business post not found'; end if;
  if not exists (
    select 1 from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=v_space_id and s.nature='business'
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Business Space membership required'; end if;
  if jsonb_typeof(v_comments) <> 'array' then v_comments := '[]'::jsonb; end if;
  if jsonb_array_length(v_comments) >= 100 then raise exception 'This discussion has reached its limit'; end if;

  v_comment := jsonb_build_object(
    'id', gen_random_uuid(),
    'authorId', v_user,
    'text', btrim(p_text),
    'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  );
  update public.ming_space_content
  set payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{comments}', v_comments || jsonb_build_array(v_comment), true),
      updated_at = now()
  where id = p_content_id;

  return v_comment;
end;
$function$;

revoke all on function public.add_ming_business_space_post_comment(uuid, text) from public, anon;
grant execute on function public.add_ming_business_space_post_comment(uuid, text) to authenticated;

-- Per-member likes for Business Home posts. Unlike a single shared toggle
-- flag in the post payload, likedBy records each member independently.
create or replace function public.toggle_ming_business_space_post_like(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_kind text;
  v_payload jsonb;
  v_liked_by jsonb;
  v_liked boolean;
  v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select c.space_id, c.kind, coalesce(c.payload,'{}'::jsonb)
    into v_space_id, v_kind, v_payload
  from public.ming_space_content c
  where c.id = p_content_id
  for update;

  if v_space_id is null or v_kind <> 'business_post' then raise exception 'Business post not found'; end if;
  if not exists (
    select 1 from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=v_space_id and s.nature='business'
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Business Space membership required'; end if;

  v_liked_by := v_payload->'likedBy';
  if jsonb_typeof(v_liked_by) <> 'array' then v_liked_by := '[]'::jsonb; end if;

  if exists (select 1 from jsonb_array_elements_text(v_liked_by) as liked(user_id) where liked.user_id=v_user::text) then
    select coalesce(jsonb_agg(to_jsonb(liked.user_id)), '[]'::jsonb)
      into v_liked_by
    from jsonb_array_elements_text(v_liked_by) as liked(user_id)
    where liked.user_id <> v_user::text;
    v_liked := false;
  else
    v_liked_by := v_liked_by || jsonb_build_array(v_user::text);
    v_liked := true;
  end if;

  v_count := jsonb_array_length(v_liked_by);
  update public.ming_space_content
  set payload = jsonb_set(
    jsonb_set(coalesce(payload,'{}'::jsonb), '{likedBy}', v_liked_by, true),
    '{likeCount}', to_jsonb(v_count), true
  ), updated_at = now()
  where id = p_content_id;

  return jsonb_build_object('liked',v_liked,'like_count',v_count,'liked_by',v_liked_by);
end;
$function$;

revoke all on function public.toggle_ming_business_space_post_like(uuid) from public, anon;
grant execute on function public.toggle_ming_business_space_post_like(uuid) to authenticated;
