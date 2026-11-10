-- Enforce per-account view-once consumption at the Storage authorization layer.
-- Existing comment RPCs already persist the listener in
-- daily_update_comment_voice_views; this prevents that same account from
-- requesting a fresh signed URL after the listen has been consumed.

create or replace function private.can_read_daily_update_comment_voice(p_voice_path text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.daily_update_comments c
    join public.daily_updates u on u.id = c.update_id
    where c.voice_path = p_voice_path
      and (
        u.created_at > now() - interval '24 hours'
        or u.author_id = (select auth.uid())
        or c.author_id = (select auth.uid())
      )
      and (
        c.is_private = false
        or c.author_id = (select auth.uid())
        or u.author_id = (select auth.uid())
      )
      and not private.tweaklr_is_blocked(c.author_id)
      and not (
        c.voice_view_once
        and exists (
          select 1
          from public.daily_update_comment_voice_views v
          where v.comment_id = c.id
            and v.viewer_id = (select auth.uid())
        )
      )
  );
$function$;
