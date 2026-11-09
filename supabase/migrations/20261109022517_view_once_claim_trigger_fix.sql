begin;

create or replace function public.ming_guard_message_updates()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (select auth.uid()) = old.sender_id then
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

  elsif (select auth.uid()) = old.recipient_id then
    -- Recipient read receipts are allowed.
    if (to_jsonb(new) - 'read_at') is not distinct from (to_jsonb(old) - 'read_at') then
      return new;
    end if;

    -- A view-once media claim may change only viewed_at, once, for the
    -- intended recipient. Direct UPDATE privileges do not expose this column.
    if old.view_once = true
       and old.viewed_at is null
       and new.viewed_at is not null
       and (to_jsonb(new) - 'viewed_at') is not distinct from (to_jsonb(old) - 'viewed_at') then
      return new;
    end if;

    raise exception 'Recipients may only update read receipts or claim unopened view-once media';
  else
    raise exception 'Not allowed to update this message';
  end if;

  return new;
end;
$function$;

revoke all on function public.ming_guard_message_updates() from public, anon, authenticated;

commit;