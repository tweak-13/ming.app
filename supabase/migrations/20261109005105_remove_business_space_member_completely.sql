create or replace function public.remove_ming_business_space_member(
  p_space_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_nature text;
  v_actor_role text;
  v_target_role text;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select s.nature
    into v_nature
  from public.ming_spaces s
  where s.id = p_space_id
  for update;

  if not found or v_nature <> 'business' then
    raise exception 'Business Space not found.';
  end if;

  select m.role
    into v_actor_role
  from public.ming_space_members m
  where m.space_id = p_space_id
    and m.user_id = v_actor
    and m.approved = true;

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'Only the creator or an approved admin can remove members.';
  end if;

  select m.role
    into v_target_role
  from public.ming_space_members m
  where m.space_id = p_space_id
    and m.user_id = p_user_id
  for update;

  if not found then
    raise exception 'This person is no longer a member of the Space.';
  end if;

  if v_target_role = 'owner' then
    raise exception 'The Space creator cannot be removed.';
  end if;

  delete from public.ming_space_members
  where space_id = p_space_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'space_id', p_space_id,
    'user_id', p_user_id,
    'removed', true
  );
end;
$function$;

revoke all on function public.remove_ming_business_space_member(uuid, uuid) from public;
revoke all on function public.remove_ming_business_space_member(uuid, uuid) from anon;
grant execute on function public.remove_ming_business_space_member(uuid, uuid) to authenticated;
