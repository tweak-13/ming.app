-- Tweaklr message editing: allow senders to edit their own text messages for 1 hour.
-- Run once in Supabase Dashboard > SQL Editor.
-- This adds a narrowly scoped sender UPDATE policy while preserving recipient read receipts.

drop policy if exists "Senders can edit their own text messages within one hour" on public.messages;
create policy "Senders can edit their own text messages within one hour"
on public.messages
for update
to authenticated
using (
  sender_id = (select auth.uid())
  and message_type = 'text'
  and attachment_path is null
  and voice_path is null
  and created_at <= now()
  and created_at >= now() - interval '1 hour'
)
with check (
  sender_id = (select auth.uid())
  and message_type = 'text'
  and attachment_path is null
  and voice_path is null
  and created_at <= now()
  and created_at >= now() - interval '1 hour'
);

-- Enforce which columns may change, even if a client is modified.
-- Senders may change only body, and only during the one-hour edit window.
-- Recipients may continue changing only read_at for read receipts.
create or replace function public.ming_guard_message_updates()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() = old.sender_id then
    if old.message_type <> 'text'
       or old.attachment_path is not null
       or old.voice_path is not null
       or old.created_at > now()
       or old.created_at < now() - interval '1 hour' then
      raise exception 'This message is no longer eligible for editing';
    end if;

    if (to_jsonb(new) - 'body') is distinct from (to_jsonb(old) - 'body') then
      raise exception 'Only the message body can be edited';
    end if;

    if new.body is null
       or char_length(trim(new.body)) < 1
       or char_length(new.body) > 2000 then
      raise exception 'Message must be between 1 and 2000 characters';
    end if;

  elsif auth.uid() = old.recipient_id then
    if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
      raise exception 'Recipients may only update the read receipt';
    end if;
  else
    raise exception 'Not allowed to update this message';
  end if;

  return new;
end;
$$;

drop trigger if exists ming_guard_message_updates on public.messages;
create trigger ming_guard_message_updates
before update on public.messages
for each row
execute function public.ming_guard_message_updates();

-- Use a narrow server-side edit path so the client does not depend on UPDATE RLS
-- policy composition. Ownership, type, attachments, and the 1-hour window are
-- checked again inside the database before any body change.
create or replace function public.ming_edit_message(
  p_message_id uuid,
  p_body text
)
returns table(id uuid, body text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_body is null
     or char_length(trim(p_body)) < 1
     or char_length(p_body) > 2000 then
    raise exception 'Message must be between 1 and 2000 characters';
  end if;

  return query
  update public.messages m
  set body = trim(p_body)
  where m.id = p_message_id
    and m.sender_id = auth.uid()
    and m.message_type = 'text'
    and m.attachment_path is null
    and m.voice_path is null
    and m.created_at <= now()
    and m.created_at >= now() - interval '1 hour'
  returning m.id, m.body;

  if not found then
    raise exception 'Message is not yours, is not editable text, or is outside the 1-hour limit';
  end if;
end;
$$;

revoke all on function public.ming_edit_message(uuid, text) from public, anon;
grant execute on function public.ming_edit_message(uuid, text) to authenticated;
