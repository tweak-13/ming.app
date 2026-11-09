begin;

create or replace function private.set_ming_space_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.ming_space_members
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ming_space_members;
  v_nature text;
  v_actor uuid := (select auth.uid());
  v_actor_role text;
  v_target_role text;
  v_allowed text[];
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_user_id = v_actor then raise exception 'You cannot change your own Space role.'; end if;

  select s.nature into v_nature
  from public.ming_spaces s
  where s.id = p_space_id
  for update;
  if not found then raise exception 'Space not found.'; end if;

  select m.role into v_actor_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = v_actor and m.approved = true;
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Only the creator or an approved admin can manage Space roles.';
  end if;

  select m.role into v_target_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = p_user_id
  for update;
  if not found then raise exception 'Member not found.'; end if;
  if v_target_role = 'owner' then raise exception 'The owner role cannot be reassigned.'; end if;
  if v_actor_role = 'admin' and (v_target_role = 'admin' or p_role = 'admin') then
    raise exception 'Only the creator can appoint or change an admin.';
  end if;

  v_allowed := case v_nature
    when 'business' then array['admin','manager','member']
    when 'friendly' then array['admin','moderator','member']
    when 'casual' then array['admin','moderator','member','guest']
    when 'anonymous' then array['admin','moderator','member']
    when 'silly' then array['admin','moderator','member']
    when 'romantic' then array['member']
    when 'marketplace' then array['admin','moderator','seller','buyer']
    else array[]::text[]
  end;
  if not (p_role = any(v_allowed)) then
    raise exception 'That role is not available in this Space.';
  end if;

  update public.ming_space_members
  set role = p_role
  where space_id = p_space_id and user_id = p_user_id
  returning * into v_row;
  return v_row;
end;
$function$;

commit;