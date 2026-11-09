begin;

-- Enforce Space nature, feature switches and roles in the database. The
-- browser's composer list is not an authorization boundary.
create or replace function public.enforce_ming_business_post_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_allowed text[];
  v_feature_key text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if new.author_id is distinct from v_user then
    raise exception 'Space content must be authored by the signed-in member';
  end if;
  if jsonb_typeof(coalesce(new.payload,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(new.payload,'{}'::jsonb)::text) > 65536 then
    raise exception 'Space content payload is invalid or too large';
  end if;

  select s.* into v_space
  from public.ming_spaces s
  where s.id = new.space_id;
  if not found then raise exception 'Space not found'; end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = new.space_id
    and m.user_id = v_user
    and m.approved = true;
  if v_role is null or v_role = 'guest' then
    raise exception 'Approved, write-enabled Space membership is required';
  end if;

  v_allowed := case v_space.nature
    when 'business' then array['business_post','doc','announcement','task']
    when 'friendly' then array['friend_post','moment','poll','event','memory']
    when 'casual' then array['now','answer','event','meeting','poll']
    when 'romantic' then array['memory','love_letter','plan','milestone','nickname','health','list']
    else array[]::text[]
  end;
  if not (new.kind = any(v_allowed)) then
    raise exception 'That content type is not available in this Space';
  end if;

  v_feature_key := case
    when v_space.nature = 'business' and new.kind = 'doc' then 'documents'
    when v_space.nature = 'business' and new.kind = 'announcement' then 'announcements'
    when v_space.nature = 'business' and new.kind = 'task' then 'tasks'
    when v_space.nature = 'friendly' and new.kind in ('friend_post','moment') then 'moments'
    when v_space.nature = 'friendly' and new.kind = 'poll' then 'polls'
    when v_space.nature = 'friendly' and new.kind = 'event' then 'events'
    when v_space.nature = 'friendly' and new.kind = 'memory' then 'memories'
    when v_space.nature = 'casual' and new.kind in ('now','answer') then 'now'
    when v_space.nature = 'casual' and new.kind = 'poll' then 'polls'
    when v_space.nature = 'casual' and new.kind in ('event','meeting') then 'meet'
    when v_space.nature = 'romantic' and new.kind = 'memory' then 'memories'
    when v_space.nature = 'romantic' and new.kind = 'plan' then 'plans'
    when v_space.nature = 'romantic' and new.kind = 'milestone' then 'milestones'
    when v_space.nature = 'romantic' and new.kind = 'love_letter' then 'loveletter'
    when v_space.nature = 'romantic' and new.kind in ('nickname','list') then 'lists'
    else null
  end;

  if v_feature_key is not null
     and coalesce((v_space.features->>v_feature_key)::boolean,true) = false then
    raise exception 'This feature is disabled by the Space owner';
  end if;

  if v_space.nature = 'business' then
    if new.kind = 'business_post'
       and coalesce(v_space.features->>'businessMessaging','everyone') = 'owner'
       and v_role <> 'owner' then
      raise exception 'Only the Space creator can publish Business posts';
    end if;
    if new.kind in ('doc','announcement','task')
       and v_role not in ('owner','admin','manager') then
      raise exception 'Only the creator, admins or managers can publish this Business content';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists ming_business_post_policy_guard on public.ming_space_content;
create trigger ming_business_post_policy_guard
before insert on public.ming_space_content
for each row execute function public.enforce_ming_business_post_policy();

revoke all on function public.enforce_ming_business_post_policy() from public,anon,authenticated;

create or replace function private.update_ming_space_content(p_id uuid,p_payload jsonb)
returns public.ming_space_content
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ming_space_content;
  v_space_id uuid;
  v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_payload,'{}'::jsonb)::text) > 65536 then
    raise exception 'Space content payload is invalid or too large';
  end if;

  select c.space_id into v_space_id
  from public.ming_space_content c where c.id = p_id;
  if not found then raise exception 'Content not found or not permitted.'; end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = v_space_id
    and m.user_id = (select auth.uid())
    and m.approved = true;
  if v_role is null then raise exception 'Approved membership in this Space is required.'; end if;
  if v_role = 'guest' then raise exception 'Guest members have read-only access in this Space.'; end if;

  update public.ming_space_content c
  set payload = coalesce(p_payload,'{}'::jsonb), updated_at = now()
  where c.id = p_id
    and (
      c.author_id = (select auth.uid())
      or exists (
        select 1 from public.ming_spaces s
        where s.id = c.space_id and s.owner_id = (select auth.uid())
      )
    )
  returning * into v_row;

  if not found then raise exception 'Content not found or not permitted.'; end if;
  return v_row;
