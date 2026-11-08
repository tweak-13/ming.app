-- Ensure a community creator is always recognised as its approved owner.
-- This repairs existing creator memberships and makes both discovery and detail
-- responses derive ownership from the authoritative creator_id column.

begin;

insert into public.ming_friendly_community_members (community_id,user_id,role,status)
select c.id,c.creator_id,'owner','approved'
from public.ming_friendly_communities c
on conflict (community_id,user_id)
do update set role='owner',status='approved';

create or replace function public.get_ming_friendly_communities(p_space_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $function$
declare
  v_user uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1
    from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id
      and s.nature='friendly'
      and m.user_id=v_user
      and m.approved=true
  ) then
    raise exception 'Approved Friendly Space membership required';
  end if;

  select jsonb_build_object(
    'communities',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',c.id,
          'space_id',c.space_id,
          'creator_id',c.creator_id,
          'name',c.name,
          'description',c.description,
          'category',c.category,
          'privacy',c.privacy,
          'require_approval',c.require_approval,
          'cover_path',c.cover_path,
          'created_at',c.created_at,
          'member_count',(select count(*) from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.status='approved'),
          'post_count',(select count(*) from public.ming_friendly_community_posts cp where cp.community_id=c.id),
          'my_status',case when c.creator_id=v_user then 'approved' else
            (select cm.status from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.user_id=v_user) end,
          'my_role',case when c.creator_id=v_user then 'owner' else
            (select cm.role from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.user_id=v_user) end,
          'creator_name',coalesce(pr.display_name,pr.username,'Tweaklr member')
        )
        order by c.created_at desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.ming_friendly_communities c
  left join public.profiles pr on pr.id=c.creator_id
  where c.space_id=p_space_id;

  return v_result;
end;
$function$;

create or replace function public.get_ming_friendly_community_space(p_community_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_c public.ming_friendly_communities;
  v_status text;
  v_role text;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select c.* into v_c
  from public.ming_friendly_communities c
  join public.ming_space_members sm
    on sm.space_id=c.space_id
   and sm.user_id=v_user
   and sm.approved=true
  where c.id=p_community_id
    and exists (
      select 1 from public.ming_spaces s
      where s.id=c.space_id and s.nature='friendly'
    );

  if not found then raise exception 'Community not found or unavailable'; end if;

  -- The creator is the owner even if an earlier membership insert was missed.
  if v_c.creator_id=v_user then
    insert into public.ming_friendly_community_members(community_id,user_id,role,status)
    values(p_community_id,v_user,'owner','approved')
    on conflict(community_id,user_id)
    do update set role='owner',status='approved';
    v_status := 'approved';
    v_role := 'owner';
  else
    select status,role into v_status,v_role
    from public.ming_friendly_community_members
    where community_id=p_community_id and user_id=v_user;
  end if;

  if v_status is distinct from 'approved' then
    raise exception 'Join this community before opening its mini-space';
  end if;

  select jsonb_build_object(
    'community',
    jsonb_build_object(
      'id',v_c.id,
      'space_id',v_c.space_id,
      'creator_id',v_c.creator_id,
      'name',v_c.name,
      'description',v_c.description,
      'category',v_c.category,
      'privacy',v_c.privacy,
      'require_approval',v_c.require_approval,
      'cover_path',v_c.cover_path,
      'created_at',v_c.created_at,
      'my_role',v_role,
      'member_count',(select count(*) from public.ming_friendly_community_members where community_id=v_c.id and status='approved')
    ),
    'posts',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'author_id',p.author_id,
        'body',p.body,
        'media',p.media,
        'created_at',p.created_at,
        'comment_count',(select count(*) from public.ming_friendly_community_comments cm where cm.post_id=p.id),
        'author_name',coalesce(pr.display_name,pr.username,'Community member'),
        'author_username',pr.username,
        'author_avatar_url',pr.avatar_url
      ) order by p.created_at desc)
      from public.ming_friendly_community_posts p
      left join public.profiles pr on pr.id=p.author_id
      where p.community_id=v_c.id),
      '[]'::jsonb
    ),
    'members',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'user_id',m.user_id,
        'role',m.role,
        'status',m.status,
        'display_name',coalesce(pr.display_name,pr.username,'Community member'),
        'username',pr.username,
        'avatar_url',pr.avatar_url
      ) order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end,m.joined_at)
      from public.ming_friendly_community_members m
      left join public.profiles pr on pr.id=m.user_id
      where m.community_id=v_c.id and m.status='approved'),
      '[]'::jsonb
    ),
    'requests',
    case when v_role in ('owner','moderator') then
      coalesce(
        (select jsonb_agg(jsonb_build_object(
          'user_id',m.user_id,
          'display_name',coalesce(pr.display_name,pr.username,'Member'),
          'username',pr.username,
          'avatar_url',pr.avatar_url,
          'joined_at',m.joined_at
        ))
        from public.ming_friendly_community_members m
        left join public.profiles pr on pr.id=m.user_id
        where m.community_id=v_c.id and m.status='pending'),
        '[]'::jsonb
      )
    else '[]'::jsonb end
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_ming_friendly_communities(uuid) from public,anon;
revoke all on function public.get_ming_friendly_community_space(uuid) from public,anon;
grant execute on function public.get_ming_friendly_communities(uuid) to authenticated;
grant execute on function public.get_ming_friendly_community_space(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
