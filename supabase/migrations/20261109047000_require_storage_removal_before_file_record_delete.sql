begin;

create or replace function public.delete_ming_space_file(p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_file public.ming_space_files;
  v_role text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select f.* into v_file from public.ming_space_files f where f.id=p_file_id for update;
  if not found then raise exception 'Document not found'; end if;

  select m.role into v_role from public.ming_space_members m
  where m.space_id=v_file.space_id and m.user_id=v_user and m.approved=true;
  if v_role is null then raise exception 'You are not an approved member of this Space'; end if;
  if v_file.owner_id<>v_user and v_role not in ('owner','admin','manager') then
    raise exception 'Only the uploader or a Space manager can delete this file';
  end if;

  -- Require the authenticated Storage API deletion to happen first. This
  -- prevents direct RPC calls from leaving untracked objects in the bucket.
  if exists(
    select 1 from storage.objects o
    where o.bucket_id='ming-space-media' and o.name=v_file.storage_path
  ) then
    raise exception 'Remove the Storage object before deleting its file record';
  end if;

  delete from public.ming_space_files where id=p_file_id;
  return true;
end;
$function$;

commit;