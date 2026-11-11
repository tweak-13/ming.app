-- Tweaklr message view-once media: global, irreversible one-time access.
-- Run after the message and attachment migrations.

alter table public.messages
  add column if not exists view_once boolean not null default false,
  add column if not exists viewed_at timestamptz;

create index if not exists messages_view_once_unopened_idx
  on public.messages(id, recipient_id)
  where view_once = true and viewed_at is null;

-- Exactly one participant (sender OR recipient) can atomically claim the media.
-- The claim is permanent and occurs before the Edge Function streams any bytes.
create or replace function public.ming_claim_view_once_media(p_message_id uuid)
returns table(bucket_id text, object_path text, media_kind text, claimed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  return query
  update public.messages as m
     set viewed_at = now()
   where m.id = p_message_id
     and m.view_once is true
     and m.viewed_at is null
     and (m.sender_id = v_user or m.recipient_id = v_user)
     and m.message_type in ('image', 'file', 'voice')
     and case when m.message_type = 'voice' then m.voice_path else m.attachment_path end is not null
   returning
     case when m.message_type = 'voice' then 'ming-voice' else 'ming-message-files' end,
     case when m.message_type = 'voice' then m.voice_path else m.attachment_path end,
     m.message_type,
     m.viewed_at;

  if not found then
    raise exception 'This media has already been opened or is unavailable';
  end if;
end;
$function$;

revoke all on function public.ming_claim_view_once_media(uuid) from public, anon;
grant execute on function public.ming_claim_view_once_media(uuid) to authenticated;

-- Retire the former metadata preflight RPC; it is not a media-delivery path.
revoke all on function public.get_ming_view_once_media(uuid) from public, anon, authenticated;

-- View-once objects are never directly readable through Storage, including by
-- the uploader. The authenticated Edge Function streams them only after claim.
drop policy if exists "Ming voice read" on storage.objects;
create policy "Ming voice read" on storage.objects
for select to authenticated
using (
  bucket_id = 'ming-voice'
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (
        select 1 from public.messages m
        where m.voice_path = objects.name
          and m.view_once is true
      )
    )
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
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (
        select 1 from public.messages m
        where m.attachment_path = objects.name
          and m.view_once is true
      )
    )
    or exists (
      select 1 from public.messages m
      where m.attachment_path = objects.name
        and m.view_once is not true
        and (m.sender_id = (select auth.uid()) or m.recipient_id = (select auth.uid()))
    )
  )
);

alter table public.messages replica identity full;
