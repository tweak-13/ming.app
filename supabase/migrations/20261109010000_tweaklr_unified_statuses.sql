-- Tweaklr unified WhatsApp-style Status system.
-- Apply in Supabase SQL Editor after deploying the matching frontend files.

create table if not exists public.tweaklr_statuses (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('main','friendly','business')),
  space_id uuid references public.ming_spaces(id) on delete cascade,
  status_type text not null check (status_type in ('text','image','video')),
  caption text not null default '',
  media_path text,
  media_mime text,
  text_background text not null default '#5B332A',
  audience text not null default 'connections' check (audience in ('connections','except','selected','space')),
  included_user_ids uuid[] not null default '{}',
  excluded_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint tweaklr_status_scope_space_check check (
    (scope = 'main' and space_id is null) or
    (scope in ('friendly','business') and space_id is not null)
  ),
  constraint tweaklr_status_media_check check (
    (status_type = 'text' and media_path is null) or
    (status_type in ('image','video') and media_path is not null)
  )
);
create index if not exists tweaklr_statuses_scope_expiry_idx on public.tweaklr_statuses(scope,space_id,expires_at desc);
create index if not exists tweaklr_statuses_author_expiry_idx on public.tweaklr_statuses(author_id,expires_at desc);
alter table public.tweaklr_statuses enable row level security;
revoke all on public.tweaklr_statuses from anon, authenticated;

create table if not exists public.tweaklr_status_views (
  status_id uuid not null references public.tweaklr_statuses(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(status_id,viewer_id)
);
alter table public.tweaklr_status_views enable row level security;
revoke all on public.tweaklr_status_views from anon, authenticated;

create table if not exists public.tweaklr_status_reactions (
  status_id uuid not null references public.tweaklr_statuses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('❤️','😂','😮','😢','👏','🔥')),
  created_at timestamptz not null default now(),
  primary key(status_id,user_id)
);
alter table public.tweaklr_status_reactions enable row level security;
revoke all on public.tweaklr_status_reactions from anon, authenticated;

create table if not exists public.tweaklr_status_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,author_id),
  check(user_id <> author_id)
);
alter table public.tweaklr_status_mutes enable row level security;
revoke all on public.tweaklr_status_mutes from anon, authenticated;

