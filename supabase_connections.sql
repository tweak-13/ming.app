-- Ming connections
-- Run this once in Supabase SQL Editor.

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  note text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint connections_no_self check (requester_id <> recipient_id)
);

create unique index if not exists connections_pending_pair_idx
on public.connections (
  least(requester_id, recipient_id),
  greatest(requester_id, recipient_id)
)
where status = 'pending';

create index if not exists connections_requester_idx
on public.connections(requester_id);

create index if not exists connections_recipient_idx
on public.connections(recipient_id);

alter table public.connections enable row level security;

revoke all on table public.connections from anon;
grant select, insert, update, delete on public.connections to authenticated;

drop policy if exists "Users can view their connection rows" on public.connections;
create policy "Users can view their connection rows"
on public.connections
for select
to authenticated
using (
  (select auth.uid()) = requester_id
  or (select auth.uid()) = recipient_id
);

drop policy if exists "Users can send connection requests" on public.connections;
create policy "Users can send connection requests"
on public.connections
for insert
to authenticated
with check (
  (select auth.uid()) = requester_id
  and requester_id <> recipient_id
  and status = 'pending'
);

drop policy if exists "Recipients can respond to connection requests" on public.connections;
create policy "Recipients can respond to connection requests"
on public.connections
for update
to authenticated
using (
  (select auth.uid()) = recipient_id
  and status = 'pending'
)
with check (
  (select auth.uid()) = recipient_id
  and status in ('accepted', 'declined')
);

drop policy if exists "Connected users can remove a connection" on public.connections;
create policy "Connected users can remove a connection"
on public.connections
for delete
to authenticated
using (
  ((select auth.uid()) = requester_id or (select auth.uid()) = recipient_id)
  and status = 'accepted'
);

-- Return only limited profile fields for people connected to the signed-in user.
-- This avoids weakening the main profiles RLS policy just to render Connections.
create or replace function public.get_my_connection_profiles()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  headline text,
  interests jsonb,
  tags jsonb,
  activity text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.headline,
    to_jsonb(p.interests),
    to_jsonb(p.tags),
    p.activity,
    p.created_at
  from public.profiles p
  where p.id in (
    select case
      when c.requester_id = (select auth.uid()) then c.recipient_id
      else c.requester_id
    end
    from public.connections c
    where
      (c.requester_id = (select auth.uid()) or c.recipient_id = (select auth.uid()))
      and c.status in ('pending', 'accepted')
  );
$$;

revoke all on function public.get_my_connection_profiles() from public;
grant execute on function public.get_my_connection_profiles() to authenticated;

-- Ming discovery and nearby users
alter table public.profiles
  add column if not exists discoverable boolean not null default true;

create table if not exists public.profile_locations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

/* Existing installations originally had one row per user. Convert that row
   into a legacy device record so existing data remains readable, while new
   phones/laptops can keep independent locations. */
alter table public.profile_locations
  add column if not exists device_id text;

update public.profile_locations
set device_id = coalesce(device_id, 'legacy')
where device_id is null;

alter table public.profile_locations
  alter column device_id set not null;

do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.profile_locations'::regclass
    and contype = 'p'
  limit 1;

  if pk_name is not null then
    execute format('alter table public.profile_locations drop constraint %I', pk_name);
  end if;
exception
  when undefined_table then null;
end $$;

alter table public.profile_locations
  add constraint profile_locations_pkey primary key (user_id, device_id);

alter table public.profile_locations
  add column if not exists accuracy_m double precision;

update public.profile_locations
set accuracy_m = coalesce(accuracy_m, 1000)
where accuracy_m is null;

alter table public.profile_locations
  alter column accuracy_m set not null;

create index if not exists profile_locations_user_updated_idx
on public.profile_locations(user_id, updated_at desc);

alter table public.profile_locations enable row level security;
revoke all on table public.profile_locations from anon, authenticated;
grant select, insert, update, delete on table public.profile_locations to authenticated;

drop policy if exists "Users can manage their own approximate location" on public.profile_locations;
create policy "Users can manage their own approximate location"
on public.profile_locations
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop function if exists public.set_my_discovery_location(double precision, double precision);
drop function if exists public.set_my_discovery_location(double precision, double precision, double precision);