end;
$function$;

-- Open Roles are only available when the Business Space owner has enabled
-- the opportunities feature.
create or replace function public.create_ming_space_open_role(
  p_space_id uuid,p_title text,p_employment_type text,p_work_mode text,
  p_location text,p_department text,p_description text,p_responsibilities text[],
  p_required_skills text[],p_compensation text,p_application_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_rank integer;
  v_row public.ming_space_open_roles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select s.* into v_space from public.ming_spaces s
    where s.id=p_space_id and s.nature='business';
  if not found then raise exception 'Business Space not found'; end if;
  if coalesce((v_space.features->>'opportunities')::boolean,true)=false then
    raise exception 'Open Roles are disabled in this Business Space';
  end if;

  select m.role into v_role from public.ming_space_members m
    where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank < 60 then raise exception 'Only an owner, admin, or manager can manage Open Roles'; end if;

  if char_length(btrim(coalesce(p_title,''))) not between 2 and 100 then raise exception 'Enter a role title between 2 and 100 characters'; end if;
  if p_employment_type not in ('full-time','part-time','contract','internship','temporary','volunteer') then raise exception 'Invalid employment type'; end if;
  if p_work_mode not in ('remote','hybrid','on-site') then raise exception 'Invalid work mode'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Enter a role description'; end if;
  if char_length(coalesce(p_location,''))>120 or char_length(coalesce(p_department,''))>100 or char_length(coalesce(p_compensation,''))>160 then raise exception 'One or more fields are too long'; end if;
  if p_application_deadline is not null and p_application_deadline <= now() then raise exception 'Application deadline must be in the future'; end if;

  insert into public.ming_space_open_roles(space_id,created_by,title,employment_type,work_mode,location,department,description,responsibilities,required_skills,compensation,application_deadline,status)
  values(p_space_id,v_user,btrim(p_title),p_employment_type,p_work_mode,btrim(coalesce(p_location,'')),btrim(coalesce(p_department,'')),btrim(p_description),coalesce(p_responsibilities,'{}'::text[]),coalesce(p_required_skills,'{}'::text[]),btrim(coalesce(p_compensation,'')),p_application_deadline,'open')
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'status',v_row.status);
end;
$function$;

create or replace function public.apply_ming_space_open_role(
  p_role_id uuid,p_introduction text,p_skills_experience text,p_portfolio_url text,p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_role public.ming_space_open_roles;
  v_space public.ming_spaces;
  v_member boolean := false;
  v_row public.ming_space_role_applications;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_introduction,''))) not between 1 and 600 then raise exception 'Add a short introduction'; end if;
  if char_length(btrim(coalesce(p_skills_experience,''))) not between 1 and 2000 then raise exception 'Describe your relevant skills and experience'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 2000 then raise exception 'Add an application message'; end if;
  if char_length(coalesce(p_portfolio_url,''))>500 then raise exception 'Portfolio or CV link is too long'; end if;
  if coalesce(btrim(p_portfolio_url),'')<>'' and btrim(p_portfolio_url)!~* '^https?://' then raise exception 'Use a full https:// or http:// link for your CV or portfolio'; end if;

  select r.* into v_role from public.ming_space_open_roles r
  where r.id=p_role_id and r.status='open' and (r.application_deadline is null or r.application_deadline>now());
  if not found then raise exception 'This role is closed or its deadline has passed'; end if;
  select s.* into v_space from public.ming_spaces s where s.id=v_role.space_id and s.nature='business';
  if not found then raise exception 'Business Space not found'; end if;
  if coalesce((v_space.features->>'opportunities')::boolean,true)=false then raise exception 'Applications are disabled in this Business Space'; end if;

  select exists(select 1 from public.ming_space_members m where m.space_id=v_role.space_id and m.user_id=v_user and m.approved=true) into v_member;
  if not v_member and not coalesce(v_space.discoverable,false) then raise exception 'Join this Business Space before applying'; end if;

  insert into public.ming_space_role_applications(role_id,applicant_id,introduction,skills_experience,portfolio_url,message)
  values(p_role_id,v_user,btrim(p_introduction),btrim(p_skills_experience),btrim(coalesce(p_portfolio_url,'')),btrim(p_message))
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'role_id',v_row.role_id,'status',v_row.status,'created_at',v_row.created_at);
end;
$function$;

