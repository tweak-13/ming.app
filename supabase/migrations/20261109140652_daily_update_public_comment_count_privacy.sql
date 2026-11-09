create or replace function public.get_daily_updates_unfiltered(p_limit integer default 50)
returns table(
  id uuid, author_id uuid, kind text, title text, body text, media jsonb,
  created_at timestamptz, likes integer, liked boolean, comments_count integer,
  author_username text, author_display_name text, author_avatar_url text,
  author_bio text, author_headline text, author_activity text
)
language sql stable security definer
set search_path = ''
as $function$
  select
    u.id,
    u.author_id,
    u.kind,
    u.title,
    u.body,
    coalesce(u.media, '[]'::jsonb) as media,
    u.created_at,
    (select count(*)::integer from public.daily_update_likes l where l.update_id = u.id) as likes,
    exists (
      select 1 from public.daily_update_likes l
      where l.update_id = u.id and l.user_id = auth.uid()
    ) as liked,
    (
      select count(*)::integer
      from public.daily_update_comments c
      where c.update_id = u.id and c.is_private = false
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
$function$;