create or replace function public.set_my_discovery_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_device_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  if p_device_id is null
     or length(p_device_id) < 8
     or length(p_device_id) > 128
     or p_latitude is null
     or p_latitude < -90
     or p_latitude > 90
     or p_longitude is null
     or p_longitude < -180
     or p_longitude > 180
     or p_accuracy_m is null
     or p_accuracy_m <= 0
     or p_accuracy_m > 250 then
    raise exception 'Location accuracy is too low or device identity is invalid';
  end if;

  insert into public.profile_locations(
    user_id, device_id, latitude, longitude, accuracy_m, updated_at
  )
  values (
    (select auth.uid()),
    p_device_id,
    round(p_latitude::numeric, 3)::double precision,
    round(p_longitude::numeric, 3)::double precision,
    p_accuracy_m,
    now()
  )
  on conflict (user_id, device_id) do update set
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_my_discovery_location(double precision, double precision, double precision, text) from public;

grant execute on function public.set_my_discovery_location(double precision, double precision, double precision, text) to authenticated;

create or replace function public.get_discoverable_profiles(
  p_radius_km double precision default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  headline text,
  interests jsonb,
  tags jsonb,
  activity text,
  created_at timestamptz,
  distance_km double precision,
  bearing_deg double precision
)
language sql
security definer
set search_path = ''
stable
as $$
with me as (
  /* Use the newest recent accurate location from THIS account.
     A different device cannot overwrite it because locations are per-device. */
  select l.latitude, l.longitude
  from public.profile_locations l
  where l.user_id = (select auth.uid())
    and l.accuracy_m <= 250
    and l.updated_at >= now() - interval '10 minutes'
  order by l.updated_at desc
  limit 1
),
candidates as (
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.headline,
    to_jsonb(p.interests) interests,
    to_jsonb(p.tags) tags,
    p.activity,
    p.created_at,
    l.latitude,
    l.longitude,
    l.accuracy_m,
    l.updated_at,
    me.latitude my_latitude,
    me.longitude my_longitude
  from public.profiles p
  left join lateral (
    /* For each user, use their newest recent accurate device location. */
    select pl.latitude, pl.longitude, pl.accuracy_m, pl.updated_at
    from public.profile_locations pl
    where pl.user_id = p.id
      and pl.accuracy_m <= 250
      and pl.updated_at >= now() - interval '10 minutes'
    order by pl.updated_at desc
    limit 1
  ) l on true
  left join me on true
  where p.discoverable = true
    and p.id <> (select auth.uid())
),
measured as (
  select
    c.*,
    case
      when c.latitude is null or c.my_latitude is null then null
      else 6371.0 * 2.0 * asin(
        least(1.0, sqrt(
          power(sin(radians(c.latitude - c.my_latitude) / 2.0), 2)
          + cos(radians(c.my_latitude))
          * cos(radians(c.latitude))
          * power(sin(radians(c.longitude - c.my_longitude) / 2.0), 2)
        ))
      )
    end distance_km,
    case
      when c.latitude is null or c.my_latitude is null then null
      else (
        case
          when degrees(atan2(
            sin(radians(c.longitude - c.my_longitude)) * cos(radians(c.latitude)),
            cos(radians(c.my_latitude)) * sin(radians(c.latitude))
              - sin(radians(c.my_latitude))
              * cos(radians(c.latitude))
              * cos(radians(c.longitude - c.my_longitude))
          )) < 0
          then degrees(atan2(
            sin(radians(c.longitude - c.my_longitude)) * cos(radians(c.latitude)),
            cos(radians(c.my_latitude)) * sin(radians(c.latitude))
              - sin(radians(c.my_latitude))
              * cos(radians(c.latitude))
              * cos(radians(c.longitude - c.my_longitude))
          )) + 360.0
          else degrees(atan2(
            sin(radians(c.longitude - c.my_longitude)) * cos(radians(c.latitude)),
            cos(radians(c.my_latitude)) * sin(radians(c.latitude))
              - sin(radians(c.my_latitude))
              * cos(radians(c.latitude))
              * cos(radians(c.longitude - c.my_longitude))
          ))
        end
      )
    end bearing_deg
  from candidates c
)
select
  id,
  username,
  display_name,
  avatar_url,
  bio,
  headline,
  interests,
  tags,
  activity,
  created_at,
  distance_km,
  bearing_deg
from measured
where p_radius_km is null
   or (distance_km is not null and distance_km <= p_radius_km)
order by
  case when distance_km is null then 1 else 0 end,
  distance_km nulls last,
  created_at desc
limit 100;
$$;

revoke all on function public.get_discoverable_profiles(double precision) from public;
grant execute on function public.get_discoverable_profiles(double precision) to authenticated;
