-- Tweaklr Friendly Communities: independent mini-spaces inside a Friendly Space.
-- Community data is stored separately from friend_post content.
begin;

create table if not exists public.ming_friendly_communities (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 70),
  description text not null check (char_length(btrim(description)) between 8 and 600),
  category text not null default 'Other interests',
  privacy text not null default 'public' check (privacy in ('public','private')),
  require_approval boolean not null default false,
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ming_friendly_community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.ming_friendly_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  status text not null default 'approved' check (status in ('pending','approved','banned')),
  joined_at timestamptz not null default now(),
  unique (community_id,user_id)
);

create table if not exists public.ming_friendly_community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.ming_friendly_communities(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 3000),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or jsonb_array_length(media) > 0)
);

create table if not exists public.ming_friendly_community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ming_friendly_community_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_comment_id uuid references public.ming_friendly_community_comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ming_friendly_communities_space_created_idx on public.ming_friendly_communities(space_id,created_at desc);
create index if not exists ming_friendly_community_members_user_idx on public.ming_friendly_community_members(user_id,status);
create index if not exists ming_friendly_community_posts_feed_idx on public.ming_friendly_community_posts(community_id,created_at desc);
create index if not exists ming_friendly_community_comments_post_idx on public.ming_friendly_community_comments(post_id,created_at);

alter table public.ming_friendly_communities enable row level security;
alter table public.ming_friendly_community_members enable row level security;
alter table public.ming_friendly_community_posts enable row level security;
alter table public.ming_friendly_community_comments enable row level security;

revoke all on public.ming_friendly_communities, public.ming_friendly_community_members,
  public.ming_friendly_community_posts, public.ming_friendly_community_comments from anon, authenticated;

create or replace function public.get_ming_friendly_communities(p_space_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
stable
as $function$
declare v_user uuid := (select auth.uid()); v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.ming_spaces s join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id and s.nature='friendly' and m.user_id=v_user and m.approved=true) then
    raise exception 'Approved Friendly Space membership required';
  end if;
  select jsonb_build_object('communities',coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'space_id',c.space_id,'creator_id',c.creator_id,'name',c.name,'description',c.description,
    'category',c.category,'privacy',c.privacy,'require_approval',c.require_approval,'cover_path',c.cover_path,
    'created_at',c.created_at,'member_count',(select count(*) from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.status='approved'),
    'post_count',(select count(*) from public.ming_friendly_community_posts cp where cp.community_id=c.id),
    'my_status',(select cm.status from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.user_id=v_user),
    'my_role',(select cm.role from public.ming_friendly_community_members cm where cm.community_id=c.id and cm.user_id=v_user),
    'creator_name',coalesce(pr.display_name,pr.username,'Tweaklr member')
  ) order by c.created_at desc),'[]'::jsonb))
  into v_result
  from public.ming_friendly_communities c
  left join public.profiles pr on pr.id=c.creator_id
  where c.space_id=p_space_id;
  return v_result;
end;
$function$;

