create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.get_my_ming_spaces_v2()
returns table(
  space_id uuid, owner_id uuid, name text, description text, nature text, privacy text,
  discoverable boolean, require_approval boolean, max_members integer, hue integer,
  location_linked boolean, expires_at timestamptz, features jsonb, created_at timestamptz,
  member_id uuid, member_role text, member_joined_at timestamptz, member_approved boolean,
  invite_id uuid, invite_code_hash text, invite_hint text, invite_created_at timestamptz,
  invite_expires_at timestamptz, invite_max_uses integer, invite_uses integer,
  invite_revoked boolean, invite_version integer,
  member_display_name text, member_username text, member_avatar_url text, member_headline text
)
language sql stable security definer set search_path = ''
as $function$
  select
    s.id, s.owner_id, s.name, s.description, s.nature, s.privacy,
    s.discoverable, s.require_approval, s.max_members, s.hue,
    s.location_linked, s.expires_at, s.features, s.created_at,
    m.user_id, m.role, m.joined_at, m.approved,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.id else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.code_hash else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.hint else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.created_at else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.expires_at else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.max_uses else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.uses else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.revoked else null end,
    case when exists (
      select 1 from public.ming_space_members actor
      where actor.space_id = s.id and actor.user_id = (select auth.uid())
        and actor.approved = true and actor.role in ('owner','admin')
    ) then i.version else null end,
    p.display_name, p.username, p.avatar_url, p.headline
  from public.ming_spaces s
  join public.ming_space_members m on m.space_id = s.id
  left join public.profiles p on p.id = m.user_id
  left join lateral (
    select si.* from public.ming_space_invites si
    where si.space_id = s.id and si.revoked = false
    order by si.version desc limit 1
  ) i on true
  where m.user_id = (select auth.uid())
     or exists (
       select 1 from public.ming_space_members actor
       where actor.space_id = s.id and actor.user_id = (select auth.uid())
         and actor.approved = true
         and (actor.role in ('owner','admin') or m.approved = true)
     )
  order by s.created_at desc, m.joined_at asc;
$function$;

revoke all on function private.get_my_ming_spaces_v2() from public, anon;
grant execute on function private.get_my_ming_spaces_v2() to authenticated;

create or replace function public.get_my_ming_spaces_v2()
returns table(
  space_id uuid, owner_id uuid, name text, description text, nature text, privacy text,
  discoverable boolean, require_approval boolean, max_members integer, hue integer,
  location_linked boolean, expires_at timestamptz, features jsonb, created_at timestamptz,
  member_id uuid, member_role text, member_joined_at timestamptz, member_approved boolean,
  invite_id uuid, invite_code_hash text, invite_hint text, invite_created_at timestamptz,
  invite_expires_at timestamptz, invite_max_uses integer, invite_uses integer,
  invite_revoked boolean, invite_version integer,
  member_display_name text, member_username text, member_avatar_url text, member_headline text
)
language sql stable security invoker set search_path = ''
as $function$
  select * from private.get_my_ming_spaces_v2();
$function$;
revoke all on function public.get_my_ming_spaces_v2() from public, anon;
grant execute on function public.get_my_ming_spaces_v2() to authenticated;

create or replace function private.remove_ming_space_member(p_space_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_nature text;
  v_actor_role text;
  v_target_role text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_user_id = v_actor then raise exception 'You cannot remove yourself using member administration. Use Leave Space instead.'; end if;

  select s.nature into v_nature
  from public.ming_spaces s where s.id = p_space_id for update;
  if not found then raise exception 'Space not found.'; end if;

  select m.role into v_actor_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = v_actor and m.approved = true;

  if v_nature = 'romantic' then
    if v_actor_role <> 'owner' then raise exception 'Only the creator can remove a member from this private Space.'; end if;
  elsif v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Only the creator or an approved admin can remove members.';
  end if;

  select m.role into v_target_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = p_user_id
  for update;
  if not found then raise exception 'This person is no longer a member of the Space.'; end if;
  if v_target_role = 'owner' then raise exception 'The Space creator cannot be removed.'; end if;

  delete from public.ming_space_members
  where space_id = p_space_id and user_id = p_user_id;

  return jsonb_build_object('ok',true,'space_id',p_space_id,'user_id',p_user_id,'removed',true);
end;
$function$;
revoke all on function private.remove_ming_space_member(uuid,uuid) from public, anon;
grant execute on function private.remove_ming_space_member(uuid,uuid) to authenticated;

create or replace function public.remove_ming_space_member(p_space_id uuid, p_user_id uuid)
returns jsonb
language sql security invoker set search_path = ''
as $function$
  select private.remove_ming_space_member(p_space_id,p_user_id);
$function$;
revoke all on function public.remove_ming_space_member(uuid,uuid) from public, anon;
grant execute on function public.remove_ming_space_member(uuid,uuid) to authenticated;

create or replace function public.remove_ming_business_space_member(p_space_id uuid, p_user_id uuid)
returns jsonb
language sql security invoker set search_path = ''
as $function$
  select private.remove_ming_space_member(p_space_id,p_user_id);
$function$;
revoke all on function public.remove_ming_business_space_member(uuid,uuid) from public, anon;
grant execute on function public.remove_ming_business_space_member(uuid,uuid) to authenticated;

create or replace function private.set_ming_space_member_role(p_space_id uuid, p_user_id uuid, p_role text)
returns public.ming_space_members
language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.ming_space_members;
  v_nature text;
  v_actor uuid := (select auth.uid());
  v_actor_role text;
  v_target_role text;
  v_allowed text[];
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_user_id = v_actor then raise exception 'You cannot change your own Space role.'; end if;

  select s.nature into v_nature from public.ming_spaces s where s.id = p_space_id for update;
  if not found then raise exception 'Space not found.'; end if;

  select m.role into v_actor_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = v_actor and m.approved = true;
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Only the creator or an approved admin can manage Space roles.';
  end if;

  select m.role into v_target_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = p_user_id
  for update;
  if not found then raise exception 'Member not found.'; end if;
  if v_target_role = 'owner' then raise exception 'The owner role cannot be reassigned.'; end if;
  if v_actor_role = 'admin' and (v_target_role = 'admin' or p_role = 'admin') then
    raise exception 'Only the creator can appoint or change an admin.';
  end if;

  v_allowed := case v_nature
    when 'business' then array['admin','manager','member']
    when 'friendly' then array['admin','moderator','member']
    when 'casual' then array['admin','moderator','member','guest']
    when 'silly' then array['admin','moderator','member']
    when 'romantic' then array['member']
    when 'marketplace' then array['admin','moderator','seller','buyer']
    else array[]::text[]
  end;
  if not (p_role = any(v_allowed)) then raise exception 'That role is not available in this Space.'; end if;

  update public.ming_space_members
  set role = p_role
  where space_id = p_space_id and user_id = p_user_id
  returning * into v_row;
  return v_row;
end;
$function$;
revoke all on function private.set_ming_space_member_role(uuid,uuid,text) from public, anon;
grant execute on function private.set_ming_space_member_role(uuid,uuid,text) to authenticated;

create or replace function public.set_ming_space_member_role(p_space_id uuid, p_user_id uuid, p_role text)
returns public.ming_space_members
language sql security invoker set search_path = ''
as $function$
  select private.set_ming_space_member_role(p_space_id,p_user_id,p_role);
$function$;
revoke all on function public.set_ming_space_member_role(uuid,uuid,text) from public, anon;
grant execute on function public.set_ming_space_member_role(uuid,uuid,text) to authenticated;
