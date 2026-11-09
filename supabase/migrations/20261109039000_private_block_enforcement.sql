begin;

create or replace function private.tweaklr_is_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and p_user_id is not null
    and exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id)
         or (b.blocker_id = p_user_id and b.blocked_id = (select auth.uid()))
    );
$function$;
grant usage on schema private to authenticated;
grant execute on function private.tweaklr_is_blocked(uuid) to authenticated;
revoke all on function private.tweaklr_is_blocked(uuid) from public, anon;

-- A block immediately severs the connection and ends any pending/active call.
create or replace function public.tweaklr_apply_block_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or new.blocker_id <> (select auth.uid()) then
    raise exception 'You may only create your own block record';
  end if;

  delete from public.connections c
  where (c.requester_id = new.blocker_id and c.recipient_id = new.blocked_id)
     or (c.requester_id = new.blocked_id and c.recipient_id = new.blocker_id);

  update public.ming_call_invites i
  set status = 'ended', updated_at = now()
  where (
      (i.caller_id = new.blocker_id and i.recipient_id = new.blocked_id)
      or (i.caller_id = new.blocked_id and i.recipient_id = new.blocker_id)
    )
    and i.status in ('pending','accepted');

  return new;
end;
$function$;

drop trigger if exists tweaklr_apply_block_side_effects on public.user_blocks;
create trigger tweaklr_apply_block_side_effects
after insert on public.user_blocks
for each row execute function public.tweaklr_apply_block_side_effects();

revoke all on function public.tweaklr_apply_block_side_effects() from public, anon, authenticated;

-- The blocker may still see the account in their private blocked-users list.
-- Everyone else must respect the block in both directions.
alter policy "Users can view discoverable profiles"
on public.profiles
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.user_blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = profiles.id
  )
  or (
    discoverable = true
    and not private.tweaklr_is_blocked(profiles.id)
  )
);

-- Replace the message INSERT helper call with a policy-local accepted
-- connection check, so the internal connection helper remains non-callable.
drop policy if exists "Connected users can send messages" on public.messages;
create policy "Connected users can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and not private.tweaklr_is_blocked(recipient_id)
  and exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = (select auth.uid()) and c.recipient_id = messages.recipient_id)
        or (c.recipient_id = (select auth.uid()) and c.requester_id = messages.recipient_id)
      )
  )
);

drop policy if exists "Users can view their messages" on public.messages;
create policy "Users can view their messages"
on public.messages
for select
to authenticated
using (
  (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and not private.tweaklr_is_blocked(
    case when sender_id = (select auth.uid()) then recipient_id else sender_id end
  )
);

alter policy "Recipients can mark messages read"
on public.messages
using (
  recipient_id = (select auth.uid())
  and not private.tweaklr_is_blocked(sender_id)
)
with check (
  recipient_id = (select auth.uid())
  and not private.tweaklr_is_blocked(sender_id)
);

-- Existing call invites are hidden from blocked participants, and new calls
-- cannot be created across a block even if a stale connection row remains.
alter policy "Ming call invites insert"
on public.ming_call_invites
with check (
  caller_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and status = 'pending'
  and expires_at > now()
  and expires_at <= now() + interval '2 minutes'
  and not private.tweaklr_is_blocked(recipient_id)
  and exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = (select auth.uid()) and c.recipient_id = ming_call_invites.recipient_id)
        or (c.recipient_id = (select auth.uid()) and c.requester_id = ming_call_invites.recipient_id)
      )
  )
);