create or replace function public.create_ming_friendly_community(
  p_space_id uuid,p_name text,p_description text,p_category text default 'Other interests',
  p_privacy text default 'public',p_require_approval boolean default false,p_cover_path text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_row public.ming_friendly_communities; v_profile public.profiles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.ming_spaces s join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id and s.nature='friendly' and m.user_id=v_user and m.approved=true) then
    raise exception 'Approved Friendly Space membership required';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 then raise exception 'Community name must be 3–70 characters'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 8 and 600 then raise exception 'Description must be 8–600 characters'; end if;
  if coalesce(p_privacy,'public') not in ('public','private') then raise exception 'Invalid community privacy'; end if;
  if p_cover_path is not null and (p_cover_path !~ ('^' || v_user::text || '/friendly-' || p_space_id::text || '/community-[A-Za-z0-9._-]+$')) then
    raise exception 'Invalid community cover path';
  end if;
  insert into public.ming_friendly_communities(space_id,creator_id,name,description,category,privacy,require_approval,cover_path)
  values(p_space_id,v_user,btrim(p_name),btrim(p_description),coalesce(nullif(btrim(p_category),''),'Other interests'),
    coalesce(p_privacy,'public'),coalesce(p_require_approval,false) or p_privacy='private',p_cover_path)
  returning * into v_row;
  insert into public.ming_friendly_community_members(community_id,user_id,role,status)
  values(v_row.id,v_user,'owner','approved');
  select * into v_profile from public.profiles where id=v_user;
  return jsonb_build_object('id',v_row.id,'space_id',v_row.space_id,'creator_id',v_row.creator_id,'name',v_row.name,
    'description',v_row.description,'category',v_row.category,'privacy',v_row.privacy,'require_approval',v_row.require_approval,
    'cover_path',v_row.cover_path,'created_at',v_row.created_at,'member_count',1,'post_count',0,'my_status','approved',
    'my_role','owner','creator_name',coalesce(v_profile.display_name,v_profile.username,'You'));
end;
$function$;

create or replace function public.join_ming_friendly_community(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_c public.ming_friendly_communities; v_status text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.* into v_c from public.ming_friendly_communities c
  join public.ming_spaces s on s.id=c.space_id and s.nature='friendly'
  join public.ming_space_members sm on sm.space_id=s.id and sm.user_id=v_user and sm.approved=true
  where c.id=p_community_id;
  if not found then raise exception 'Community not found or unavailable'; end if;
  select status into v_status from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user;
  if v_status='banned' then raise exception 'You cannot join this community'; end if;
  if v_status is not null then return jsonb_build_object('status',v_status); end if;
  v_status := case when v_c.privacy='private' or v_c.require_approval then 'pending' else 'approved' end;
  insert into public.ming_friendly_community_members(community_id,user_id,status)
  values(p_community_id,v_user,v_status) on conflict(community_id,user_id) do update set status=excluded.status,joined_at=now();
  return jsonb_build_object('status',v_status);
end;
$function$;

create or replace function public.get_ming_friendly_community_space(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
stable
as $function$
declare v_user uuid := (select auth.uid()); v_c public.ming_friendly_communities; v_status text; v_role text; v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.* into v_c from public.ming_friendly_communities c
  join public.ming_space_members sm on sm.space_id=c.space_id and sm.user_id=v_user and sm.approved=true
  where c.id=p_community_id and exists(select 1 from public.ming_spaces s where s.id=c.space_id and s.nature='friendly');
  if not found then raise exception 'Community not found or unavailable'; end if;
  select status,role into v_status,v_role from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user;
  if v_status is distinct from 'approved' then raise exception 'Join this community before opening its mini-space'; end if;
  select jsonb_build_object(
    'community',jsonb_build_object('id',v_c.id,'space_id',v_c.space_id,'creator_id',v_c.creator_id,'name',v_c.name,
      'description',v_c.description,'category',v_c.category,'privacy',v_c.privacy,'require_approval',v_c.require_approval,
      'cover_path',v_c.cover_path,'created_at',v_c.created_at,'my_role',v_role,
      'member_count',(select count(*) from public.ming_friendly_community_members where community_id=v_c.id and status='approved')),
    'posts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'author_id',p.author_id,'body',p.body,'media',p.media,
      'created_at',p.created_at,'comment_count',(select count(*) from public.ming_friendly_community_comments cm where cm.post_id=p.id),
      'author_name',coalesce(pr.display_name,pr.username,'Community member'),'author_username',pr.username,'author_avatar_url',pr.avatar_url)
      order by p.created_at desc) from public.ming_friendly_community_posts p left join public.profiles pr on pr.id=p.author_id where p.community_id=v_c.id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'status',m.status,
      'display_name',coalesce(pr.display_name,pr.username,'Community member'),'username',pr.username,'avatar_url',pr.avatar_url)
      order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end,m.joined_at)
      from public.ming_friendly_community_members m left join public.profiles pr on pr.id=m.user_id
      where m.community_id=v_c.id and m.status='approved'),'[]'::jsonb),
    'requests',case when v_role in ('owner','moderator') then
      coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',coalesce(pr.display_name,pr.username,'Member'),'username',pr.username,'avatar_url',pr.avatar_url,'joined_at',m.joined_at))
        from public.ming_friendly_community_members m left join public.profiles pr on pr.id=m.user_id
        where m.community_id=v_c.id and m.status='pending'),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.create_ming_friendly_community_post(p_community_id uuid,p_body text default '',p_media jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_post public.ming_friendly_community_posts;
  v_space_id uuid;
  v_item jsonb;
  v_path text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select space_id into v_space_id from public.ming_friendly_communities where id=p_community_id;
  if not found or not exists(
    select 1 from public.ming_friendly_community_members
    where community_id=p_community_id and user_id=v_user and status='approved'
  ) then raise exception 'Approved community membership required'; end if;
  if char_length(coalesce(p_body,''))>3000
    or jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(p_media,'[]'::jsonb))>4 then
    raise exception 'Post is too long or has too many attachments';
  end if;
  if char_length(btrim(coalesce(p_body,'')))=0 and jsonb_array_length(coalesce(p_media,'[]'::jsonb))=0 then
    raise exception 'Write something or attach media';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
    v_path := v_item->>'path';
    if v_path is null or v_path !~ ('^'||v_user::text||'/friendly-'||v_space_id::text||'/community-'||p_community_id::text||'-[A-Za-z0-9._-]+$') then
      raise exception 'Invalid community attachment path';
    end if;
  end loop;
  insert into public.ming_friendly_community_posts(community_id,author_id,body,media)
  values(p_community_id,v_user,btrim(coalesce(p_body,'')),coalesce(p_media,'[]'::jsonb))
  returning * into v_post;
  return jsonb_build_object('id',v_post.id,'community_id',v_post.community_id,'author_id',v_post.author_id,
    'body',v_post.body,'media',v_post.media,'created_at',v_post.created_at,'comment_count',0);
