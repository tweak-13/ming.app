begin;

alter table public.ming_call_invites
  add column if not exists push_sent_at timestamptz;

-- The browser may create an invite, read its own participant rows and update
-- only the status fields required by the call UI. Identity, SDP offer,
-- expiry and server push state are immutable to client roles.
revoke all on table public.ming_call_invites from public, anon, authenticated;
grant select on public.ming_call_invites to authenticated;
grant insert (call_id, caller_id, recipient_id, kind, offer, status, expires_at)
  on public.ming_call_invites to authenticated;
grant update (status, updated_at)
  on public.ming_call_invites to authenticated;

alter policy "Ming call invites insert"
on public.ming_call_invites
with check (
  caller_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and status = 'pending'
  and expires_at > now()
  and expires_at <= now() + interval '2 minutes'
  and exists (
    select 1
    from public.connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = (select auth.uid()) and c.recipient_id = ming_call_invites.recipient_id)
        or
        (c.recipient_id = (select auth.uid()) and c.requester_id = ming_call_invites.recipient_id)
      )
  )
);

create or replace function public.guard_ming_call_invite_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if new.id is distinct from old.id
     or new.call_id is distinct from old.call_id
     or new.caller_id is distinct from old.caller_id
     or new.recipient_id is distinct from old.recipient_id
     or new.kind is distinct from old.kind
     or new.offer is distinct from old.offer
     or new.expires_at is distinct from old.expires_at
     or new.push_sent_at is distinct from old.push_sent_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Call invitation identity and offer details cannot be changed';
  end if;

  if old.status = 'pending' and new.status in ('accepted','declined') then
    if v_user <> old.recipient_id then
      raise exception 'Only the invited recipient can accept or decline this call';
    end if;
    if old.expires_at <= now() then
      raise exception 'This call invitation has expired';
    end if;
  elsif old.status in ('pending','accepted') and new.status = 'ended' then
    if v_user not in (old.caller_id,old.recipient_id) then
      raise exception 'Only a call participant can end this call';
    end if;
  else
    raise exception 'Invalid call invitation status transition';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists guard_ming_call_invite_status_update on public.ming_call_invites;
create trigger guard_ming_call_invite_status_update
before update of status on public.ming_call_invites
for each row execute function public.guard_ming_call_invite_status_update();

revoke all on function public.guard_ming_call_invite_status_update() from public, anon, authenticated;

commit;