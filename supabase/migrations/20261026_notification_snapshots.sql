-- Preserve read notification snapshots so they remain visible for 24 hours,
-- even if the source (such as an unread message) is no longer returned.

alter table public.user_notification_reads
  add column if not exists notification_payload jsonb;

alter table public.user_notification_reads
  alter column read_at drop not null,
  alter column read_at drop default;

create or replace function public.sync_tweaklr_notifications(p_notifications jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.user_notification_reads (user_id, notification_id, notification_payload, read_at)
  select auth.uid(),
         item.value->>'id',
         item.value,
         null
  from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) as item(value)
  where jsonb_typeof(item.value) = 'object'
    and length(coalesce(item.value->>'id', '')) between 1 and 240
  on conflict (user_id, notification_id)
  do update set notification_payload = excluded.notification_payload;
end;
$$;

revoke all on function public.sync_tweaklr_notifications(jsonb) from public;
grant execute on function public.sync_tweaklr_notifications(jsonb) to authenticated;
