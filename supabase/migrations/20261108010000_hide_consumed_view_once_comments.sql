-- Permanently hide a consumed view-once voice comment from that listener's
-- comment query. The comment and audio remain available to other eligible users.
-- The existing atomic claim RPC records the authenticated listener in voice_viewed_by.
begin;

create or replace function public.get_ming_business_space_post_comments(
  p_content_id uuid
)
returns setof jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'id', c.id,
    'body', c.body,
    'anonymous', c.visibility = 'anonymous',
    'private_to_author', c.visibility = 'private_to_post_author',
    'voice_path', c.voice_path,
    'voice_duration', c.voice_duration,
    'voice_view_once', c.voice_view_once,
    'voice_viewed', (select auth.uid()) = any(c.voice_viewed_by),
    'created_at_ms', floor(extract(epoch from c.created_at) * 1000)::bigint,
    'author_display_name',
      case when c.visibility = 'anonymous' then null
           else coalesce(pr.display_name, pr.username, 'Space member') end,
    'author_username',
      case when c.visibility = 'anonymous' then null else pr.username end,
    'author_avatar_url',
      case when c.visibility = 'anonymous' then null else pr.avatar_url end
  )
  from public.ming_comments c
  join public.ming_space_content p
    on p.id = c.target_id
   and p.kind = 'business_post'
  join public.ming_spaces s
    on s.id = c.space_id
   and s.nature = 'business'
  join public.ming_space_members m
    on m.space_id = c.space_id
   and m.user_id = (select auth.uid())
   and m.approved = true
  left join public.profiles pr on pr.id = c.author_id
  where c.target_type = 'space_content'
    and c.target_id = p_content_id
    and (
      c.visibility <> 'private_to_post_author'
      or c.author_id = (select auth.uid())
      or p.author_id = (select auth.uid())
    )
    and not (
      c.voice_view_once
      and (select auth.uid()) = any(coalesce(c.voice_viewed_by, '{}'::uuid[]))
    )
  order by c.created_at asc;
$function$;

create or replace function public.get_ming_friendship_space_post_comments(p_content_id uuid)
returns setof jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'id', c.id,
    'parent_comment_id', c.parent_comment_id,
    'is_mine', c.author_id = (select auth.uid()),
    'body', c.body,
    'anonymous', c.visibility = 'anonymous',
    'private_to_author', c.visibility = 'private_to_post_author',
    'voice_path', case
      when (select auth.uid()) = any(coalesce(c.voice_viewed_by, '{}'::uuid[])) then null
      else c.voice_path
    end,
    'voice_duration', c.voice_duration,
    'voice_view_once', c.voice_view_once,
    'voice_viewed', (select auth.uid()) = any(coalesce(c.voice_viewed_by, '{}'::uuid[])),
    'created_at_ms', floor(extract(epoch from c.created_at) * 1000)::bigint,
    'author_display_name', case when c.visibility = 'anonymous' then null else coalesce(pr.display_name, pr.username, 'Space member') end,
    'author_username', case when c.visibility = 'anonymous' then null else pr.username end,
    'author_avatar_url', case when c.visibility = 'anonymous' then null else pr.avatar_url end
  )
  from public.ming_comments c
  join public.ming_space_content p on p.id = c.target_id and p.kind = 'friend_post'
  join public.ming_spaces s on s.id = c.space_id and s.nature = 'friendly'
  join public.ming_space_members m on m.space_id = c.space_id and m.user_id = (select auth.uid()) and m.approved = true
  left join public.profiles pr on pr.id = c.author_id
  where c.target_type = 'space_content'
    and c.target_id = p_content_id
    and (c.visibility <> 'private_to_post_author' or c.author_id = (select auth.uid()) or p.author_id = (select auth.uid()))
    and not (
      c.voice_view_once
      and (select auth.uid()) = any(coalesce(c.voice_viewed_by, '{}'::uuid[]))
    )
  order by c.created_at asc;
$function$;

revoke all on function public.get_ming_business_space_post_comments(uuid) from public, anon;
revoke all on function public.get_ming_friendship_space_post_comments(uuid) from public, anon;
grant execute on function public.get_ming_business_space_post_comments(uuid) to authenticated;
grant execute on function public.get_ming_friendship_space_post_comments(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
