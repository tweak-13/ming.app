begin;

create or replace function public.get_ming_view_once_media(p_message_id uuid)
returns table(bucket_id text, object_path text, media_kind text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  return query
  select
    case when m.message_type = 'voice' then 'ming-voice' else 'ming-message-files' end,
    case when m.message_type = 'voice' then m.voice_path else m.attachment_path end,
    m.message_type
  from public.messages m
  where m.id = p_message_id
    and m.recipient_id = v_user
    and m.view_once = true
    and m.viewed_at is null
    and m.message_type in ('image','file','voice')
    and case when m.message_type = 'voice' then m.voice_path else m.attachment_path end is not null;

  if not found then
    raise exception 'This media has already been opened or is unavailable';
  end if;
end;
$function$;

revoke all on function public.get_ming_view_once_media(uuid) from public, anon, authenticated;
grant execute on function public.get_ming_view_once_media(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;