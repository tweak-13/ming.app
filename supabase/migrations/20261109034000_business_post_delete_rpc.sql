begin;
create or replace function public.delete_ming_business_space_post(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_space_id uuid;
  v_author_id uuid;
  v_role text;
  v_kind text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select c.space_id, c.author_id, c.kind into v_space_id, v_author_id, v_kind
  from public.ming_space_content c
  where c.id = p_content_id;

  if v_space_id is null then raise exception 'Post not found'; end if;
  if v_kind <> 'business_post' then raise exception 'Only Business Home posts can be moderated here'; end if;

  select m.role into v_role
  from public.ming_space_members m
  join public.ming_spaces s on s.id = m.space_id
  where m.space_id = v_space_id and m.user_id = v_actor
    and m.approved = true and s.nature = 'business';

  if v_role is null then raise exception 'Approved Business Space membership required'; end if;
  if v_actor <> v_author_id and v_role not in ('owner','admin','manager') then
    raise exception 'Only the post author, creator, or an admin can remove this post';
  end if;

  delete from public.ming_space_content where id = p_content_id;
  return jsonb_build_object('ok', true, 'deleted_id', p_content_id);
end;
$function$;
revoke all on function public.delete_ming_business_space_post(uuid) from public, anon, authenticated;
grant execute on function public.delete_ming_business_space_post(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
