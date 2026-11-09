-- Tweaklr Business Spaces: Open Roles and applications.
-- Additive migration. It does not alter existing Space content or other app tables.
-- Run this once in the Supabase SQL Editor for the Tweaklr project.

create table if not exists public.ming_space_open_roles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 100),
  employment_type text not null check (employment_type in ('full-time','part-time','contract','internship','temporary','volunteer')),
  work_mode text not null check (work_mode in ('remote','hybrid','on-site')),
  location text not null default '' check (char_length(location) <= 120),
  department text not null default '' check (char_length(department) <= 100),
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  responsibilities text[] not null default '{}'::text[],
  required_skills text[] not null default '{}'::text[],
  compensation text not null default '' check (char_length(compensation) <= 160),
  application_deadline timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ming_space_open_roles_space_status_idx
  on public.ming_space_open_roles (space_id, status, created_at desc);

create table if not exists public.ming_space_role_applications (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.ming_space_open_roles(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  introduction text not null check (char_length(btrim(introduction)) between 1 and 600),
  skills_experience text not null check (char_length(btrim(skills_experience)) between 1 and 2000),
  portfolio_url text not null default '' check (char_length(portfolio_url) <= 500),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  status text not null default 'submitted'
    check (status in ('submitted','reviewing','shortlisted','interview','rejected','hired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, applicant_id)
);

create index if not exists ming_space_role_applications_role_created_idx
  on public.ming_space_role_applications (role_id, created_at desc);

create index if not exists ming_space_role_applications_applicant_idx
  on public.ming_space_role_applications (applicant_id, created_at desc);

alter table public.ming_space_open_roles enable row level security;
alter table public.ming_space_role_applications enable row level security;
revoke all on table public.ming_space_open_roles, public.ming_space_role_applications from anon, authenticated;

-- An authenticated member of a discoverable Space may view its live roles.
-- Owners/admins/managers can also see closed and expired roles for management.
create or replace function public.get_ming_space_open_roles(p_space_id uuid)
returns table (
  id uuid,
  space_id uuid,
  created_by uuid,
  title text,
  employment_type text,
  work_mode text,
  location text,
  department text,
  description text,
  responsibilities text[],
  required_skills text[],
  compensation text,
  application_deadline timestamptz,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  application_count bigint,
  my_application_status text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_rank integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_space_id is null then raise exception 'Space is required'; end if;

  select s.* into v_space
  from public.ming_spaces s
  where s.id = p_space_id and s.nature = 'business';
  if not found then raise exception 'Business Space not found'; end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = p_space_id and m.user_id = v_user and m.approved = true;

  v_rank := case v_role
    when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0
  end;

  if v_rank < 30 and not coalesce(v_space.discoverable, false) then
    raise exception 'Approved membership or a discoverable Business Space is required';
  end if;

  return query
  select
    r.id, r.space_id, r.created_by, r.title, r.employment_type, r.work_mode,
    r.location, r.department, r.description, r.responsibilities, r.required_skills,
    r.compensation, r.application_deadline, r.status, r.created_at, r.updated_at,
    (select count(*)::bigint from public.ming_space_role_applications a where a.role_id = r.id),
    (select a.status from public.ming_space_role_applications a
      where a.role_id = r.id and a.applicant_id = v_user limit 1)
  from public.ming_space_open_roles r
  where r.space_id = p_space_id
    and (
      v_rank >= 60
      or (r.status = 'open' and (r.application_deadline is null or r.application_deadline > now()))
    )
  order by (r.status = 'open') desc, r.created_at desc;
end;
$$;

create or replace function public.create_ming_space_open_role(
  p_space_id uuid,
  p_title text,
  p_employment_type text,
  p_work_mode text,
  p_location text,
  p_department text,
  p_description text,
  p_responsibilities text[],
  p_required_skills text[],
  p_compensation text,
  p_application_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_rank integer;
  v_row public.ming_space_open_roles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select s.* into v_space from public.ming_spaces s
    where s.id = p_space_id and s.nature = 'business';
  if not found then raise exception 'Business Space not found'; end if;

  select m.role into v_role from public.ming_space_members m
    where m.space_id = p_space_id and m.user_id = v_user and m.approved = true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank < 60 then raise exception 'Only an owner, admin, or manager can manage Open Roles'; end if;

  if char_length(btrim(coalesce(p_title,''))) not between 2 and 100 then raise exception 'Enter a role title between 2 and 100 characters'; end if;
  if p_employment_type not in ('full-time','part-time','contract','internship','temporary','volunteer') then raise exception 'Invalid employment type'; end if;
  if p_work_mode not in ('remote','hybrid','on-site') then raise exception 'Invalid work mode'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Enter a role description'; end if;
  if char_length(coalesce(p_location,'')) > 120 or char_length(coalesce(p_department,'')) > 100 or char_length(coalesce(p_compensation,'')) > 160 then raise exception 'One or more fields are too long'; end if;

  insert into public.ming_space_open_roles (
    space_id, created_by, title, employment_type, work_mode, location, department,
    description, responsibilities, required_skills, compensation, application_deadline, status
  ) values (
    p_space_id, v_user, btrim(p_title), p_employment_type, p_work_mode,
    btrim(coalesce(p_location,'')), btrim(coalesce(p_department,'')), btrim(p_description),
    coalesce(p_responsibilities,'{}'::text[]), coalesce(p_required_skills,'{}'::text[]),
    btrim(coalesce(p_compensation,'')), p_application_deadline, 'open'
  ) returning * into v_row;

  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'status',v_row.status);
end;
$$;

create or replace function public.update_ming_space_open_role(
  p_role_id uuid,
  p_title text,
  p_employment_type text,
  p_work_mode text,
  p_location text,
  p_department text,
  p_description text,
  p_responsibilities text[],
  p_required_skills text[],
  p_compensation text,
  p_application_deadline timestamptz,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.ming_space_open_roles;
  v_role text;
  v_rank integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select r.* into v_row from public.ming_space_open_roles r where r.id = p_role_id;
  if not found then raise exception 'Open role not found'; end if;

  select m.role into v_role from public.ming_space_members m
    where m.space_id = v_row.space_id and m.user_id = v_user and m.approved = true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank < 60 then raise exception 'Only an owner, admin, or manager can manage Open Roles'; end if;

  if char_length(btrim(coalesce(p_title,''))) not between 2 and 100 then raise exception 'Enter a role title between 2 and 100 characters'; end if;
  if p_employment_type not in ('full-time','part-time','contract','internship','temporary','volunteer') then raise exception 'Invalid employment type'; end if;
  if p_work_mode not in ('remote','hybrid','on-site') then raise exception 'Invalid work mode'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Enter a role description'; end if;
  if p_status not in ('open','closed') then raise exception 'Invalid role status'; end if;
  if char_length(coalesce(p_location,'')) > 120 or char_length(coalesce(p_department,'')) > 100 or char_length(coalesce(p_compensation,'')) > 160 then raise exception 'One or more fields are too long'; end if;

  update public.ming_space_open_roles r set
    title = btrim(p_title), employment_type = p_employment_type, work_mode = p_work_mode,
    location = btrim(coalesce(p_location,'')), department = btrim(coalesce(p_department,'')),
    description = btrim(p_description), responsibilities = coalesce(p_responsibilities,'{}'::text[]),
    required_skills = coalesce(p_required_skills,'{}'::text[]), compensation = btrim(coalesce(p_compensation,'')),
    application_deadline = p_application_deadline, status = p_status, updated_at = now()
  where r.id = p_role_id
  returning * into v_row;

  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'status',v_row.status);
end;
$$;

create or replace function public.apply_ming_space_open_role(
  p_role_id uuid,
  p_introduction text,
  p_skills_experience text,
  p_portfolio_url text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if char_length(coalesce(p_portfolio_url,'')) > 500 then raise exception 'Portfolio or CV link is too long'; end if;
  if coalesce(btrim(p_portfolio_url),'') <> '' and btrim(p_portfolio_url) !~* '^https?://' then raise exception 'Use a full https:// or http:// link for your CV or portfolio'; end if;

  select r.* into v_role from public.ming_space_open_roles r
    where r.id = p_role_id and r.status = 'open'
      and (r.application_deadline is null or r.application_deadline > now());
  if not found then raise exception 'This role is closed or its deadline has passed'; end if;

  select s.* into v_space from public.ming_spaces s where s.id = v_role.space_id and s.nature = 'business';
  if not found then raise exception 'Business Space not found'; end if;

  select exists(select 1 from public.ming_space_members m
    where m.space_id = v_role.space_id and m.user_id = v_user and m.approved = true)
    into v_member;
  if not v_member and not coalesce(v_space.discoverable,false) then
    raise exception 'Join this Business Space before applying';
  end if;

  insert into public.ming_space_role_applications
    (role_id, applicant_id, introduction, skills_experience, portfolio_url, message)
  values
    (p_role_id, v_user, btrim(p_introduction), btrim(p_skills_experience),
     btrim(coalesce(p_portfolio_url,'')), btrim(p_message))
  returning * into v_row;

  return jsonb_build_object('id',v_row.id,'role_id',v_row.role_id,'status',v_row.status,'created_at',v_row.created_at);
end;
$$;

create or replace function public.get_ming_space_role_applications(p_role_id uuid)
returns table (
  id uuid,
  role_id uuid,
  applicant_id uuid,
  introduction text,
  skills_experience text,
  portfolio_url text,
  message text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_user uuid := (select auth.uid());
  v_space_id uuid;
  v_role text;
  v_rank integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select r.space_id into v_space_id from public.ming_space_open_roles r where r.id = p_role_id;
  if not found then raise exception 'Open role not found'; end if;

  select m.role into v_role from public.ming_space_members m
    where m.space_id = v_space_id and m.user_id = v_user and m.approved = true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank < 60 then raise exception 'Only an owner, admin, or manager can review applicants'; end if;

  return query select a.id, a.role_id, a.applicant_id, a.introduction, a.skills_experience,
    a.portfolio_url, a.message, a.status, a.created_at, a.updated_at
  from public.ming_space_role_applications a
  where a.role_id = p_role_id
  order by a.created_at desc;
end;
$$;

create or replace function public.update_ming_space_role_application_status(
  p_application_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_space_id uuid;
  v_role text;
  v_rank integer;
  v_row public.ming_space_role_applications;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_status not in ('submitted','reviewing','shortlisted','interview','rejected','hired') then raise exception 'Invalid application status'; end if;
  select r.space_id into v_space_id
    from public.ming_space_role_applications a
    join public.ming_space_open_roles r on r.id = a.role_id
    where a.id = p_application_id;
  if not found then raise exception 'Application not found'; end if;

  select m.role into v_role from public.ming_space_members m
    where m.space_id = v_space_id and m.user_id = v_user and m.approved = true;
  v_rank := case v_role when 'owner' then 100 when 'admin' then 80 when 'manager' then 60
    when 'moderator' then 60 when 'seller' then 40 when 'member' then 30
    when 'buyer' then 30 when 'guest' then 10 else 0 end;
  if v_rank < 60 then raise exception 'Only an owner, admin, or manager can update applicant status'; end if;

  update public.ming_space_role_applications a set status = p_status, updated_at = now()
    where a.id = p_application_id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'updated_at',v_row.updated_at);
end;
$$;

revoke execute on function public.get_ming_space_open_roles(uuid) from public, anon;
revoke execute on function public.create_ming_space_open_role(uuid,text,text,text,text,text,text,text[],text[],text,timestamptz) from public, anon;
revoke execute on function public.update_ming_space_open_role(uuid,text,text,text,text,text,text,text[],text[],text,timestamptz,text) from public, anon;
revoke execute on function public.apply_ming_space_open_role(uuid,text,text,text,text) from public, anon;
revoke execute on function public.get_ming_space_role_applications(uuid) from public, anon;
revoke execute on function public.update_ming_space_role_application_status(uuid,text) from public, anon;

grant execute on function public.get_ming_space_open_roles(uuid) to authenticated;
grant execute on function public.create_ming_space_open_role(uuid,text,text,text,text,text,text,text[],text[],text,timestamptz) to authenticated;
grant execute on function public.update_ming_space_open_role(uuid,text,text,text,text,text,text,text[],text[],text,timestamptz,text) to authenticated;
grant execute on function public.apply_ming_space_open_role(uuid,text,text,text,text) to authenticated;
grant execute on function public.get_ming_space_role_applications(uuid) to authenticated;
grant execute on function public.update_ming_space_role_application_status(uuid,text) to authenticated;

notify pgrst, 'reload schema';
