-- Tweaklr private blocking migration
-- Run once in Supabase SQL Editor. This creates a private block list and
-- rejects new messages in either direction when either participant blocked the other.

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_not_self check (blocker_id <> blocked_id),
  constraint user_blocks_unique unique (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can read their own blocks" on public.user_blocks;
create policy "Users can read their own blocks"
  on public.user_blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "Users can block from their own account" on public.user_blocks;
create policy "Users can block from their own account"
  on public.user_blocks for insert
  to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

drop policy if exists "Users can unblock from their own account" on public.user_blocks;
create policy "Users can unblock from their own account"
  on public.user_blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

create or replace function public.tweaklr_reject_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = new.sender_id and b.blocked_id = new.recipient_id)
       or (b.blocker_id = new.recipient_id and b.blocked_id = new.sender_id)
  ) then
    raise exception 'This conversation is unavailable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tweaklr_blocked_message_guard on public.messages;
create trigger tweaklr_blocked_message_guard
before insert on public.messages
for each row execute function public.tweaklr_reject_blocked_message();

grant select, insert, delete on public.user_blocks to authenticated;

revoke all on function public.tweaklr_reject_blocked_message() from public, anon, authenticated;
revoke all on function public.tweaklr_reject_blocked_connection() from public, anon, authenticated;

-- Prevent a new connection from being created if either person has blocked the other.
create or replace function public.tweaklr_reject_blocked_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester uuid;
  v_recipient uuid;
begin
  v_requester := new.requester_id;
  v_recipient := new.recipient_id;

  if (tg_op = 'INSERT' or new.status = 'accepted') and exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = v_requester and b.blocked_id = v_recipient)
       or (b.blocker_id = v_recipient and b.blocked_id = v_requester)
  ) then
    raise exception 'This connection is unavailable.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tweaklr_blocked_connection_guard on public.connections;
create trigger tweaklr_blocked_connection_guard
before insert on public.connections
for each row execute function public.tweaklr_reject_blocked_connection();

drop trigger if exists tweaklr_blocked_connection_update_guard on public.connections;
create trigger tweaklr_blocked_connection_update_guard
before update of status on public.connections
for each row when (new.status = 'accepted')
execute function public.tweaklr_reject_blocked_connection();
