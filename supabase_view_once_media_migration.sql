-- Tweaklr message view-once media: global, irreversible one-time access.
-- Run after the message and attachment migrations.

alter table public.messages
  add column if not exists view_once boolean not null default false,
  add column if not exists viewed_at timestamptz;

create index if not exists messages_view_once_unopened_idx
  on public.messages(id, recipient_id)
  where view_once = true and viewed_at is null;

create schema if not exists private;

create table if not exists private.message_view_once_consumed (
  bucket_id text not null,
  object_path text not null,
  message_id uuid not null,
  sender_id uuid not null,
  recipient_id uuid not null,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  primary key (bucket_id, object_path)
);

alter table private.message_view_once_consumed enable row level security;
revoke all on private.message_view_once_consumed from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_message_view_once_consumed(
  p_bucket_id text,
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from private.message_view_once_consumed c
    where c.bucket_id = p_bucket_id and c.object_path = p_object_path
  );
$function$;

revoke all on function private.is_message_view_once_consumed(text,text) from public, anon;
grant execute on function private.is_message_view_once_consumed(text,text) to authenticated;

-- Exactly one participant (sender OR recipient) can atomically claim the media.
create or replace function public.ming_claim_view_once_media(p_message_id uuid)
returns table(bucket_id text, object_path text, media_kind text, claimed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_bucket text;
  v_path text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  update public.messages as m
     set viewed_at = now()
   where m.id = p_message_id
     and m.view_once is true
     and m.viewed_at is null
     and (m.sender_id = v_user or m.recipient_id = v_user)
     and m.message_type in ('image', 'file', 'voice')
     and case when m.message_type = 'voice' then m.voice_path else m.attachment_path end is not null
  returning m.* into v_message;

  if not found then
    raise exception 'This media has already been opened or is unavailable';
  end if;

  v_bucket := case when v_message.message_type = 'voice' then 'ming-voice' else 'ming-message-files' end;
  v_path := case when v_message.message_type = 'voice' then v_message.voice_path else v_message.attachment_path end;

  insert into private.message_view_once_consumed (
    bucket_id, object_path, message_id, sender_id, recipient_id, opened_by, opened_at
  ) values (
    v_bucket, v_path, v_message.id, v_message.sender_id, v_message.recipient_id, v_user, v_message.viewed_at
  );

  return query select v_bucket, v_path, v_message.message_type, v_message.viewed_at;
end;
$function$;

revoke all on function public.ming_claim_view_once_media(uuid) from public, anon;
grant execute on function public.ming_claim_view_once_media(uuid) to authenticated;

-- Retire the former metadata preflight RPC; it is not a media-delivery path.
revoke all on function public.get_ming_view_once_media(uuid) from public, anon, authenticated;

-- View-once objects are never directly readable through Storage, even by the
-- uploader. The Edge Function streams them once, then deletes the stored source.
drop policy if exists "Ming voice read" on storage.objects;
create policy "Ming voice read" on storage.objects
for select to authenticated
using (
  bucket_id = 'ming-voice'
  and not private.is_message_view_once_consumed('ming-voice', objects.name)
  and not exists (
    select 1 from public.messages m
    where m.voice_path = objects.name and m.view_once is true
  )
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
      where m.voice_path = objects.name
        and m.view_once is not true
        and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
    )
  )
);

drop policy if exists "Ming message files read" on storage.objects;
create policy "Ming message files read" on storage.objects
for select to authenticated
using (
  bucket_id = 'ming-message-files'
  and not private.is_message_view_once_consumed('ming-message-files', objects.name)
  and not exists (
    select 1 from public.messages m
    where m.attachment_path = objects.name and m.view_once is true
  )
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
      where m.attachment_path = objects.name
        and m.view_once is not true
        and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
    )
  )
);

alter table public.messages replica identity full;
