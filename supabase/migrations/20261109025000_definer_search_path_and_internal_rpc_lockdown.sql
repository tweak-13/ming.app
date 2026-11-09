begin;

-- Empty search_path prevents public-schema shadowing in SECURITY DEFINER code.
alter function public.add_ming_friendly_activity_comment(uuid,text) set search_path = '';
alter function public.change_username(text) set search_path = '';
alter function public.get_daily_update_comments(uuid) set search_path = '';
alter function public.get_daily_updates(integer) set search_path = '';
alter function public.get_discover_places(double precision,double precision,double precision) set search_path = '';
alter function public.get_discoverable_profiles(double precision) set search_path = '';
alter function public.get_interest_discoverable_profiles(integer) set search_path = '';
alter function public.get_ming_friendly_activity_comments(uuid) set search_path = '';
alter function public.get_my_connection_profiles() set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.ming_can_access_friendly_activity(uuid,uuid) set search_path = '';
alter function public.ming_claim_view_once_media(uuid) set search_path = '';
alter function public.ming_send_message(uuid,text) set search_path = '';
alter function public.ming_send_message_v2(uuid,text,text,text,integer,uuid) set search_path = '';
alter function public.ming_send_message_v3(uuid,text,text,text,integer,uuid,text,text,text,bigint) set search_path = '';
alter function public.ming_users_are_connected(uuid,uuid) set search_path = '';
alter function public.set_my_discovery_location(double precision,double precision,double precision) set search_path = '';
alter function public.set_my_discovery_location(double precision,double precision,double precision,text) set search_path = '';
alter function public.validate_daily_update_media_owner() set search_path = '';

-- The connection-check function is an internal helper used by SECURITY
-- DEFINER message RPCs. Exposing it as a public RPC lets any signed-in user
-- enumerate arbitrary pairs in the connection graph.
revoke all on function public.ming_users_are_connected(uuid,uuid) from public,anon,authenticated;

-- Trigger functions are invoked by PostgreSQL triggers, not by client RPCs.
revoke all on function public.validate_daily_update_media_owner() from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;

-- Daily Update comments are visible only for a currently available feed item,
-- and only to an authenticated session. The existing feed intentionally
-- exposes active Daily Updates to signed-in members.
create or replace function public.get_daily_update_comments(p_update_id uuid)
returns table(
  id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    c.id,
    c.author_id,
    c.body,
    c.created_at,
    p.username,
    p.display_name,
    p.avatar_url
  from public.daily_update_comments c
  join public.profiles p on p.id = c.author_id
  where c.update_id = p_update_id
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.daily_updates u
      where u.id = p_update_id
        and u.created_at > now() - interval '24 hours'
    )
  order by c.created_at asc;
$function$;

revoke all on function public.get_daily_update_comments(uuid) from public,anon;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;

commit;
