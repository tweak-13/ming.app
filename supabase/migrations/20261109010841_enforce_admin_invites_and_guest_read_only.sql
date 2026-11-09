create or replace function private.rotate_ming_space_invite(
  p_space_id uuid,
  p_ttl_hours integer default 24,
  p_max_uses integer default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_actor_role text;
  v_code text;
  v_hash text;
  v_version integer;
  v_invite public.ming_space_invites;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.role into v_actor_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  if v_actor_role not in ('owner','admin') or v_actor_role is null then
    raise exception 'Only the creator or an approved admin can regenerate the invitation.';
  end if;
  update public.ming_space_invites set revoked=true where space_id=p_space_id and revoked=false;
  select coalesce(max(version),0)+1 into v_version from public.ming_space_invites where space_id=p_space_id;
  v_code := upper(
    substr(md5(random()::text || clock_timestamp()::text || v_user::text),1,4)
    || '-' || substr(md5(random()::text || clock_timestamp()::text || p_space_id::text),1,4)
  );
  v_hash := encode(extensions.digest(v_code,'sha256'),'hex');
  insert into public.ming_space_invites(space_id,code_hash,hint,expires_at,max_uses,version)
  values(
    p_space_id,v_hash,right(v_code,2),
    case when coalesce(p_ttl_hours,24)>0 then now()+make_interval(hours=>coalesce(p_ttl_hours,24)) else null end,
    p_max_uses,v_version
  ) returning * into v_invite;
  return jsonb_build_object(
    'code',v_code,
    'invite',jsonb_build_object(
      'id',v_invite.id,'codeHash',v_invite.code_hash,'hint',v_invite.hint,
      'createdAt',v_invite.created_at,'expiresAt',v_invite.expires_at,
      'maxUses',v_invite.max_uses,'uses',v_invite.uses,'revoked',v_invite.revoked,
      'version',v_invite.version
    )
  );
end;
$function$;
revoke all on function private.rotate_ming_space_invite(uuid,integer,integer) from public, anon;
grant execute on function private.rotate_ming_space_invite(uuid,integer,integer) to authenticated;

create or replace function public.rotate_ming_space_invite(
  p_space_id uuid,
  p_ttl_hours integer default 24,
  p_max_uses integer default null
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.rotate_ming_space_invite(p_space_id,p_ttl_hours,p_max_uses);
$function$;
revoke all on function public.rotate_ming_space_invite(uuid,integer,integer) from public, anon;
grant execute on function public.rotate_ming_space_invite(uuid,integer,integer) to authenticated;

create or replace function private.create_ming_space_content(
  p_space_id uuid,p_kind text,p_payload jsonb default '{}'::jsonb
)
returns public.ming_space_content
language plpgsql security definer set search_path = ''
as $function$
declare v_row public.ming_space_content; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=(select auth.uid()) and m.approved=true;
  if v_role is null then raise exception 'Approved membership in this Space is required.'; end if;
  if v_role='guest' then raise exception 'Guest members have read-only access in this Space.'; end if;
  insert into public.ming_space_content(space_id,author_id,kind,payload)
  values(p_space_id,(select auth.uid()),btrim(p_kind),coalesce(p_payload,'{}'::jsonb))
  returning * into v_row;
  return v_row;
end;
$function$;
revoke all on function private.create_ming_space_content(uuid,text,jsonb) from public, anon;
grant execute on function private.create_ming_space_content(uuid,text,jsonb) to authenticated;

create or replace function public.create_ming_space_content(
  p_space_id uuid,p_kind text,p_payload jsonb default '{}'::jsonb
)
returns public.ming_space_content
language sql security invoker set search_path = ''
as $function$
  select private.create_ming_space_content(p_space_id,p_kind,p_payload);
$function$;
revoke all on function public.create_ming_space_content(uuid,text,jsonb) from public, anon;
grant execute on function public.create_ming_space_content(uuid,text,jsonb) to authenticated;

create or replace function private.record_ming_space_file(
  p_space_id uuid,p_storage_path text,p_filename text,p_content_type text,
  p_size_bytes bigint default 0,p_kind text default 'file',
  p_content_id uuid default null,p_product_id uuid default null
)
returns public.ming_space_files
language plpgsql security definer set search_path = ''
as $function$
declare v_row public.ming_space_files; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=(select auth.uid()) and m.approved=true;
  if v_role is null then raise exception 'Approved membership in this Space is required.'; end if;
  if v_role='guest' then raise exception 'Guest members have read-only access in this Space.'; end if;
  insert into public.ming_space_files(
    space_id,owner_id,content_id,product_id,storage_path,filename,content_type,size_bytes,kind
  )
  values(
    p_space_id,(select auth.uid()),p_content_id,p_product_id,p_storage_path,p_filename,
    coalesce(p_content_type,'application/octet-stream'),coalesce(p_size_bytes,0),coalesce(p_kind,'file')
  ) returning * into v_row;
  return v_row;
end;
$function$;
revoke all on function private.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) from public, anon;
grant execute on function private.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) to authenticated;

create or replace function public.record_ming_space_file(
  p_space_id uuid,p_storage_path text,p_filename text,p_content_type text,
  p_size_bytes bigint default 0,p_kind text default 'file',
  p_content_id uuid default null,p_product_id uuid default null
)
returns public.ming_space_files
language sql security invoker set search_path = ''
as $function$
  select private.record_ming_space_file(
    p_space_id,p_storage_path,p_filename,p_content_type,p_size_bytes,p_kind,p_content_id,p_product_id
  );
$function$;
revoke all on function public.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) from public, anon;
grant execute on function public.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) to authenticated;
