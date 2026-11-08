-- Tweaklr Friendly Space activity discussion
-- Apply this migration in the Supabase SQL Editor before enabling activity comments.

create table if not exists public.ming_friendly_activity_comments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  activity_content_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ming_friendly_activity_comments_activity_created_idx
  on public.ming_friendly_activity_comments (activity_content_id, created_at);

alter table public.ming_friendly_activity_comments enable row level security;
revoke all on public.ming_friendly_activity_comments from public, anon, authenticated;

create or replace function public.ming_can_access_friendly_activity(p_content_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ming_space_content a
    join public.ming_space_members m
      on m.space_id = a.space_id
     and m.user_id = p_user_id
     and m.approved is true
    where a.id = p_content_id
      and a.kind = 'friend_post'
      and a.payload ->> 'postFormat' = 'activity'
      and (
        a.author_id = p_user_id
        or exists (
          select 1
          from public.ming_space_content r
          where r.space_id = a.space_id
            and r.kind = 'friend_post'
            and r.author_id = p_user_id
            and r.payload ->> 'postFormat' = 'activity_rsvp'
            and r.payload ->> 'parentId' = a.id::text
        )
      )
  );
$$;

create or replace function public.get_ming_friendly_activity_comments(p_content_id uuid)
returns table (id uuid, author_id uuid, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.ming_can_access_friendly_activity(p_content_id, auth.uid()) then
    raise exception 'Join this activity before viewing its discussion.';
  end if;
  return query
  select c.id, c.author_id, c.body, c.created_at
  from public.ming_friendly_activity_comments c
  where c.activity_content_id = p_content_id
  order by c.created_at asc;
end;
$$;

create or replace function public.add_ming_friendly_activity_comment(p_content_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_comment_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Please sign in to comment.'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'Comments must be between 1 and 1,000 characters.';
  end if;
  if not public.ming_can_access_friendly_activity(p_content_id, auth.uid()) then
    raise exception 'Join this activity before commenting.';
  end if;
  select a.space_id into v_space_id
  from public.ming_space_content a
  where a.id = p_content_id and a.kind = 'friend_post'
    and a.payload ->> 'postFormat' = 'activity';
  insert into public.ming_friendly_activity_comments
    (space_id, activity_content_id, author_id, body)
  values (v_space_id, p_content_id, auth.uid(), v_body)
  returning id into v_comment_id;
  return v_comment_id;
end;
$$;

revoke all on function public.ming_can_access_friendly_activity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_ming_friendly_activity_comments(uuid) from public, anon;
revoke all on function public.add_ming_friendly_activity_comment(uuid, text) from public, anon;
grant execute on function public.get_ming_friendly_activity_comments(uuid) to authenticated;
grant execute on function public.add_ming_friendly_activity_comment(uuid, text) to authenticated;
