-- Tweaklr activity discussion
-- Activity comments are visible and writable only to the activity host and joined participants.
begin;

create table if not exists public.daily_update_activity_comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.daily_updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists daily_update_activity_comments_activity_idx
  on public.daily_update_activity_comments(update_id, created_at);

alter table public.daily_update_activity_comments enable row level security;
revoke all on table public.daily_update_activity_comments from public, anon, authenticated;

create or replace function public.can_access_daily_update_activity(p_update_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.daily_updates du
    where du.id = p_update_id and du.kind = 'activity'
      and (
        du.author_id = p_user_id
        or exists (
          select 1 from public.daily_update_participants dup
          where dup.update_id = du.id and dup.user_id = p_user_id
        )
      )
  );
$function$;

create or replace function public.get_daily_update_activity_comments(p_update_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_access_daily_update_activity(p_update_id, auth.uid()) then
    raise exception 'Join this activity to view its discussion';
  end if;

  return query
  select jsonb_build_object(
    'id', c.id,
    'body', c.body,
    'user_id', c.user_id,
    'created_at', c.created_at,
    'author_display_name', coalesce(pr.display_name, pr.username, 'Tweaklr member'),
    'author_username', pr.username,
    'author_avatar_url', pr.avatar_url,
    'is_mine', c.user_id = auth.uid()
  )
  from public.daily_update_activity_comments c
  left join public.profiles pr on pr.id = c.user_id
  where c.update_id = p_update_id
  order by c.created_at asc;
end;
$function$;

create or replace function public.add_daily_update_activity_comment(p_update_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_comment public.daily_update_activity_comments;
  v_profile public.profiles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Comment must be between 1 and 1000 characters';
  end if;
  if not public.can_access_daily_update_activity(p_update_id, v_user) then
    raise exception 'Join this activity before commenting';
  end if;

  insert into public.daily_update_activity_comments(update_id, user_id, body)
  values (p_update_id, v_user, btrim(p_body))
  returning * into v_comment;

  select * into v_profile from public.profiles where id = v_user;
  return jsonb_build_object(
    'id', v_comment.id,
    'body', v_comment.body,
    'user_id', v_user,
    'created_at', v_comment.created_at,
    'author_display_name', coalesce(v_profile.display_name, v_profile.username, 'Tweaklr member'),
    'author_username', v_profile.username,
    'author_avatar_url', v_profile.avatar_url,
    'is_mine', true
  );
end;
$function$;

create or replace function public.get_daily_update_activity_comment_count(p_update_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::bigint
  from public.daily_update_activity_comments
  where update_id = p_update_id
    and (select auth.uid()) is not null
    and public.can_access_daily_update_activity(p_update_id, (select auth.uid()));
$function$;

create or replace function public.get_daily_update_activity_comment_counts(p_update_ids uuid[])
returns table(update_id uuid, comments_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.update_id, count(*)::bigint
  from public.daily_update_activity_comments c
  where c.update_id = any(coalesce(p_update_ids, '{}'::uuid[]))
    and (select auth.uid()) is not null
    and public.can_access_daily_update_activity(c.update_id, (select auth.uid()))
  group by c.update_id;
$function$;

revoke all on function public.get_daily_update_activity_comment_counts(uuid[]) from public, anon;
grant execute on function public.get_daily_update_activity_comment_counts(uuid[]) to authenticated;

revoke all on function public.can_access_daily_update_activity(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_daily_update_activity_comments(uuid) from public, anon;
revoke all on function public.add_daily_update_activity_comment(uuid,text) from public, anon;
revoke all on function public.get_daily_update_activity_comment_count(uuid) from public, anon;
grant execute on function public.can_access_daily_update_activity(uuid,uuid) to authenticated;
grant execute on function public.get_daily_update_activity_comments(uuid) to authenticated;
grant execute on function public.add_daily_update_activity_comment(uuid,text) to authenticated;
grant execute on function public.get_daily_update_activity_comment_count(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
