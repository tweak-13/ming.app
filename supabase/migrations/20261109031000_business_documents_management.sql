-- Tweaklr Business Documents management: additive and data-preserving.
begin;
alter table public.ming_space_files add column if not exists display_name text;
alter table public.ming_space_files add column if not exists category text not null default 'General';
update public.ming_space_files set display_name=filename where display_name is null or btrim(display_name)='';
alter table public.ming_space_files alter column display_name set default '';
create or replace function public.update_ming_space_file_details(p_file_id uuid,p_display_name text,p_category text default 'General')
returns public.ming_space_files language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_file public.ming_space_files; v_role text; v_name text:=left(btrim(coalesce(p_display_name,'')),120); v_category text:=coalesce(p_category,'General');
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if v_name='' then raise exception 'Document name is required'; end if;
 if v_category not in ('General','Contracts','Finance','Design','Reports','Policies','Other') then raise exception 'Choose a valid document category'; end if;
 select f.* into v_file from public.ming_space_files f where f.id=p_file_id for update;
 if not found then raise exception 'Document not found'; end if;
 select m.role into v_role from public.ming_space_members m where m.space_id=v_file.space_id and m.user_id=v_user and m.approved=true;
 if not found then raise exception 'You are not an approved member of this Space'; end if;
 if v_file.owner_id<>v_user and v_role not in ('owner','admin','manager') then raise exception 'Only the uploader or a Space manager can edit document details'; end if;
 update public.ming_space_files set display_name=v_name,category=v_category where id=p_file_id returning * into v_file; return v_file;
end; $$;
create or replace function public.delete_ming_space_file(p_file_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_file public.ming_space_files;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 select f.* into v_file from public.ming_space_files f where f.id=p_file_id for update;
 if not found then raise exception 'Document not found'; end if;
 if v_file.owner_id<>v_user then raise exception 'Only the person who uploaded this document can delete it'; end if;
 if not exists(select 1 from public.ming_space_members m where m.space_id=v_file.space_id and m.user_id=v_user and m.approved=true) then raise exception 'You are not an approved member of this Space'; end if;
 delete from public.ming_space_files where id=p_file_id; return true;
end; $$;
revoke all on function public.update_ming_space_file_details(uuid,text,text) from public,anon;
revoke all on function public.delete_ming_space_file(uuid) from public,anon;
grant execute on function public.update_ming_space_file_details(uuid,text,text) to authenticated;
grant execute on function public.delete_ming_space_file(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
