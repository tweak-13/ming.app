-- Friendly Community creator ownership repair.
-- Run after 20261109090000_friendly_communities.sql.
begin;

insert into public.ming_friendly_community_members (community_id,user_id,role,status)
select c.id,c.creator_id,'owner','approved'
from public.ming_friendly_communities c
on conflict (community_id,user_id)
do update set role='owner',status='approved';

create or replace function public.create_ming_friendly_community(
  p_space_id uuid,p_name text,p_description text,
  p_category text default 'Other interests',p_privacy text default 'public',
  p_require_approval boolean default false,p_cover_path text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_row public.ming_friendly_communities;
  v_profile public.profiles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id and s.nature='friendly'
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Friendly Space membership required'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then raise exception 'Community name must be 3–70 characters'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 8 and 600 then raise exception 'Description must be 8–600 characters'; end if;
  if coalesce(p_privacy,'public') not in ('public','private') then raise exception 'Invalid community privacy'; end if;
  if p_cover_path is not null and p_cover_path !~ ('^'||v_user::text||'/friendly-'||p_space_id::text||'/community-[A-Za-z0-9._-]+$') then
    raise exception 'Invalid community cover path';
  end if;
  insert into public.ming_friendly_communities(space_id,creator_id,name,description,category,privacy,require_approval,cover_path)
  values(p_space_id,v_user,btrim(p_name),btrim(p_description),coalesce(nullif(btrim(p_category),''),'Other interests'),
    coalesce(p_privacy,'public'),coalesce(p_require_approval,false) or coalesce(p_privacy,'public')='private',p_cover_path)
  returning * into v_row;
  insert into public.ming_friendly_community_members(community_id,user_id,role,status)
  values(v_row.id,v_user,'owner','approved')
  on conflict(community_id,user_id) do update set role='owner',status='approved';
  select * into v_profile from public.profiles where id=v_user;
  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'creator_id',v_row.creator_id,
    'name',v_row.name,'description',v_row.description,'category',v_row.category,'privacy',v_row.privacy,
    'require_approval',v_row.require_approval,'cover_path',v_row.cover_path,'created_at',v_row.created_at,
    'member_count',1,'post_count',0,'my_status','approved','my_role','owner',
    'creator_name',coalesce(v_profile.display_name,v_profile.username,'You'));
end;
$function$;

create or replace function public.join_ming_friendly_community(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_c public.ming_friendly_communities;
  v_status text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.* into v_c from public.ming_friendly_communities c
  join public.ming_spaces s on s.id=c.space_id and s.nature='friendly'
  join public.ming_space_members sm on sm.space_id=s.id and sm.user_id=v_user and sm.approved=true
  where c.id=p_community_id;
  if not found then raise exception 'Community not found or unavailable'; end if;
  if v_c.creator_id=v_user then
    insert into public.ming_friendly_community_members(community_id,user_id,role,status)
    values(p_community_id,v_user,'owner','approved')
    on conflict(community_id,user_id) do update set role='owner',status='approved';
    return jsonb_build_object('status','approved','role','owner');
  end if;
  select status into v_status from public.ming_friendly_community_members
  where community_id=p_community_id and user_id=v_user;
  if v_status='banned' then raise exception 'You cannot join this community'; end if;
  if v_status is not null then return jsonb_build_object('status',v_status); end if;
  v_status:=case when v_c.privacy='private' or v_c.require_approval then 'pending' else 'approved' end;
  insert into public.ming_friendly_community_members(community_id,user_id,status)
  values(p_community_id,v_user,v_status);
  return jsonb_build_object('status',v_status);
end;
$function$;

notify pgrst,'reload schema';
commit;
