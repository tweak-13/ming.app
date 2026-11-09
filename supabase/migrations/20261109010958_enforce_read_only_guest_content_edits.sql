create or replace function private.update_ming_space_content(p_id uuid, p_payload jsonb)
returns public.ming_space_content
language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.ming_space_content;
  v_space_id uuid;
  v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select c.space_id into v_space_id from public.ming_space_content c where c.id=p_id;
  if not found then raise exception 'Content not found or not permitted.'; end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=v_space_id and m.user_id=(select auth.uid()) and m.approved=true;
  if v_role is null then raise exception 'Approved membership in this Space is required.'; end if;
  if v_role='guest' then raise exception 'Guest members have read-only access in this Space.'; end if;
  update public.ming_space_content c
  set payload=coalesce(p_payload,'{}'::jsonb),updated_at=now()
  where c.id=p_id and (
    c.author_id=(select auth.uid())
    or exists(select 1 from public.ming_spaces s where s.id=c.space_id and s.owner_id=(select auth.uid()))
  )
  returning * into v_row;
  if not found then raise exception 'Content not found or not permitted.'; end if;
  return v_row;
end;
$function$;
revoke all on function private.update_ming_space_content(uuid,jsonb) from public, anon;
grant execute on function private.update_ming_space_content(uuid,jsonb) to authenticated;

create or replace function public.update_ming_space_content(p_id uuid,p_payload jsonb)
returns public.ming_space_content
language sql security invoker set search_path = ''
as $function$
  select private.update_ming_space_content(p_id,p_payload);
$function$;
revoke all on function public.update_ming_space_content(uuid,jsonb) from public, anon;
grant execute on function public.update_ming_space_content(uuid,jsonb) to authenticated;
