-- Ming message extras: replies, reactions, and private voice notes
-- Replace the original text-only body constraint with a type-aware rule.
alter table public.messages
  drop constraint if exists message_body_check;

alter table public.messages
  drop constraint if exists messages_body_check;

alter table public.messages
  drop constraint if exists messages_body_type_check;

alter table public.messages
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text','voice')),
  add column if not exists voice_path text,
  add column if not exists voice_duration integer,
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

alter table public.messages
  add constraint messages_body_type_check
  check (
    (
      message_type = 'text'
      and char_length(trim(body)) between 1 and 2000
    )
    or
    (
      message_type = 'voice'
      and char_length(body) = 0
    )
    or
    (
      message_type = 'image'
      and char_length(body) = 0
    )
  );

create index if not exists messages_reply_to_idx
on public.messages(reply_to_id);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique(message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx
on public.message_reactions(message_id);

alter table public.message_reactions enable row level security;

revoke all on public.message_reactions from anon;
grant select, insert, delete on public.message_reactions to authenticated;

drop policy if exists "Users can view reactions on their messages" on public.message_reactions;
create policy "Users can view reactions on their messages"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_id
      and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
  )
);

drop policy if exists "Users can react in their conversations" on public.message_reactions;
create policy "Users can react in their conversations"
on public.message_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
  )
);

drop policy if exists "Users can remove their reactions" on public.message_reactions;
create policy "Users can remove their reactions"
on public.message_reactions for delete to authenticated
using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('ming-voice', 'ming-voice', false)
on conflict (id) do nothing;

drop policy if exists "Ming voice upload" on storage.objects;
create policy "Ming voice upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ming-voice'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Ming voice read" on storage.objects;
create policy "Ming voice read"
on storage.objects for select to authenticated
using (
  bucket_id = 'ming-voice'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.messages m
      where m.voice_path = name
        and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
    )
  )
);

drop policy if exists "Ming voice delete" on storage.objects;
create policy "Ming voice delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ming-voice'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

grant select, insert, update on public.messages to authenticated;

-- Realtime reactions can be enabled later if desired; current UI reloads reactions immediately.

create or replace function public.ming_send_message_v2(
  p_recipient_id uuid,
  p_body text,
  p_message_type text default 'text',
  p_voice_path text default null,
  p_voice_duration integer default null,
  p_reply_to_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_message public.messages;
begin
  if v_sender_id is null then raise exception 'Not authenticated'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then raise exception 'Invalid recipient'; end if;
  if not public.ming_users_are_connected(v_sender_id, p_recipient_id) then raise exception 'Users are not connected'; end if;

  if p_message_type = 'text' then
    if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 then
      raise exception 'Message must be between 1 and 2000 characters';
    end if;
  elsif p_message_type = 'voice' then
    if p_voice_path is null then raise exception 'Voice note is missing'; end if;
  else
    raise exception 'Unsupported message type';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to_id
      and ((m.sender_id = v_sender_id and m.recipient_id = p_recipient_id)
        or (m.sender_id = p_recipient_id and m.recipient_id = v_sender_id))
  ) then
    raise exception 'Invalid reply target';
  end if;

  insert into public.messages(sender_id, recipient_id, body, message_type, voice_path, voice_duration, reply_to_id)
  values(v_sender_id, p_recipient_id, coalesce(trim(p_body), ''), p_message_type, p_voice_path, p_voice_duration, p_reply_to_id)
  returning * into v_message;

  return v_message;
end;
$$;

revoke all on function public.ming_send_message_v2(uuid,text,text,text,integer,uuid) from public;
grant execute on function public.ming_send_message_v2(uuid,text,text,text,integer,uuid) to authenticated;
