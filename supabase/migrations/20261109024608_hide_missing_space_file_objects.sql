begin;

create or replace function public.get_my_ming_space_files()
returns setof public.ming_space_files
language sql
stable
security definer
set search_path = ''
as $function$
  select f.*
  from public.ming_space_files f
  where exists (
    select 1 from public.ming_space_members m
    where m.space_id=f.space_id
      and m.user_id=(select auth.uid())
      and m.approved=true
  )
  and exists (
    select 1 from storage.objects o
    where o.bucket_id='ming-space-media'
      and o.name=f.storage_path
  )
  order by f.created_at desc;
$function$;

commit;