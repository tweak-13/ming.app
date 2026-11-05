-- Space membership visibility for Space owners and admins.
-- Members can still see their own membership row; approved owners/admins
-- can see every member and pending applicant in their Space.
-- Run this migration in Supabase after deploying the matching script.js.

create or replace function public.get_my_ming_spaces_v2()
returns table (
  space_id uuid,
  owner_id uuid,
  name text,
  description text,
  nature text,
  privacy text,
  discoverable boolean,
  require_approval boolean,
  max_members integer,
  hue integer,
  location_linked boolean,
  expires_at timestamptz,
  features jsonb,
  created_at timestamptz,
  member_id uuid,
  member_role text,
  member_joined_at timestamptz,
  member_approved boolean,
  invite_id uuid,
  invite_code_hash text,
  invite_hint text,
  invite_created_at timestamptz,
  invite_expires_at timestamptz,
  invite_max_uses integer,
  invite_uses integer,
  invite_revoked boolean,
  invite_version integer,
  member_display_name text,
  member_username text,
  member_avatar_url text,
  member_headline text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    s.id,
    s.owner_id,
    s.name,
    s.description,
    s.nature,
    s.privacy,
    s.discoverable,
    s.require_approval,
    s.max_members,
    s.hue,
    s.location_linked,
    s.expires_at,
    s.features,
    s.created_at,
    m.user_id,
    m.role,
    m.joined_at,
    m.approved,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.id else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.code_hash else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.hint else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.created_at else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.expires_at else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.max_uses else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.uses else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.revoked else null end,
    case when exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    ) then i.version else null end,
    p.display_name,
    p.username,
    p.avatar_url,
    p.headline
  from public.ming_spaces s
  join public.ming_space_members m on m.space_id = s.id
  left join public.profiles p on p.id = m.user_id
  left join lateral (
    select si.*
    from public.ming_space_invites si
    where si.space_id = s.id
      and si.revoked = false
    order by si.version desc
    limit 1
  ) i on true
  where
    m.user_id = (select auth.uid())
    or exists (
      select 1
      from public.ming_space_members actor
      where actor.space_id = s.id
        and actor.user_id = (select auth.uid())
        and actor.approved = true
        and actor.role in ('owner','admin')
    )
  order by s.created_at desc, m.joined_at asc;
$$;

revoke all on function public.get_my_ming_spaces_v2() from public, anon;
grant execute on function public.get_my_ming_spaces_v2() to authenticated;
