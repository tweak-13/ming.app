-- Tweaklr View Once media support (messages only)
-- Run after supabase_message_extras.sql and supabase_message_attachments.sql.

alter table public.messages
  add column if not exists view_once boolean not null default false,
  add column if not exists viewed_at timestamptz;

create index if not exists messages_view_once_unopened_idx
  on public.messages(id, recipient_id) where view_once = true and viewed_at is null;

-- Only the intended recipient may claim a view-once message, and only once.
-- The Edge Function uses the returned path with its service-role storage client.
create or replace function public.ming_claim_view_once_media(p_message_id uuid)
returns table(bucket_id text, object_path text, media_kind text, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  return query
  update public.messages m
     set viewed_at = now()
   where m.id = p_message_id
     and m.recipient_id = v_user
     and m.view_once = true
     and m.viewed_at is null
     and m.message_type in ('image','file','voice')
   returning
     case when m.message_type = 'voice' then 'ming-voice' else 'ming-message-files' end,
     case when m.message_type = 'voice' then m.voice_path else m.attachment_path end,
     m.message_type,
     m.viewed_at;
  if not found then raise exception 'This media has already been opened or is unavailable'; end if;
end;
$$;

revoke all on function public.ming_claim_view_once_media(uuid) from public;
grant execute on function public.ming_claim_view_once_media(uuid) to authenticated;

-- Keep recipients from creating ordinary signed URLs for view-once media.
-- The Edge Function is the only recipient delivery path for those messages.
drop policy if exists "Ming voice read" on storage.objects;
create policy "Ming voice read" on storage.objects for select to authenticated
using (
  bucket_id = 'ming-voice'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
      where m.voice_path = name
        and m.sender_id = (select auth.uid())
    )
    or exists (
      select 1 from public.messages m
      where m.voice_path = name
        and m.recipient_id = (select auth.uid())
        and (m.view_once = false or m.view_once is null)
    )
  )
);

drop policy if exists "Ming message files read" on storage.objects;
create policy "Ming message files read" on storage.objects for select to authenticated
using (
  bucket_id = 'ming-message-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.messages m
      where m.attachment_path = name
        and m.sender_id = (select auth.uid())
    )
    or exists (
      select 1 from public.messages m
      where m.attachment_path = name
        and m.recipient_id = (select auth.uid())
        and (m.view_once = false or m.view_once is null)
    )
  )
);