end;
$function$;

create or replace function public.add_ming_friendly_community_comment(p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_comment public.ming_friendly_community_comments; v_community uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select community_id into v_community from public.ming_friendly_community_posts where id=p_post_id;
  if not found or not exists(select 1 from public.ming_friendly_community_members where community_id=v_community and user_id=v_user and status='approved') then raise exception 'Post unavailable or membership required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 1000 then raise exception 'Comment must be 1–1000 characters'; end if;
  insert into public.ming_friendly_community_comments(post_id,author_id,body) values(p_post_id,v_user,btrim(p_body)) returning * into v_comment;
  return jsonb_build_object('id',v_comment.id,'post_id',v_comment.post_id,'author_id',v_comment.author_id,'body',v_comment.body,'created_at',v_comment.created_at);
end;
$function$;

create or replace function public.manage_ming_friendly_community_member(p_community_id uuid,p_user_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_role text; v_target public.ming_friendly_community_members;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user and status='approved';
  if coalesce(v_role,'') not in ('owner','moderator') then raise exception 'Community moderation permission required'; end if;
  select * into v_target from public.ming_friendly_community_members where community_id=p_community_id and user_id=p_user_id for update;
  if not found then raise exception 'Member not found'; end if;
  if v_target.role='owner' then raise exception 'The community owner cannot be changed here'; end if;
  if v_role='moderator' and v_target.role='moderator' then raise exception 'Only the community owner can manage moderators'; end if;
  if p_action='approve' and v_target.status='pending' then update public.ming_friendly_community_members set status='approved',joined_at=now() where id=v_target.id;
  elsif p_action='remove' then delete from public.ming_friendly_community_members where id=v_target.id;
  elsif p_action='promote' and v_role='owner' and v_target.status='approved' then update public.ming_friendly_community_members set role='moderator' where id=v_target.id;
  elsif p_action='demote' and v_role='owner' and v_target.role='moderator' then update public.ming_friendly_community_members set role='member' where id=v_target.id;
  else raise exception 'This membership action is not allowed'; end if;
  return jsonb_build_object('success',true);
end;
$function$;

create or replace function public.update_ming_friendly_community(p_community_id uuid,p_name text,p_description text,p_category text,p_privacy text,p_require_approval boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_row public.ming_friendly_communities;
begin
  if v_user is null or not exists(select 1 from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user and role='owner' and status='approved') then raise exception 'Only the community owner can edit its settings'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 70 or char_length(btrim(coalesce(p_description,''))) not between 8 and 600 then raise exception 'Check the community name and description'; end if;
  update public.ming_friendly_communities set name=btrim(p_name),description=btrim(p_description),category=coalesce(nullif(btrim(p_category),''),'Other interests'),
    privacy=coalesce(p_privacy,'public'),require_approval=coalesce(p_require_approval,false) or p_privacy='private',updated_at=now()
  where id=p_community_id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'name',v_row.name,'description',v_row.description,'category',v_row.category,'privacy',v_row.privacy,'require_approval',v_row.require_approval);
end;
$function$;

create or replace function public.leave_ming_friendly_community(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_role text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user and status='approved';
  if not found then raise exception 'You are not an approved member'; end if;
  if v_role='owner' then raise exception 'Transfer ownership or delete the community before leaving'; end if;
  delete from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user;
  return jsonb_build_object('success',true);
end;
$function$;

create or replace function public.delete_ming_friendly_community_post(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid()); v_author uuid; v_community uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select author_id,community_id into v_author,v_community from public.ming_friendly_community_posts where id=p_post_id;
  if not found then raise exception 'Post not found'; end if;
  if v_author<>v_user and not exists(select 1 from public.ming_friendly_community_members where community_id=v_community and user_id=v_user and role in ('owner','moderator') and status='approved') then raise exception 'Only the author or a moderator can remove this post'; end if;
  delete from public.ming_friendly_community_posts where id=p_post_id;
  return jsonb_build_object('success',true);
end;
$function$;

revoke all on function public.get_ming_friendly_communities(uuid) from public,anon;
revoke all on function public.create_ming_friendly_community(uuid,text,text,text,text,boolean,text) from public,anon;
revoke all on function public.join_ming_friendly_community(uuid) from public,anon;
revoke all on function public.get_ming_friendly_community_space(uuid) from public,anon;
revoke all on function public.create_ming_friendly_community_post(uuid,text,jsonb) from public,anon;
revoke all on function public.add_ming_friendly_community_comment(uuid,text) from public,anon;
revoke all on function public.manage_ming_friendly_community_member(uuid,uuid,text) from public,anon;
revoke all on function public.update_ming_friendly_community(uuid,text,text,text,text,boolean) from public,anon;
revoke all on function public.leave_ming_friendly_community(uuid) from public,anon;
revoke all on function public.delete_ming_friendly_community_post(uuid) from public,anon;
grant execute on function public.get_ming_friendly_communities(uuid) to authenticated;
grant execute on function public.create_ming_friendly_community(uuid,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.join_ming_friendly_community(uuid) to authenticated;
grant execute on function public.get_ming_friendly_community_space(uuid) to authenticated;
grant execute on function public.create_ming_friendly_community_post(uuid,text,jsonb) to authenticated;
grant execute on function public.add_ming_friendly_community_comment(uuid,text) to authenticated;
grant execute on function public.manage_ming_friendly_community_member(uuid,uuid,text) to authenticated;
grant execute on function public.update_ming_friendly_community(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.leave_ming_friendly_community(uuid) to authenticated;
grant execute on function public.delete_ming_friendly_community_post(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
