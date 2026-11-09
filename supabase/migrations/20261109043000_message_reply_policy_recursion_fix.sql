begin;

create or replace function private.is_message_reply_target_valid(
  p_reply_to_id uuid,
  p_sender_id uuid,
  p_recipient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) = p_sender_id
    and p_reply_to_id is not null
    and exists (
      select 1
      from public.messages m
      where m.id = p_reply_to_id
        and (
          (m.sender_id = p_sender_id and m.recipient_id = p_recipient_id)
          or
          (m.sender_id = p_recipient_id and m.recipient_id = p_sender_id)
        )
    );
$function$;

grant usage on schema private to authenticated;
grant execute on function private.is_message_reply_target_valid(uuid,uuid,uuid) to authenticated;
revoke all on function private.is_message_reply_target_valid(uuid,uuid,uuid) from public, anon;

drop policy if exists "Connected users can send messages" on public.messages;
create policy "Connected users can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and not private.tweaklr_is_blocked(recipient_id)
  and (
    (
      message_type = 'text'
      and char_length(trim(body)) between 1 and 2000
      and voice_path is null
      and attachment_path is null
      and attachment_size is null
      and attachment_name is null
      and attachment_mime is null
      and voice_duration is null
      and view_once = false
    )
    or
    (
      message_type = 'voice'
      and body = ''
      and voice_path like (select auth.uid())::text || '/%'
      and attachment_path is null
      and attachment_size is null
      and attachment_name is null
      and attachment_mime is null
      and voice_duration between 1 and 3600
    )
    or
    (
      message_type in ('image','file')
      and body = ''
      and attachment_path like (select auth.uid())::text || '/%'
      and voice_path is null
      and voice_duration is null
      and attachment_size between 0 and 52428800
      and char_length(coalesce(attachment_name,'')) between 1 and 255
      and char_length(coalesce(attachment_mime,'')) between 1 and 128
    )
  )
  and (not view_once or message_type in ('voice','image','file'))
  and (
    reply_to_id is null
    or private.is_message_reply_target_valid(reply_to_id,sender_id,recipient_id)
  )
  and exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = (select auth.uid()) and c.recipient_id = messages.recipient_id)
        or
        (c.recipient_id = (select auth.uid()) and c.requester_id = messages.recipient_id)
      )
  )
);

commit;