begin;

-- The UI supports 50 MB attachments and these MIME types. The previous
-- bucket limit (15 MB) and allow-list rejected videos and HEIC/HEIF files.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
      'video/mp4','video/webm','video/quicktime','video/x-m4v',
      'application/pdf','text/plain','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
where id = 'ming-message-files';

-- File messages are valid empty-body media messages just like image messages.
alter table public.messages drop constraint if exists messages_body_type_check;
alter table public.messages add constraint messages_body_type_check
check (
  (message_type = 'text' and char_length(trim(body)) between 1 and 2000)
  or (message_type in ('voice','image','file') and char_length(body) = 0)
);

alter table public.messages drop constraint if exists messages_attachment_size_check;
alter table public.messages add constraint messages_attachment_size_check
check (attachment_size is null or attachment_size between 0 and 52428800);

-- Direct inserts are used for view-once media. Grant only the fields the
-- composer can legitimately write, including attachment metadata.
revoke insert on table public.messages from public, anon, authenticated;
grant insert (
  sender_id, recipient_id, body, message_type,
  voice_path, voice_duration, reply_to_id, view_once,
  attachment_path, attachment_name, attachment_mime, attachment_size
) on public.messages to authenticated;

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
      and view_once = false
    )
    or
    (
      message_type = 'voice'
      and body = ''
      and voice_path like (select auth.uid())::text || '/%'
      and attachment_path is null
      and voice_duration between 1 and 3600
    )
    or
    (
      message_type in ('image','file')
      and body = ''
      and attachment_path like (select auth.uid())::text || '/%'
      and voice_path is null
      and (attachment_size is null or attachment_size <= 52428800)
      and (attachment_name is null or char_length(attachment_name) <= 255)
      and (attachment_mime is null or char_length(attachment_mime) <= 128)
    )
  )
  and (not view_once or message_type in ('voice','image','file'))
  and (
    reply_to_id is null
    or exists (
      select 1 from public.messages m
      where m.id = messages.reply_to_id
        and (
          (m.sender_id = (select auth.uid()) and m.recipient_id = messages.recipient_id)
          or
          (m.sender_id = messages.recipient_id and m.recipient_id = (select auth.uid()))
        )
    )
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
set search_path = ''
as $function$
declare
  v_sender_id uuid := (select auth.uid());
  v_message public.messages;
begin
  if v_sender_id is null then raise exception 'Not authenticated'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then raise exception 'Invalid recipient'; end if;
  if private.tweaklr_is_blocked(p_recipient_id) then raise exception 'This user is blocked'; end if;
  if not public.ming_users_are_connected(v_sender_id,p_recipient_id) then raise exception 'Users are not connected'; end if;

  if p_message_type = 'text' then
    if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 then
      raise exception 'Message must be between 1 and 2000 characters';
    end if;
  elsif p_message_type = 'voice' then
    if p_voice_path is null
       or p_voice_path not like v_sender_id::text || '/%'
       or p_voice_duration is null
       or p_voice_duration not between 1 and 3600 then
      raise exception 'Voice note is invalid or does not belong to the sender';
    end if;
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

  insert into public.messages(sender_id,recipient_id,body,message_type,voice_path,voice_duration,reply_to_id)
  values(v_sender_id,p_recipient_id,coalesce(trim(p_body),''),p_message_type,p_voice_path,p_voice_duration,p_reply_to_id)
  returning * into v_message;
  return v_message;
end;
$function$;

create or replace function public.ming_send_message_v3(
  p_recipient_id uuid,
  p_body text,
  p_message_type text default 'text',
  p_voice_path text default null,
  p_voice_duration integer default null,
  p_reply_to_id uuid default null,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_attachment_mime text default null,
  p_attachment_size bigint default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sender_id uuid := (select auth.uid());
  v_message public.messages;
begin
  if v_sender_id is null then raise exception 'Not authenticated'; end if;
  if p_recipient_id is null or p_recipient_id = v_sender_id then raise exception 'Invalid recipient'; end if;
  if private.tweaklr_is_blocked(p_recipient_id) then raise exception 'This user is blocked'; end if;
  if not public.ming_users_are_connected(v_sender_id,p_recipient_id) then raise exception 'Users are not connected'; end if;

  if p_message_type = 'text' then
    if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000
       or p_attachment_path is not null or p_voice_path is not null then
      raise exception 'Text message is invalid';
    end if;
  elsif p_message_type = 'voice' then
    if p_voice_path is null
       or p_voice_path not like v_sender_id::text || '/%'
       or p_voice_duration is null
       or p_voice_duration not between 1 and 3600
       or p_attachment_path is not null then
      raise exception 'Voice note is invalid or does not belong to the sender';
    end if;
  elsif p_message_type in ('image','file') then
    if p_attachment_path is null
       or p_attachment_path not like v_sender_id::text || '/%'
       or p_voice_path is not null
       or p_attachment_size is null
       or p_attachment_size not between 0 and 52428800
       or char_length(coalesce(p_attachment_name,'')) not between 1 and 255
       or char_length(coalesce(p_attachment_mime,'')) not between 1 and 128
       or coalesce(p_body,'') <> '' then
      raise exception 'Attachment is invalid or does not belong to the sender';
    end if;
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

  insert into public.messages(
    sender_id,recipient_id,body,message_type,voice_path,voice_duration,
    reply_to_id,attachment_path,attachment_name,attachment_mime,attachment_size
  )
  values(
    v_sender_id,p_recipient_id,coalesce(trim(p_body),''),p_message_type,
    p_voice_path,p_voice_duration,p_reply_to_id,
    p_attachment_path,p_attachment_name,p_attachment_mime,p_attachment_size
  )
  returning * into v_message;
  return v_message;
end;
$function$;

revoke all on function public.ming_send_message_v2(uuid,text,text,text,integer,uuid) from public, anon;
grant execute on function public.ming_send_message_v2(uuid,text,text,text,integer,uuid) to authenticated;
revoke all on function public.ming_send_message_v3(uuid,text,text,text,integer,uuid,text,text,text,bigint) from public, anon;
grant execute on function public.ming_send_message_v3(uuid,text,text,text,integer,uuid,text,text,text,bigint) to authenticated;

commit;