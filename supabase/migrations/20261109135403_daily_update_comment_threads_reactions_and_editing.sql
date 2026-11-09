begin;
alter table public.daily_update_comments
  add column if not exists parent_comment_id uuid references public.daily_update_comments(id) on delete cascade,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists daily_update_comments_parent_created_idx on public.daily_update_comments(parent_comment_id, created_at) where parent_comment_id is not null;
create index if not exists daily_update_comments_update_created_idx on public.daily_update_comments(update_id, created_at);
create table if not exists public.daily_update_comment_likes (
  comment_id uuid not null references public.daily_update_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.daily_update_comment_likes enable row level security;
revoke all on table public.daily_update_comment_likes from public, anon, authenticated;

create or replace function public.validate_daily_update_comment_parent()
returns trigger language plpgsql set search_path = '' as $function$
declare v_parent_update uuid; v_parent_parent uuid;
begin
  if new.parent_comment_id is null then return new; end if;
  select c.update_id, c.parent_comment_id into v_parent_update, v_parent_parent
  from public.daily_update_comments c where c.id = new.parent_comment_id;
  if not found or v_parent_update <> new.update_id then raise exception 'Reply target does not belong to this update'; end if;
  if v_parent_parent is not null then raise exception 'Replies can only be one level deep'; end if;
  if new.parent_comment_id = new.id then raise exception 'A comment cannot reply to itself'; end if;
  return new;
end;
$function$;
drop trigger if exists daily_update_comment_parent_guard on public.daily_update_comments;
create trigger daily_update_comment_parent_guard before insert or update of parent_comment_id, update_id
on public.daily_update_comments for each row execute function public.validate_daily_update_comment_parent();

drop function if exists public.get_daily_update_comments(uuid);
create function public.get_daily_update_comments(p_update_id uuid)
returns table (
  id uuid, author_id uuid, body text, created_at timestamptz,
  author_username text, author_display_name text, author_avatar_url text,
  parent_comment_id uuid, updated_at timestamptz, likes_count bigint, liked_by_me boolean
)
language sql stable security definer set search_path = '' as $function$
  select c.id,c.author_id,c.body,c.created_at,p.username,p.display_name,p.avatar_url,
    c.parent_comment_id,c.updated_at,
    (select count(*)::bigint from public.daily_update_comment_likes l where l.comment_id=c.id),
    exists(select 1 from public.daily_update_comment_likes l where l.comment_id=c.id and l.user_id=(select auth.uid()))
  from public.daily_update_comments c
  join public.profiles p on p.id=c.author_id
  where c.update_id=p_update_id and (select auth.uid()) is not null
    and not private.tweaklr_is_blocked(c.author_id)
    and exists(select 1 from public.daily_updates u where u.id=p_update_id and u.created_at>now()-interval '24 hours')
  order by c.created_at asc;
$function$;

create or replace function public.toggle_daily_update_comment_like(p_comment_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_user uuid := (select auth.uid()); v_author uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.author_id into v_author from public.daily_update_comments c
  join public.daily_updates u on u.id=c.update_id
  where c.id=p_comment_id and u.created_at>now()-interval '24 hours';
  if not found then raise exception 'Comment is no longer available'; end if;
  if private.tweaklr_is_blocked(v_author) then raise exception 'This comment is unavailable'; end if;
  delete from public.daily_update_comment_likes where comment_id=p_comment_id and user_id=v_user;
  if found then return false; end if;
  insert into public.daily_update_comment_likes(comment_id,user_id) values(p_comment_id,v_user) on conflict do nothing;
  return true;
end;
$function$;

create or replace function public.edit_daily_update_comment(p_comment_id uuid,p_body text)
returns timestamptz language plpgsql security definer set search_path = '' as $function$
declare v_user uuid := (select auth.uid()); v_updated timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 1000 then raise exception 'Comment must be between 1 and 1000 characters'; end if;
  update public.daily_update_comments c set body=btrim(p_body),updated_at=now()
  from public.daily_updates u
  where c.id=p_comment_id and c.author_id=v_user and u.id=c.update_id and u.created_at>now()-interval '24 hours'
  returning c.updated_at into v_updated;
  if v_updated is null then raise exception 'You can only edit your own comment on an active update'; end if;
  return v_updated;
end;
$function$;

revoke all on function public.validate_daily_update_comment_parent() from public,anon,authenticated;
revoke all on function public.get_daily_update_comments(uuid) from public,anon;
revoke all on function public.toggle_daily_update_comment_like(uuid) from public,anon;
revoke all on function public.edit_daily_update_comment(uuid,text) from public,anon;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;
grant execute on function public.toggle_daily_update_comment_like(uuid) to authenticated;
grant execute on function public.edit_daily_update_comment(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;