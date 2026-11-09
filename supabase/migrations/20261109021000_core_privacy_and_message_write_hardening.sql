begin;

-- Profiles are discoverable only when the owner has enabled discovery, or
-- through the existing membership/connection-aware SECURITY DEFINER RPCs.
drop policy if exists "Users can view profiles" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;

-- Remove the weaker duplicate invitation policies. The remaining INSERT
-- policy requires both the authenticated caller and an accepted connection.
drop policy if exists "Ming call invites insert caller" on public.ming_call_invites;
drop policy if exists "Ming call invites select own calls" on public.ming_call_invites;
drop policy if exists "Ming call invites update participants" on public.ming_call_invites;

-- Message edits are handled by ming_edit_message(). Direct UPDATE is limited
-- to the single read receipt column used by markMingConversationRead().
drop policy if exists "Senders can edit their own text messages within one hour" on public.messages;
revoke update on table public.messages from public, anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

-- Preserve the existing direct-send fallback, but do not allow clients to
-- insert server-managed timestamps, IDs, read receipts or attachment metadata.
revoke insert on table public.messages from public, anon, authenticated;
grant insert (sender_id, recipient_id, body, message_type, voice_path,
              voice_duration, reply_to_id, view_once)
on table public.messages to authenticated;

-- Harden the message-edit SECURITY DEFINER function against search_path
-- shadowing while preserving its existing sender/one-hour/text-only checks.
create or replace function public.ming_edit_message(p_message_id uuid,p_body text)
returns table(id uuid,body text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 then
    raise exception 'Message must be between 1 and 2000 characters';
  end if;

  return query
  update public.messages m
  set body = trim(p_body)
  where m.id = p_message_id
    and m.sender_id = v_user
    and m.message_type = 'text'
    and m.attachment_path is null
    and m.voice_path is null
    and m.created_at <= now()
    and m.created_at >= now() - interval '1 hour'
  returning m.id,m.body;

  if not found then
    raise exception 'Message is not yours, is not editable text, or is outside the 1-hour limit';
  end if;
end;
$function$;

revoke all on function public.ming_edit_message(uuid,text) from public,anon;
grant execute on function public.ming_edit_message(uuid,text) to authenticated;

commit;