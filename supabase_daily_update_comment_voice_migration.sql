-- Home Daily Update comments: Business Space-style voice notes and private audio access.
alter table public.daily_update_comments
  add column if not exists voice_path text,
  add column if not exists voice_duration integer;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ming-daily-update-comment-voice','ming-daily-update-comment-voice',false,10485760,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict (id) do update
set public=false, file_size_limit=10485760,
    allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.can_read_daily_update_comment_voice(p_voice_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.daily_update_comments c
    join public.daily_updates u on u.id = c.update_id
    where c.voice_path = p_voice_path
      and ((u.created_at > now() - interval '24 hours')
        or u.author_id = (select auth.uid())
        or c.author_id = (select auth.uid()))
      and (c.is_private = false
        or c.author_id = (select auth.uid())
        or u.author_id = (select auth.uid()))
      and not private.tweaklr_is_blocked(c.author_id)
  );
$function$;

revoke all on function private.can_read_daily_update_comment_voice(text) from public, anon;
grant execute on function private.can_read_daily_update_comment_voice(text) to authenticated;

drop policy if exists "Daily update comment voice read permitted" on storage.objects;
create policy "Daily update comment voice read permitted"
on storage.objects for select to authenticated
using (bucket_id = 'ming-daily-update-comment-voice'
  and private.can_read_daily_update_comment_voice(name));

drop policy if exists "Daily update comment voice upload own" on storage.objects;
create policy "Daily update comment voice upload own"
on storage.objects for insert to authenticated
with check (bucket_id = 'ming-daily-update-comment-voice'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Daily update comment voice delete own" on storage.objects;
create policy "Daily update comment voice delete own"
on storage.objects for delete to authenticated
using (bucket_id = 'ming-daily-update-comment-voice'
  and owner_id = (select auth.uid())::text);

drop function if exists public.get_daily_update_comments(uuid);
create function public.get_daily_update_comments(p_update_id uuid)
returns table (
  id uuid, author_id uuid, body text, created_at timestamptz,
  author_username text, author_display_name text, author_avatar_url text,
  parent_comment_id uuid, updated_at timestamptz, likes_count bigint,
  liked_by_me boolean, is_anonymous boolean, is_private boolean,
  voice_path text, voice_duration integer
)
language sql stable security definer
set search_path = ''
as $function$
  select
    c.id,
    case when c.is_anonymous
           and c.author_id <> (select auth.uid())
           and u.author_id <> (select auth.uid())
         then null else c.author_id end,
    c.body, c.created_at,
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
    c.parent_comment_id, c.updated_at,
    (select count(*)::bigint from public.daily_update_comment_likes l where l.comment_id = c.id),
    exists (select 1 from public.daily_update_comment_likes l
      where l.comment_id = c.id and l.user_id = (select auth.uid())),
    c.is_anonymous, c.is_private, c.voice_path, c.voice_duration
  from public.daily_update_comments c
  join public.daily_updates u on u.id = c.update_id
  join public.profiles p on p.id = c.author_id
  where c.update_id = p_update_id
    and (select auth.uid()) is not null
    and (u.created_at > now() - interval '24 hours'
      or u.author_id = (select auth.uid())
      or c.author_id = (select auth.uid()))
    and not private.tweaklr_is_blocked(c.author_id)
    and (c.is_private = false
      or c.author_id = (select auth.uid())
      or u.author_id = (select auth.uid()))
  order by c.created_at asc;
$function$;

revoke all on function public.get_daily_update_comments(uuid) from public, anon;
grant execute on function public.get_daily_update_comments(uuid) to authenticated;
