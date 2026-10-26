-- Tweaklr notification read state with 24-hour retention.
-- Apply once in Supabase SQL Editor.

create table if not exists public.user_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id text not null,
  read_at timestamptz not null default now(),
  constraint user_notification_reads_pkey primary key (user_id, notification_id)
);

alter table public.user_notification_reads enable row level security;

drop policy if exists "Users can read their notification read state" on public.user_notification_reads;
create policy "Users can read their notification read state"
  on public.user_notification_reads
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can delete their expired notification read state" on public.user_notification_reads;
create policy "Users can delete their expired notification read state"
  on public.user_notification_reads
  for delete to authenticated
  using (user_id = auth.uid());

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

  delete from public.user_notification_reads
  where user_id = auth.uid()
    and read_at <= now() - interval '24 hours';
end;
$$;

revoke all on function public.mark_tweaklr_notifications_read(text[]) from public;
grant execute on function public.mark_tweaklr_notifications_read(text[]) to authenticated;

grant select, delete on public.user_notification_reads to authenticated;
