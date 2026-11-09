create or replace function public.tweaklr_status_can_view(p_status public.tweaklr_statuses, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_connected boolean := false;
  v_member boolean := false;
begin
  if p_user is null then
    return false;
  end if;

  if p_status.author_id = p_user then
    return true;
  end if;

  if p_status.expires_at <= now() then
    return false;
  end if;

  -- A block in either direction overrides connections, selected audiences,
  -- and shared Space membership for Status visibility.
  if exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_user and b.blocked_id = p_status.author_id)
       or (b.blocker_id = p_status.author_id and b.blocked_id = p_user)
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.tweaklr_status_mutes m
    where m.user_id = p_user and m.author_id = p_status.author_id
  ) then
    return false;
  end if;

  if p_status.scope in ('friendly', 'business') then
    select exists (
      select 1
      from public.ming_space_members m
      where m.space_id = p_status.space_id
        and m.user_id = p_user
        and m.approved = true
    ) into v_member;
    if not v_member then return false; end if;
  else
    select exists (
      select 1
      from public.connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = p_user and c.recipient_id = p_status.author_id)
          or
          (c.requester_id = p_status.author_id and c.recipient_id = p_user)
        )
    ) into v_connected;
    if not v_connected then return false; end if;
  end if;

  if p_status.scope = 'main' then
    if p_status.audience = 'selected'
       and not (p_user = any(p_status.included_user_ids)) then
      return false;
    end if;
    if p_status.audience = 'except'
       and p_user = any(p_status.excluded_user_ids) then
      return false;
    end if;
  end if;

  return true;
end
$function$;

create or replace function public.toggle_tweaklr_status_mute(p_author_id uuid, p_muted boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if p_author_id is null or p_author_id = v_user then
    raise exception 'Invalid Status account';
  end if;

  if p_muted then
    insert into public.tweaklr_status_mutes(user_id, author_id)
    values (v_user, p_author_id)
    on conflict do nothing;
  else
    delete from public.tweaklr_status_mutes
    where user_id = v_user and author_id = p_author_id;
  end if;

  return p_muted;
end
$function$;

revoke all on function public.tweaklr_status_can_view(public.tweaklr_statuses, uuid) from public, anon, authenticated;
revoke all on function public.toggle_tweaklr_status_mute(uuid, boolean) from public, anon;
grant execute on function public.toggle_tweaklr_status_mute(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