create or replace function public.tweaklr_status_can_view(p_status public.tweaklr_statuses, p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_connected boolean := false; v_member boolean := false;
begin
 if p_user is null then return false; end if;
 if p_status.author_id=p_user then return true; end if;
 if p_status.expires_at<=now() then return false; end if;
 if exists(select 1 from public.tweaklr_status_mutes m where m.user_id=p_user and m.author_id=p_status.author_id) then return false; end if;
 if p_status.scope in ('friendly','business') then
   select exists(select 1 from public.ming_space_members m where m.space_id=p_status.space_id and m.user_id=p_user and m.approved=true)
   into v_member;
   if not v_member then return false; end if;
 else
   select exists(select 1 from public.connections c where c.status='accepted' and
     ((c.requester_id=p_user and c.recipient_id=p_status.author_id) or
      (c.requester_id=p_status.author_id and c.recipient_id=p_user))) into v_connected;
   if not v_connected then return false; end if;
 end if;
 if p_status.scope='main' then
   if p_status.audience='selected' and not (p_user=any(p_status.included_user_ids)) then return false; end if;
   if p_status.audience='except' and p_user=any(p_status.excluded_user_ids) then return false; end if;
 end if;
 return true;
end $$;

create or replace function public.create_tweaklr_status(
 p_scope text,p_space_id uuid,p_status_type text,p_caption text,p_media_path text,p_media_mime text,
 p_text_background text default '#5B332A',p_audience text default 'connections',
 p_included_user_ids uuid[] default '{}',p_excluded_user_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_space public.ming_spaces; v_id uuid;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_scope not in ('main','friendly','business') then raise exception 'Invalid status location'; end if;
 if p_status_type not in ('text','image','video') then raise exception 'Invalid status type'; end if;
 if p_status_type='text' and length(btrim(coalesce(p_caption,'')))=0 then raise exception 'Write something for your text status'; end if;
 if p_status_type in ('image','video') and (p_media_path is null or split_part(p_media_path,'/',1)<>v_user::text) then raise exception 'Invalid status media'; end if;
 if p_scope='main' then
   if p_space_id is not null then raise exception 'Main statuses do not belong to a Space'; end if;
   if coalesce(p_audience,'connections') not in ('connections','except','selected') then raise exception 'Invalid status privacy'; end if;
 else
   select * into v_space from public.ming_spaces where id=p_space_id;
   if not found or v_space.nature<>p_scope then raise exception 'Space not found'; end if;
   if not exists(select 1 from public.ming_space_members where space_id=p_space_id and user_id=v_user and approved=true) then raise exception 'Approved Space membership required'; end if;
 end if;
 insert into public.tweaklr_statuses(author_id,scope,space_id,status_type,caption,media_path,media_mime,text_background,audience,included_user_ids,excluded_user_ids)
 values(v_user,p_scope,p_space_id,p_status_type,left(coalesce(p_caption,''),700),p_media_path,p_media_mime,
   case when p_text_background in ('#5B332A','#8B3543','#263B52','#315448','#5A4775','#202020') then p_text_background else '#5B332A' end,
   case when p_scope='main' then coalesce(p_audience,'connections') else 'space' end,
   case when p_scope='main' then coalesce(p_included_user_ids,'{}') else '{}' end,
   case when p_scope='main' then coalesce(p_excluded_user_ids,'{}') else '{}' end)
 returning id into v_id;
 return v_id;
end $$;

create or replace function public.get_tweaklr_statuses(p_scope text,p_space_id uuid default null)
returns table(id uuid,author_id uuid,status_type text,caption text,media_path text,media_mime text,text_background text,created_at timestamptz,expires_at timestamptz,view_count integer,viewed boolean,is_mine boolean,my_reaction text,author_username text,author_display_name text,author_avatar_url text)
language sql stable security definer set search_path=public as $$
 select s.id,s.author_id,s.status_type,s.caption,s.media_path,s.media_mime,s.text_background,s.created_at,s.expires_at,
   (select count(*)::integer from public.tweaklr_status_views v where v.status_id=s.id),
   exists(select 1 from public.tweaklr_status_views v where v.status_id=s.id and v.viewer_id=auth.uid()),
   s.author_id=auth.uid(),
   (select r.reaction from public.tweaklr_status_reactions r where r.status_id=s.id and r.user_id=auth.uid()),
   p.username,p.display_name,p.avatar_url
 from public.tweaklr_statuses s join public.profiles p on p.id=s.author_id
 where s.scope=p_scope and s.space_id is not distinct from p_space_id
   and s.expires_at>now() and public.tweaklr_status_can_view(s,auth.uid())
 order by s.created_at asc;
$$;

create or replace function public.mark_tweaklr_status_viewed(p_status_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_status public.tweaklr_statuses;
begin
 select * into v_status from public.tweaklr_statuses where id=p_status_id;
 if not found or not public.tweaklr_status_can_view(v_status,auth.uid()) then raise exception 'Status unavailable'; end if;
 if v_status.author_id=auth.uid() then return false; end if;
 insert into public.tweaklr_status_views(status_id,viewer_id) values(p_status_id,auth.uid()) on conflict do nothing;
 return true;
end $$;

create or replace function public.get_tweaklr_status_viewers(p_status_id uuid)
returns table(viewer_id uuid,viewed_at timestamptz,username text,display_name text,avatar_url text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.tweaklr_statuses s where s.id=p_status_id and s.author_id=auth.uid()) then raise exception 'Only the status owner can see viewers'; end if;
 return query select v.viewer_id,v.viewed_at,p.username,p.display_name,p.avatar_url
 from public.tweaklr_status_views v join public.profiles p on p.id=v.viewer_id
 where v.status_id=p_status_id order by v.viewed_at desc;
end $$;

create or replace function public.delete_tweaklr_status(p_status_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_path text;
begin
 delete from public.tweaklr_statuses where id=p_status_id and author_id=auth.uid() returning media_path into v_path;
 if not found then raise exception 'Status not found or you cannot delete it'; end if;
 return v_path;
end $$;

create or replace function public.set_tweaklr_status_reaction(p_status_id uuid,p_reaction text)
returns text language plpgsql security definer set search_path=public as $$
declare v_status public.tweaklr_statuses; v_existing text;
begin
 select * into v_status from public.tweaklr_statuses where id=p_status_id;
 if not found or not public.tweaklr_status_can_view(v_status,auth.uid()) then raise exception 'Status unavailable'; end if;
 if p_reaction not in ('❤️','😂','😮','😢','👏','🔥') then raise exception 'Unsupported reaction'; end if;
 select reaction into v_existing from public.tweaklr_status_reactions where status_id=p_status_id and user_id=auth.uid();
 if v_existing=p_reaction then delete from public.tweaklr_status_reactions where status_id=p_status_id and user_id=auth.uid(); return null; end if;
 insert into public.tweaklr_status_reactions(status_id,user_id,reaction) values(p_status_id,auth.uid(),p_reaction)
 on conflict(status_id,user_id) do update set reaction=excluded.reaction,created_at=now();
 return p_reaction;
end $$;

create or replace function public.toggle_tweaklr_status_mute(p_author_id uuid,p_muted boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_author_id=auth.uid() then raise exception 'You cannot mute your own statuses'; end if;
 if p_muted then insert into public.tweaklr_status_mutes(user_id,author_id) values(auth.uid(),p_author_id) on conflict do nothing;
 else delete from public.tweaklr_status_mutes where user_id=auth.uid() and author_id=p_author_id; end if;
 return p_muted;
end $$;

revoke all on function public.tweaklr_status_can_view(public.tweaklr_statuses,uuid) from public,anon;
revoke all on function public.create_tweaklr_status(text,uuid,text,text,text,text,text,text,uuid[],uuid[]) from public,anon;
revoke all on function public.get_tweaklr_statuses(text,uuid) from public,anon;
revoke all on function public.mark_tweaklr_status_viewed(uuid) from public,anon;
revoke all on function public.get_tweaklr_status_viewers(uuid) from public,anon;
revoke all on function public.delete_tweaklr_status(uuid) from public,anon;
revoke all on function public.set_tweaklr_status_reaction(uuid,text) from public,anon;
revoke all on function public.toggle_tweaklr_status_mute(uuid,boolean) from public,anon;
grant execute on function public.create_tweaklr_status(text,uuid,text,text,text,text,text,text,uuid[],uuid[]) to authenticated;
grant execute on function public.get_tweaklr_statuses(text,uuid) to authenticated;
grant execute on function public.mark_tweaklr_status_viewed(uuid) to authenticated;
grant execute on function public.get_tweaklr_status_viewers(uuid) to authenticated;
grant execute on function public.delete_tweaklr_status(uuid) to authenticated;
grant execute on function public.set_tweaklr_status_reaction(uuid,text) to authenticated;
grant execute on function public.toggle_tweaklr_status_mute(uuid,boolean) to authenticated;
notify pgrst,'reload schema';


-- Per-user read receipt preference, matching WhatsApp Status behaviour.
create table if not exists public.tweaklr_status_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  read_receipts boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.tweaklr_status_settings enable row level security;
revoke all on public.tweaklr_status_settings from anon,authenticated;

create or replace function public.get_tweaklr_status_read_receipts()
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select s.read_receipts from public.tweaklr_status_settings s where s.user_id=auth.uid()),true);
$$;

create or replace function public.set_tweaklr_status_read_receipts(p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.tweaklr_status_settings(user_id,read_receipts,updated_at)
 values(auth.uid(),coalesce(p_enabled,true),now())
 on conflict(user_id) do update set read_receipts=excluded.read_receipts,updated_at=now();
 return coalesce(p_enabled,true);
end $$;

create or replace function public.mark_tweaklr_status_viewed(p_status_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_status public.tweaklr_statuses;
begin
 select * into v_status from public.tweaklr_statuses where id=p_status_id;
 if not found or not public.tweaklr_status_can_view(v_status,auth.uid()) then raise exception 'Status unavailable'; end if;
 if v_status.author_id=auth.uid() then return false; end if;
 if not public.get_tweaklr_status_read_receipts() then return false; end if;
 insert into public.tweaklr_status_views(status_id,viewer_id) values(p_status_id,auth.uid()) on conflict do nothing;
 return true;
end $$;

create or replace function public.get_tweaklr_status_viewers(p_status_id uuid)
returns table(viewer_id uuid,viewed_at timestamptz,username text,display_name text,avatar_url text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.tweaklr_statuses s where s.id=p_status_id and s.author_id=auth.uid()) then raise exception 'Only the status owner can see viewers'; end if;
 if not public.get_tweaklr_status_read_receipts() then return; end if;
 return query select v.viewer_id,v.viewed_at,p.username,p.display_name,p.avatar_url
 from public.tweaklr_status_views v join public.profiles p on p.id=v.viewer_id
 where v.status_id=p_status_id order by v.viewed_at desc;
end $$;

revoke all on function public.get_tweaklr_status_read_receipts() from public,anon;
revoke all on function public.set_tweaklr_status_read_receipts(boolean) from public,anon;
grant execute on function public.get_tweaklr_status_read_receipts() to authenticated;
grant execute on function public.set_tweaklr_status_read_receipts(boolean) to authenticated;
notify pgrst,'reload schema';
