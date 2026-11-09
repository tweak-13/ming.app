begin;

-- Replace the retired Silly nature with Anonymous without deleting any Spaces.
alter table public.ming_spaces drop constraint if exists ming_spaces_nature_check;
update public.ming_spaces set nature = 'anonymous' where nature = 'silly';
alter table public.ming_spaces
  add constraint ming_spaces_nature_check
  check (nature = any (array['business','friendly','casual','anonymous','romantic','marketplace']::text[]));

create or replace function public.create_ming_space(
  p_name text,
  p_description text default '',
  p_nature text default 'friendly',
  p_privacy text default 'private',
  p_require_approval boolean default false,
  p_max_members integer default null,
  p_hue integer default null,
  p_location_linked boolean default false,
  p_expires_at timestamptz default null,
  p_features jsonb default '{}'::jsonb,
  p_invite_ttl_hours integer default 24,
  p_invite_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_member public.ming_space_members;
  v_code text;
  v_hash text;
  v_invite public.ming_space_invites;
  v_features jsonb := coalesce(p_features, '{}'::jsonb);
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_name,''))) < 2 then raise exception 'A Space needs a name.'; end if;
  if p_nature not in ('business','friendly','casual','anonymous','romantic','marketplace') then
    raise exception 'Unknown Space nature.';
  end if;
  if p_privacy not in ('private','approval','discoverable') then raise exception 'Unknown Space privacy.'; end if;
  if p_max_members is not null and p_max_members <= 0 then raise exception 'Member limit must be positive.'; end if;

  insert into public.ming_spaces(
    owner_id,name,description,nature,privacy,discoverable,require_approval,max_members,
    hue,location_linked,expires_at,features,theme
  )
  values(
    v_user,btrim(p_name),coalesce(p_description,''),p_nature,
    case when p_nature='romantic' then 'private' else p_privacy end,
    case when p_nature='romantic' then false else p_privacy='discoverable' end,
    (p_privacy='approval' or p_require_approval),p_max_members,p_hue,
    case when p_nature='romantic' or p_nature='anonymous' then false else p_location_linked end,
    p_expires_at,v_features,coalesce(v_features->'theme','{}'::jsonb)
  )
  returning * into v_space;

  insert into public.ming_space_members(space_id,user_id,role,approved)
  values(v_space.id,v_user,'owner',true)
  returning * into v_member;

  v_code := upper(substr(md5(random()::text||clock_timestamp()::text||v_user::text),1,4)||'-'||
                  substr(md5(random()::text||clock_timestamp()::text||v_space.id::text),1,4));
  v_hash := encode(extensions.digest(v_code,'sha256'),'hex');

  insert into public.ming_space_invites(space_id,code_hash,hint,expires_at,max_uses,version)
  values(
    v_space.id,v_hash,right(v_code,2),
    case when coalesce(p_invite_ttl_hours,24)>0 then now()+make_interval(hours=>coalesce(p_invite_ttl_hours,24)) else null end,
    p_invite_max_uses,1
  )
  returning * into v_invite;

  return jsonb_build_object(
    'space',jsonb_build_object(
      'id',v_space.id,'name',v_space.name,'description',v_space.description,'nature',v_space.nature,
      'privacy',v_space.privacy,'discoverable',v_space.discoverable,'requireApproval',v_space.require_approval,
      'maxMembers',v_space.max_members,'hue',v_space.hue,'locationLinked',v_space.location_linked,
      'expiresAt',v_space.expires_at,'features',v_space.features,'theme',v_space.theme,
      'ownerId',v_space.owner_id,'createdAt',v_space.created_at
    ),
    'member',jsonb_build_object(
      'spaceId',v_member.space_id,'userId',v_member.user_id,'role',v_member.role,
      'joinedAt',v_member.joined_at,'approved',v_member.approved
    ),
    'invite',jsonb_build_object(
      'id',v_invite.id,'codeHash',v_invite.code_hash,'hint',v_invite.hint,'createdAt',v_invite.created_at,
      'expiresAt',v_invite.expires_at,'maxUses',v_invite.max_uses,'uses',v_invite.uses,
      'revoked',v_invite.revoked,'version',v_invite.version
    ),
    'code',v_code
  );
end;
$function$;

create or replace function public.ming_validate_space_nature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.nature = 'romantic' then
    new.privacy := 'private';
    new.discoverable := false;
    new.require_approval := true;
    new.max_members := 2;
    new.location_linked := false;
  elsif new.nature = 'business' then
    if new.max_members is not null and new.max_members > 100 then
      raise exception 'Business Spaces can have at most 100 members.';
    end if;
  elsif new.nature = 'friendly' then
    if new.max_members is not null and new.max_members > 50 then
      raise exception 'Friendly Spaces can have at most 50 members.';
    end if;
  elsif new.nature = 'casual' then
    if new.max_members is not null and new.max_members > 30 then
      raise exception 'Casual Spaces can have at most 30 members.';
    end if;
    if new.expires_at is null then
      new.expires_at := now() + interval '24 hours';
    elsif new.expires_at > now() + interval '30 days' then
      raise exception 'Casual Spaces can stay open for at most 30 days.';
    end if;
  elsif new.nature = 'anonymous' then
    if new.max_members is not null and new.max_members > 40 then
      raise exception 'Anonymous Spaces can have at most 40 members.';
    end if;
    new.location_linked := false;
  elsif new.nature = 'marketplace' then
    if new.max_members is not null and new.max_members > 100 then
      raise exception 'Marketplace Spaces can have at most 100 members.';
    end if;
  end if;
  return new;
end;
$function$;