create or replace function public.get_ming_space_open_roles(p_space_id uuid)
returns table(
  id uuid,space_id uuid,created_by uuid,title text,employment_type text,work_mode text,
  location text,department text,description text,responsibilities text[],required_skills text[],
  compensation text,application_deadline timestamptz,status text,created_at timestamptz,
  updated_at timestamptz,application_count bigint,my_application_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_rank integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_space_id is null then raise exception 'Space is required'; end if;
  select s.* into v_space from public.ming_spaces s where s.id=p_space_id and s.nature='business';
  if not found then raise exception 'Business Space not found'; end if;
  if coalesce((v_space.features->>'opportunities')::boolean,true)=false then
    return;
  end if;

  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank<30 and not coalesce(v_space.discoverable,false) then
    raise exception 'Approved membership or a discoverable Business Space is required';
  end if;

  return query
  select r.id,r.space_id,r.created_by,r.title,r.employment_type,r.work_mode,r.location,r.department,
    r.description,r.responsibilities,r.required_skills,r.compensation,r.application_deadline,r.status,
    r.created_at,r.updated_at,
    (select count(*)::bigint from public.ming_space_role_applications a where a.role_id=r.id),
    (select a.status from public.ming_space_role_applications a where a.role_id=r.id and a.applicant_id=v_user limit 1)
  from public.ming_space_open_roles r
  where r.space_id=p_space_id
    and (v_rank>=60 or (r.status='open' and (r.application_deadline is null or r.application_deadline>now())))
  order by (r.status='open') desc,r.created_at desc;
end;
$function$;

create or replace function public.update_ming_space_open_role(
  p_role_id uuid,p_title text,p_employment_type text,p_work_mode text,p_location text,
  p_department text,p_description text,p_responsibilities text[],p_required_skills text[],
  p_compensation text,p_application_deadline timestamptz,p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_row public.ming_space_open_roles;
  v_space public.ming_spaces;
  v_role text;
  v_rank integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select r.* into v_row from public.ming_space_open_roles r where r.id=p_role_id;
  if not found then raise exception 'Open role not found'; end if;
  select s.* into v_space from public.ming_spaces s where s.id=v_row.space_id and s.nature='business';
  if not found then raise exception 'Business Space not found'; end if;
  if coalesce((v_space.features->>'opportunities')::boolean,true)=false then raise exception 'Open Roles are disabled in this Business Space'; end if;

  select m.role into v_role from public.ming_space_members m
  where m.space_id=v_row.space_id and m.user_id=v_user and m.approved=true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank<60 then raise exception 'Only an owner, admin, or manager can manage Open Roles'; end if;

  if char_length(btrim(coalesce(p_title,''))) not between 2 and 100 then raise exception 'Enter a role title between 2 and 100 characters'; end if;
  if p_employment_type not in ('full-time','part-time','contract','internship','temporary','volunteer') then raise exception 'Invalid employment type'; end if;
  if p_work_mode not in ('remote','hybrid','on-site') then raise exception 'Invalid work mode'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Enter a role description'; end if;
  if p_status not in ('open','closed') then raise exception 'Invalid role status'; end if;
  if char_length(coalesce(p_location,''))>120 or char_length(coalesce(p_department,''))>100 or char_length(coalesce(p_compensation,''))>160 then raise exception 'One or more fields are too long'; end if;
  if p_application_deadline is not null and p_application_deadline<=now() then raise exception 'Application deadline must be in the future'; end if;

  update public.ming_space_open_roles r set title=btrim(p_title),employment_type=p_employment_type,
    work_mode=p_work_mode,location=btrim(coalesce(p_location,'')),department=btrim(coalesce(p_department,'')),
    description=btrim(p_description),responsibilities=coalesce(p_responsibilities,'{}'::text[]),
    required_skills=coalesce(p_required_skills,'{}'::text[]),compensation=btrim(coalesce(p_compensation,'')),
    application_deadline=p_application_deadline,status=p_status,updated_at=now()
  where r.id=p_role_id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'status',v_row.status);
end;
$function$;

-- Activity entries are an in-app timeline, not a client-forgeable escrow or
-- dispute ledger. Only known event types are accepted.
create or replace function public.record_ming_space_activity(p_space_id uuid,p_event text,p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_meta jsonb := '{}'::jsonb;
  v_id uuid;
  v_created_at timestamptz;
  v_target uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_space_id is null or p_event is null then raise exception 'Invalid activity event'; end if;
  if jsonb_typeof(coalesce(p_meta,'{}'::jsonb))<>'object' or octet_length(coalesce(p_meta,'{}'::jsonb)::text)>3000 then
    raise exception 'Invalid activity metadata';
  end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  if v_role is null then raise exception 'You must be an approved Space member to record activity'; end if;

  case p_event
    when 'member.joined' then
      v_meta:=jsonb_build_object('via',left(coalesce(p_meta->>'via',''),20),'version',greatest(1,coalesce((p_meta->>'version')::integer,1)));
    when 'member.removed' then
      if v_role not in ('owner','admin','manager') then raise exception 'Only Space managers can log member removals'; end if;
      v_meta:=jsonb_build_object('userId',left(coalesce(p_meta->>'userId',''),64));
    when 'member.role_changed' then
      if v_role not in ('owner','admin','manager') then raise exception 'Only Space managers can log role changes'; end if;
      v_meta:=jsonb_build_object('role',left(coalesce(p_meta->>'role',''),30));
    when 'invite.issued','invite.rotated' then
      if v_role not in ('owner','admin','manager') then raise exception 'Only Space managers can log invite changes'; end if;
      v_meta:=jsonb_build_object('version',greatest(1,coalesce((p_meta->>'version')::integer,1)));
    when 'content.created' then
      if not exists(select 1 from public.ming_space_content c where c.space_id=p_space_id and c.author_id=v_user and c.kind=left(coalesce(p_meta->>'kind',''),40) and c.created_at>now()-interval '5 minutes') then
        raise exception 'Content creation activity must reference your recent Space content';
      end if;
      v_meta:=jsonb_build_object('kind',left(coalesce(p_meta->>'kind','content'),40));
    when 'task.toggled' then
      v_target:=nullif(p_meta->>'id','')::uuid;
      if not exists(select 1 from public.ming_space_content c where c.id=v_target and c.space_id=p_space_id and c.kind='task' and (c.author_id=v_user or v_role in ('owner','admin','manager'))) then
        raise exception 'Task activity is not permitted';
      end if;
      v_meta:=jsonb_build_object('done',coalesce((p_meta->>'done')::boolean,false));
    when 'task.updated' then
      if v_role not in ('owner','admin','manager') then raise exception 'Only Space managers can log task updates'; end if;
      v_meta:=jsonb_build_object('status',left(coalesce(p_meta->>'status',''),30));
    when 'product.listed' then
      v_target:=nullif(p_meta->>'id','')::uuid;
      if v_role not in ('owner','seller') or not exists(select 1 from public.ming_space_products p where p.id=v_target and p.space_id=p_space_id and p.seller_id=v_user) then
        raise exception 'Product activity must reference your own Marketplace listing';
      end if;
      v_meta:='{}'::jsonb;
    when 'document.uploaded' then
      if not exists(select 1 from public.ming_space_files f where f.space_id=p_space_id and f.owner_id=v_user and f.created_at>now()-interval '5 minutes') then
        raise exception 'Document upload activity must reference a recent file upload';
      end if;
      v_meta:='{}'::jsonb;
    when 'document.renamed','document.categorized' then
      if v_role not in ('owner','admin','manager') and not exists(select 1 from public.ming_space_files f where f.space_id=p_space_id and f.owner_id=v_user and f.updated_at>now()-interval '5 minutes') then
        raise exception 'Document activity is not permitted';
      end if;
      v_meta:='{}'::jsonb;
    when 'document.deleted' then
      if v_role not in ('owner','admin','manager') then raise exception 'Only Space managers can log document deletion'; end if;
      v_meta:='{}'::jsonb;
    else
      raise exception 'Unsupported Space activity event';
  end case;

  insert into public.ming_space_activity(space_id,actor_id,event,meta)
  values(p_space_id,v_user,p_event,v_meta)
  returning id,created_at into v_id,v_created_at;
  return jsonb_build_object('id',v_id,'created_at',v_created_at);
end;
$function$;

commit;