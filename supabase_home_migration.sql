-- Ming Home: real Daily Updates backend
-- Run this once in the Supabase SQL Editor before using the new Home feed.

create table if not exists public.daily_updates (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'general'
    check (kind in ('service','hiring','alert','sale','talk','visitor','activity','general')),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists daily_updates_created_idx
on public.daily_updates(created_at desc);

create index if not exists daily_updates_author_idx
on public.daily_updates(author_id, created_at desc);

alter table public.daily_updates enable row level security;

revoke all on table public.daily_updates from anon;
grant select, insert, delete on table public.daily_updates to authenticated;

drop policy if exists "Authenticated users can read daily updates" on public.daily_updates;
create policy "Authenticated users can read daily updates"
on public.daily_updates
for select
to authenticated
using (true);

drop policy if exists "Users can create their own daily updates" on public.daily_updates;
create policy "Users can create their own daily updates"
on public.daily_updates
for insert
to authenticated
with check ((select auth.uid()) = author_id);

drop policy if exists "Users can delete their own daily updates" on public.daily_updates;
create policy "Users can delete their own daily updates"
on public.daily_updates
for delete
to authenticated
using ((select auth.uid()) = author_id);


create table if not exists public.daily_update_likes (
  update_id uuid not null references public.daily_updates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

create index if not exists daily_update_likes_update_idx
on public.daily_update_likes(update_id);

alter table public.daily_update_likes enable row level security;

revoke all on table public.daily_update_likes from anon;
grant select, insert, delete on table public.daily_update_likes to authenticated;

drop policy if exists "Authenticated users can read update likes" on public.daily_update_likes;
create policy "Authenticated users can read update likes"
on public.daily_update_likes
for select
to authenticated
using (true);

drop policy if exists "Users can like updates as themselves" on public.daily_update_likes;
create policy "Users can like updates as themselves"
on public.daily_update_likes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own update likes" on public.daily_update_likes;
create policy "Users can remove their own update likes"
on public.daily_update_likes
for delete
to authenticated
using ((select auth.uid()) = user_id);


create table if not exists public.daily_update_comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.daily_updates(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists daily_update_comments_update_idx
on public.daily_update_comments(update_id, created_at asc);

alter table public.daily_update_comments enable row level security;

revoke all on table public.daily_update_comments from anon;
grant select, insert, delete on table public.daily_update_comments to authenticated;

drop policy if exists "Authenticated users can read update comments" on public.daily_update_comments;
create policy "Authenticated users can read update comments"
on public.daily_update_comments
for select
to authenticated
using (true);

drop policy if exists "Users can create their own update comments" on public.daily_update_comments;
create policy "Users can create their own update comments"
on public.daily_update_comments
for insert
to authenticated
with check ((select auth.uid()) = author_id);

drop policy if exists "Users can delete their own update comments" on public.daily_update_comments;
create policy "Users can delete their own update comments"
on public.daily_update_comments
for delete
to authenticated
using ((select auth.uid()) = author_id);

drop function if exists public.get_daily_updates(integer);
create or replace function public.get_daily_updates(
  p_limit integer default 50
)
returns table (
  id uuid,
  author_id uuid,
  kind text,
  title text,
  body text,
  created_at timestamptz,
  likes integer,
  liked boolean,
  comments_count integer,
  author_username text,
  author_display_name text,
  author_avatar_url text,
  author_bio text,
  author_headline text,
  author_activity text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.id,
    u.author_id,
    u.kind,
    u.title,
    u.body,
    u.created_at,
    (
      select count(*)::integer
      from public.daily_update_likes l
      where l.update_id = u.id
    ) as likes,
    exists (
      select 1
      from public.daily_update_likes l
      where l.update_id = u.id
        and l.user_id = auth.uid()
    ) as liked,
    (
      select count(*)::integer
      from public.daily_update_comments c
      where c.update_id = u.id
    ) as comments_count,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.headline,
    p.activity
  from public.daily_updates u
  join public.profiles p on p.id = u.author_id
  where u.created_at > now() - interval '24 hours'
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_daily_updates(integer) from public, anon;
grant execute on function public.get_daily_updates(integer) to authenticated;


create or replace function public.get_daily_update_comments(
  p_update_id uuid
)
returns table (
  id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id,
    c.author_id,
    c.body,
    c.created_at,
    p.username,
    p.display_name,
    p.avatar_url
  from public.daily_update_comments c
  join public.profiles p on p.id = c.author_id
  where c.update_id = p_update_id
  order by c.created_at asc;
$$;

revoke all on function public.get_daily_update_comments(uuid) from public, anon;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;
