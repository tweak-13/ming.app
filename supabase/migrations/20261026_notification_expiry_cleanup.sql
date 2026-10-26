-- Keep expired read IDs as tombstones so old notifications cannot reappear,
-- while removing their stored notification content after 24 hours.

create or replace function public.cleanup_tweaklr_expired_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.user_notification_reads
  set notification_payload = null
  where user_id = auth.uid()
    and read_at is not null
    and read_at <= now() - interval '24 hours';
end;
$$;

create or replace function public.mark_tweaklr_notifications_read(p_notification_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.user_notification_reads (user_id, notification_id, read_at)
  select auth.uid(), item.notification_id, now()
  from (
    select distinct unnest(coalesce(p_notification_ids, array[]::text[])) as notification_id
  ) as item
  where item.notification_id is not null
    and length(item.notification_id) between 1 and 240
  on conflict (user_id, notification_id)
  do update set read_at = excluded.read_at;

  update public.user_notification_reads
  set notification_payload = null
  where user_id = auth.uid()
    and read_at is not null
    and read_at <= now() - interval '24 hours';
end;
$$;

revoke all on function public.cleanup_tweaklr_expired_notifications() from public;
grant execute on function public.cleanup_tweaklr_expired_notifications() to authenticated;
revoke all on function public.mark_tweaklr_notifications_read(text[]) from public;
grant execute on function public.mark_tweaklr_notifications_read(text[]) to authenticated;