create table if not exists public.ming_anonymous_posts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.ming_anonymous_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ming_anonymous_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ming_anonymous_posts_space_created_idx
  on public.ming_anonymous_posts(space_id, created_at desc);
create index if not exists ming_anonymous_comments_post_created_idx
  on public.ming_anonymous_comments(post_id, created_at asc);

alter table public.ming_anonymous_posts enable row level security;
alter table public.ming_anonymous_comments enable row level security;
revoke all on public.ming_anonymous_posts, public.ming_anonymous_comments from public, anon, authenticated;

create or replace function public.get_ming_anonymous_space_feed(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_posts jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select m.role into v_role
  from public.ming_spaces s
  join public.ming_space_members m on m.space_id=s.id
  where s.id=p_space_id and s.nature='anonymous'
    and m.user_id=v_user and m.approved=true;

  if not found then raise exception 'Approved Anonymous Space membership required'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,
      'body',p.body,
      'created_at',p.created_at,
      'is_mine',(p.author_id=v_user),
      'can_moderate',(v_role in ('owner','admin','moderator')),
      'comments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',c.id,
          'body',c.body,
          'created_at',c.created_at,
          'is_mine',(c.author_id=v_user),
          'can_moderate',(v_role in ('owner','admin','moderator'))
        ) order by c.created_at asc)
        from public.ming_anonymous_comments c
        where c.post_id=p.id
      ),'[]'::jsonb)
    ) order by p.created_at desc
  ),'[]'::jsonb)
  into v_posts
  from public.ming_anonymous_posts p
  where p.space_id=p_space_id;

  return jsonb_build_object('posts',v_posts);
end;
$function$;

create or replace function public.create_ming_anonymous_post(p_space_id uuid,p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_post public.ming_anonymous_posts;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then
    raise exception 'Anonymous posts must contain 1–2000 characters.';
  end if;
  if not exists(
    select 1 from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id and s.nature='anonymous'
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Anonymous Space membership required'; end if;

  insert into public.ming_anonymous_posts(space_id,author_id,body)
  values(p_space_id,v_user,btrim(p_body))
  returning * into v_post;

  return jsonb_build_object('id',v_post.id,'body',v_post.body,'created_at',v_post.created_at,'is_mine',true);
end;
$function$;

create or replace function public.add_ming_anonymous_comment(p_post_id uuid,p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_comment public.ming_anonymous_comments;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 1000 then
    raise exception 'Anonymous comments must contain 1–1000 characters.';
  end if;
  if not exists(
    select 1 from public.ming_anonymous_posts p
    join public.ming_spaces s on s.id=p.space_id and s.nature='anonymous'
    join public.ming_space_members m on m.space_id=s.id
    where p.id=p_post_id and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Anonymous Space membership required'; end if;

  insert into public.ming_anonymous_comments(post_id,author_id,body)
  values(p_post_id,v_user,btrim(p_body))
  returning * into v_comment;

  return jsonb_build_object('id',v_comment.id,'body',v_comment.body,'created_at',v_comment.created_at,'is_mine',true);
end;
$function$;

create or replace function public.delete_ming_anonymous_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1
    from public.ming_anonymous_posts p
    join public.ming_spaces s on s.id=p.space_id and s.nature='anonymous'
    join public.ming_space_members m on m.space_id=s.id and m.user_id=v_user and m.approved=true
    where p.id=p_post_id
      and (p.author_id=v_user or s.owner_id=v_user or m.role in ('admin','moderator'))
  ) then raise exception 'You cannot remove this anonymous post'; end if;

  delete from public.ming_anonymous_posts where id=p_post_id;
  return true;
end;
$function$;

create or replace function public.delete_ming_anonymous_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1
    from public.ming_anonymous_comments c
    join public.ming_anonymous_posts p on p.id=c.post_id
    join public.ming_spaces s on s.id=p.space_id and s.nature='anonymous'
    join public.ming_space_members m on m.space_id=s.id and m.user_id=v_user and m.approved=true
    where c.id=p_comment_id
      and (c.author_id=v_user or s.owner_id=v_user or m.role in ('admin','moderator'))
  ) then raise exception 'You cannot remove this anonymous comment'; end if;

  delete from public.ming_anonymous_comments where id=p_comment_id;
  return true;
end;
$function$;

-- Anonymous identities are never exposed through table access. Only the
-- membership-checked RPCs above are callable by signed-in members.
revoke all on function public.get_ming_anonymous_space_feed(uuid) from public, anon;
revoke all on function public.create_ming_anonymous_post(uuid,text) from public, anon;
revoke all on function public.add_ming_anonymous_comment(uuid,text) from public, anon;
revoke all on function public.delete_ming_anonymous_post(uuid) from public, anon;
revoke all on function public.delete_ming_anonymous_comment(uuid) from public, anon;
grant execute on function public.get_ming_anonymous_space_feed(uuid) to authenticated;
grant execute on function public.create_ming_anonymous_post(uuid,text) to authenticated;
grant execute on function public.add_ming_anonymous_comment(uuid,text) to authenticated;
grant execute on function public.delete_ming_anonymous_post(uuid) to authenticated;
grant execute on function public.delete_ming_anonymous_comment(uuid) to authenticated;

-- Trigger-only functions should not be callable as public RPC endpoints.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.ming_validate_space_nature() from public, anon, authenticated;
revoke all on function public.create_ming_space(text,text,text,text,boolean,integer,integer,boolean,timestamptz,jsonb,integer,integer) from public, anon;
grant execute on function public.create_ming_space(text,text,text,text,boolean,integer,integer,boolean,timestamptz,jsonb,integer,integer) to authenticated;

commit;