alter policy "Ming call invites read"
on public.ming_call_invites
using (
  (caller_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and not private.tweaklr_is_blocked(
    case when caller_id = (select auth.uid()) then recipient_id else caller_id end
  )
);

alter policy "Ming call invites update"
on public.ming_call_invites
using (
  (caller_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and not private.tweaklr_is_blocked(
    case when caller_id = (select auth.uid()) then recipient_id else caller_id end
  )
)
with check (
  (caller_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and not private.tweaklr_is_blocked(
    case when caller_id = (select auth.uid()) then recipient_id else caller_id end
  )
);

-- Preserve the existing discovery RPC contracts while filtering blocked users.
alter function public.get_discoverable_profiles(double precision)
  rename to get_discoverable_profiles_unfiltered;
revoke all on function public.get_discoverable_profiles_unfiltered(double precision) from public, anon, authenticated;

create function public.get_discoverable_profiles(p_radius_km double precision default null)
returns table(
  id uuid, username text, display_name text, avatar_url text, bio text,
  headline text, interests jsonb, tags jsonb, activity text, created_at timestamptz,
  distance_km double precision, bearing_deg double precision
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.headline,p.interests,p.tags,
         p.activity,p.created_at,
         case when p_radius_km is null then null
              else round(p.distance_km::numeric,1)::double precision end,
         null::double precision
  from public.get_discoverable_profiles_unfiltered(
    case when p_radius_km is null then null else greatest(0,least(p_radius_km,50)) end
  ) p
  where (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(p.id);
$function$;
revoke all on function public.get_discoverable_profiles(double precision) from public, anon;
grant execute on function public.get_discoverable_profiles(double precision) to authenticated;

alter function public.get_interest_discoverable_profiles(integer)
  rename to get_interest_discoverable_profiles_unfiltered;
revoke all on function public.get_interest_discoverable_profiles_unfiltered(integer) from public, anon, authenticated;

create function public.get_interest_discoverable_profiles(p_limit integer default 50)
returns table(
  id uuid, username text, display_name text, avatar_url text, bio text,
  headline text, interests jsonb, tags jsonb, activity text, created_at timestamptz,
  match_score integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id,p.username,p.display_name,p.avatar_url,p.bio,p.headline,p.interests,p.tags,
         p.activity,p.created_at,p.match_score
  from public.get_interest_discoverable_profiles_unfiltered(p_limit) p
  where (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(p.id);
$function$;
revoke all on function public.get_interest_discoverable_profiles(integer) from public, anon;
grant execute on function public.get_interest_discoverable_profiles(integer) to authenticated;

alter function public.get_daily_updates(integer)
  rename to get_daily_updates_unfiltered;
revoke all on function public.get_daily_updates_unfiltered(integer) from public, anon, authenticated;

create function public.get_daily_updates(p_limit integer default 50)
returns table(
  id uuid, author_id uuid, kind text, title text, body text, media jsonb,
  created_at timestamptz, likes integer, liked boolean, comments_count integer,
  author_username text, author_display_name text, author_avatar_url text,
  author_bio text, author_headline text, author_activity text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select u.id,u.author_id,u.kind,u.title,u.body,u.media,u.created_at,u.likes,u.liked,
         u.comments_count,u.author_username,u.author_display_name,u.author_avatar_url,
         u.author_bio,u.author_headline,u.author_activity
  from public.get_daily_updates_unfiltered(p_limit) u
  where (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(u.author_id);
$function$;
revoke all on function public.get_daily_updates(integer) from public, anon;
grant execute on function public.get_daily_updates(integer) to authenticated;

alter function public.get_nearby_activities(double precision,double precision,double precision)
  rename to get_nearby_activities_unfiltered;
revoke all on function public.get_nearby_activities_unfiltered(double precision,double precision,double precision) from public, anon, authenticated;

create function public.get_nearby_activities(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 5
)
returns table(
  id uuid, author_id uuid, author_display_name text, author_username text,
  author_avatar_url text, author_headline text, author_bio text, author_activity text,
  title text, body text, created_at timestamptz, starts_at timestamptz,
  place text, going bigint, distance_km double precision, bearing_deg double precision
)
language sql
stable
security definer
set search_path = ''
as $function$
  select a.id,a.author_id,a.author_display_name,a.author_username,a.author_avatar_url,
         a.author_headline,a.author_bio,a.author_activity,a.title,a.body,a.created_at,
         a.starts_at,a.place,a.going,round(a.distance_km::numeric,1)::double precision,
         null::double precision
  from public.get_nearby_activities_unfiltered(p_latitude,p_longitude,p_radius_km) a
  where (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(a.author_id);
$function$;
revoke all on function public.get_nearby_activities(double precision,double precision,double precision) from public, anon;
grant execute on function public.get_nearby_activities(double precision,double precision,double precision) to authenticated;

-- Blocked authors are omitted from Daily Update comments and activity threads.
create or replace function public.get_daily_update_comments(p_update_id uuid)
returns table(
  id uuid, author_id uuid, body text, created_at timestamptz,
  author_username text, author_display_name text, author_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id,c.author_id,c.body,c.created_at,p.username,p.display_name,p.avatar_url
  from public.daily_update_comments c
  join public.profiles p on p.id=c.author_id
  where c.update_id=p_update_id
    and (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(c.author_id)
    and exists (
      select 1 from public.daily_updates u
      where u.id=p_update_id and u.created_at > now()-interval '24 hours'
    )
  order by c.created_at asc;
$function$;
revoke all on function public.get_daily_update_comments(uuid) from public, anon;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;

create or replace function public.get_daily_update_activity_comments(p_update_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_access_daily_update_activity(p_update_id, (select auth.uid())) then
    raise exception 'Join this activity to view its discussion';
  end if;

  return query
  select jsonb_build_object(
    'id',c.id,'body',c.body,'user_id',c.user_id,'created_at',c.created_at,
    'author_display_name',coalesce(pr.display_name,pr.username,'Tweaklr member'),
    'author_username',pr.username,'author_avatar_url',pr.avatar_url,
    'is_mine',c.user_id=(select auth.uid())
  )
  from public.daily_update_activity_comments c
  left join public.profiles pr on pr.id=c.user_id
  where c.update_id=p_update_id
    and not private.tweaklr_is_blocked(c.user_id)
  order by c.created_at asc;
end;
$function$;

create or replace function public.get_daily_update_activity_comment_count(p_update_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::bigint
  from public.daily_update_activity_comments c
  where c.update_id=p_update_id
    and (select auth.uid()) is not null
    and public.can_access_daily_update_activity(p_update_id,(select auth.uid()))
    and not private.tweaklr_is_blocked(c.user_id);
$function$;

create or replace function public.get_daily_update_activity_comment_counts(p_update_ids uuid[])
returns table(update_id uuid,comments_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.update_id,count(*)::bigint
  from public.daily_update_activity_comments c
  where c.update_id=any(coalesce(p_update_ids,'{}'::uuid[]))
    and (select auth.uid()) is not null
    and public.can_access_daily_update_activity(c.update_id,(select auth.uid()))
    and not private.tweaklr_is_blocked(c.user_id)
  group by c.update_id;
$function$;

commit;