-- Enforce a strict creator / moderator / member boundary for Friendly Communities.
-- The creator_id column is authoritative; a stale membership role cannot grant ownership.

begin;

-- Repair historical role drift: only creator_id may carry the owner role.
update public.ming_friendly_community_members m
set role = 'member'
from public.ming_friendly_communities c
where c.id = m.community_id
  and m.role = 'owner'
  and m.user_id <> c.creator_id;

insert into public.ming_friendly_community_members (community_id,user_id,role,status)
select c.id,c.creator_id,'owner','approved'
from public.ming_friendly_communities c
on conflict (community_id,user_id)
do update set role='owner',status='approved';

-- Publishing is creator-only at the database boundary, not merely hidden in the UI.
create or replace function public.create_ming_friendly_community_post(
  p_community_id uuid,
  p_body text default '',
  p_media jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_post public.ming_friendly_community_posts;
  v_space_id uuid;
  v_creator uuid;
  v_item jsonb;
  v_path text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select space_id,creator_id into v_space_id,v_creator
  from public.ming_friendly_communities where id=p_community_id;

  if not found then raise exception 'Community not found'; end if;
  if v_creator <> v_user then
    raise exception 'Only the community creator can publish posts';
  end if;

  if not exists (
    select 1 from public.ming_friendly_community_members
    where community_id=p_community_id and user_id=v_user and status='approved'
  ) then raise exception 'Approved community membership required'; end if;

  if char_length(coalesce(p_body,''))>3000
    or jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(p_media,'[]'::jsonb))>4 then
    raise exception 'Post is too long or has too many attachments';
  end if;

  if char_length(btrim(coalesce(p_body,'')))=0
    and jsonb_array_length(coalesce(p_media,'[]'::jsonb))=0 then
    raise exception 'Write something or attach media';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
    v_path := v_item->>'path';
    if v_path is null or v_path !~ ('^'||v_user::text||'/friendly-'||v_space_id::text||'/community-'||p_community_id::text||'-[A-Za-z0-9._-]+$') then
      raise exception 'Invalid community attachment path';
    end if;
  end loop;

  insert into public.ming_friendly_community_posts(community_id,author_id,body,media)
  values(p_community_id,v_user,btrim(coalesce(p_body,'')),coalesce(p_media,'[]'::jsonb))
  returning * into v_post;

  return jsonb_build_object(
    'id',v_post.id,'community_id',v_post.community_id,'author_id',v_post.author_id,
    'body',v_post.body,'media',v_post.media,'created_at',v_post.created_at,'comment_count',0
  );
end;
$function$;

-- Creator has full control. Moderators may approve/remove ordinary members only.
-- Neither moderators nor regular members can grant roles or alter the creator.
create or replace function public.manage_ming_friendly_community_member(
  p_community_id uuid,p_user_id uuid,p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_creator uuid;
  v_actor_role text;
  v_target public.ming_friendly_community_members;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select creator_id into v_creator
  from public.ming_friendly_communities where id=p_community_id;
  if not found then raise exception 'Community not found'; end if;

  if v_user=v_creator then
    v_actor_role := 'owner';
  else
    select role into v_actor_role
    from public.ming_friendly_community_members
    where community_id=p_community_id and user_id=v_user and status='approved';
    if v_actor_role is distinct from 'moderator' then
      raise exception 'Community moderation permission required';
    end if;
  end if;

  select * into v_target
  from public.ming_friendly_community_members
  where community_id=p_community_id and user_id=p_user_id
  for update;
  if not found then raise exception 'Member not found'; end if;
  if p_user_id=v_creator or v_target.role='owner' then
    raise exception 'The community creator cannot be changed here';
  end if;

  if p_action='approve' and v_target.status='pending' then
    update public.ming_friendly_community_members
    set status='approved',joined_at=now()
    where id=v_target.id;

  elsif p_action='remove' then
    if v_actor_role='moderator' and v_target.role<>'member' then
      raise exception 'Moderators can only remove regular members';
    end if;
    delete from public.ming_friendly_community_members where id=v_target.id;

  elsif p_action='promote' and v_actor_role='owner' and v_target.status='approved' and v_target.role='member' then
    update public.ming_friendly_community_members set role='moderator' where id=v_target.id;

  elsif p_action='demote' and v_actor_role='owner' and v_target.role='moderator' then
    update public.ming_friendly_community_members set role='member' where id=v_target.id;

  else
    raise exception 'This membership action is not allowed';
  end if;

  return jsonb_build_object('success',true);
end;
$function$;

revoke all on function public.create_ming_friendly_community_post(uuid,text,jsonb) from public,anon;
revoke all on function public.manage_ming_friendly_community_member(uuid,uuid,text) from public,anon;
grant execute on function public.create_ming_friendly_community_post(uuid,text,jsonb) to authenticated;
grant execute on function public.manage_ming_friendly_community_member(uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
