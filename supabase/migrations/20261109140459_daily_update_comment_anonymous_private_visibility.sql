alter table public.daily_update_comments
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists is_private boolean not null default false;

drop policy if exists "Authenticated users can read update comments" on public.daily_update_comments;
drop policy if exists "Users can create their own update comments" on public.daily_update_comments;

create policy "Users can read visible Daily Update comments"
on public.daily_update_comments for select to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.daily_updates u
    where u.id = daily_update_comments.update_id
      and u.author_id = (select auth.uid())
  )
  or (
    is_private = false
    and exists (
      select 1 from public.daily_updates u
      where u.id = daily_update_comments.update_id
        and u.created_at > now() - interval '24 hours'
    )
  )
);

create policy "Users can create own visible Daily Update comments"
on public.daily_update_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.daily_updates u
    where u.id = daily_update_comments.update_id
      and u.created_at > now() - interval '24 hours'
  )
  and (
    parent_comment_id is null
    or exists (
      select 1 from public.daily_update_comments parent
      where parent.id = daily_update_comments.parent_comment_id
        and parent.update_id = daily_update_comments.update_id
        and parent.parent_comment_id is null
        and parent.is_private = daily_update_comments.is_private
    )
  )
);

drop function if exists public.get_daily_update_comments(uuid);
create function public.get_daily_update_comments(p_update_id uuid)
returns table(
  id uuid, author_id uuid, body text, created_at timestamptz,
  author_username text, author_display_name text, author_avatar_url text,
  parent_comment_id uuid, updated_at timestamptz, likes_count bigint,
  liked_by_me boolean, is_anonymous boolean, is_private boolean
)
language sql stable security definer
set search_path = ''
as $function$
  select
    c.id,
    case when c.is_anonymous
           and c.author_id <> (select auth.uid())
           and u.author_id <> (select auth.uid())
         then null else c.author_id end as author_id,
    c.body,
    c.created_at,
    case when c.is_anonymous
           and c.author_id <> (select auth.uid())
           and u.author_id <> (select auth.uid())
         then 'anonymous'::text else p.username end,
    case when c.is_anonymous
           and c.author_id <> (select auth.uid())
           and u.author_id <> (select auth.uid())
         then 'Anonymous'::text else p.display_name end,
    case when c.is_anonymous
           and c.author_id <> (select auth.uid())
           and u.author_id <> (select auth.uid())
         then null::text else p.avatar_url end,
    c.parent_comment_id,
    c.updated_at,
    (select count(*)::bigint from public.daily_update_comment_likes l where l.comment_id = c.id),
    exists (
      select 1 from public.daily_update_comment_likes l
      where l.comment_id = c.id and l.user_id = (select auth.uid())
    ),
    c.is_anonymous,
    c.is_private
  from public.daily_update_comments c
  join public.daily_updates u on u.id = c.update_id
  join public.profiles p on p.id = c.author_id
  where c.update_id = p_update_id
    and (select auth.uid()) is not null
    and (u.created_at > now() - interval '24 hours' or u.author_id = (select auth.uid()) or c.author_id = (select auth.uid()))
    and (not private.tweaklr_is_blocked(c.author_id))
    and (c.is_private = false or c.author_id = (select auth.uid()) or u.author_id = (select auth.uid()))
  order by c.created_at asc;
$function$;

revoke all on function public.get_daily_update_comments(uuid) from public;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;

create or replace function public.toggle_daily_update_comment_like(p_comment_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_author uuid;
  v_update uuid;
  v_private boolean;
  v_owner uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.author_id, c.update_id, c.is_private, u.author_id
    into v_author, v_update, v_private, v_owner
  from public.daily_update_comments c
  join public.daily_updates u on u.id = c.update_id
  where c.id = p_comment_id
    and (u.created_at > now() - interval '24 hours' or u.author_id = v_user or c.author_id = v_user);
  if not found or (v_private and v_user not in (v_author, v_owner)) then
    raise exception 'Comment is no longer available';
  end if;
  if private.tweaklr_is_blocked(v_author) then raise exception 'This comment is unavailable'; end if;
  delete from public.daily_update_comment_likes where comment_id = p_comment_id and user_id = v_user;
  if found then return false; end if;
  insert into public.daily_update_comment_likes(comment_id, user_id) values (p_comment_id, v_user)
  on conflict do nothing;
  return true;
end;
$function$;

revoke all on function public.toggle_daily_update_comment_like(uuid) from public;
grant execute on function public.toggle_daily_update_comment_like(uuid) to authenticated;
