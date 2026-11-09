alter table public.tweaklr_status_views
  add column if not exists receipt_visible boolean not null default true;

create or replace function public.mark_tweaklr_status_viewed(p_status_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status public.tweaklr_statuses;
  v_receipt_visible boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_status
  from public.tweaklr_statuses
  where id = p_status_id;

  if not found or not public.tweaklr_status_can_view(v_status, auth.uid()) then
    raise exception 'Status unavailable';
  end if;

  if v_status.author_id = auth.uid() then
    return false;
  end if;

  -- Always record consumption for the viewer's own read state. The
  -- preference controls whether that view is disclosed to the author.
  v_receipt_visible := public.get_tweaklr_status_read_receipts();

  insert into public.tweaklr_status_views(status_id, viewer_id, receipt_visible)
  values (p_status_id, auth.uid(), v_receipt_visible)
  on conflict (status_id, viewer_id) do nothing;

  return true;
end
$function$;

create or replace function public.get_tweaklr_statuses(p_scope text, p_space_id uuid default null)
returns table(
  id uuid, author_id uuid, status_type text, caption text, media_path text,
  media_mime text, text_background text, created_at timestamptz,
  expires_at timestamptz, view_count integer, viewed boolean, is_mine boolean,
  my_reaction text, author_username text, author_display_name text,
  author_avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    s.id, s.author_id, s.status_type, s.caption, s.media_path, s.media_mime,
    s.text_background, s.created_at, s.expires_at,
    case
      when s.author_id = auth.uid()
       and public.get_tweaklr_status_read_receipts()
      then (
        select count(*)::integer
        from public.tweaklr_status_views v
        where v.status_id = s.id and v.receipt_visible = true
      )
      else 0
    end,
    exists (
      select 1 from public.tweaklr_status_views v
      where v.status_id = s.id and v.viewer_id = auth.uid()
    ),
    s.author_id = auth.uid(),
    (
      select r.reaction from public.tweaklr_status_reactions r
      where r.status_id = s.id and r.user_id = auth.uid()
    ),
    p.username, p.display_name, p.avatar_url
  from public.tweaklr_statuses s
  join public.profiles p on p.id = s.author_id
  where s.scope = p_scope
    and s.space_id is not distinct from p_space_id
    and s.expires_at > now()
    and public.tweaklr_status_can_view(s, auth.uid())
  order by s.created_at asc;
$function$;

create or replace function public.get_tweaklr_status_viewers(p_status_id uuid)
returns table(
  viewer_id uuid, viewed_at timestamptz, username text,
  display_name text, avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.tweaklr_statuses s
    where s.id = p_status_id and s.author_id = auth.uid()
  ) then
    raise exception 'Only the status owner can see viewers';
  end if;

  if not public.get_tweaklr_status_read_receipts() then
    return;
  end if;

  return query
  select v.viewer_id, v.viewed_at, p.username, p.display_name, p.avatar_url
  from public.tweaklr_status_views v
  join public.profiles p on p.id = v.viewer_id
  where v.status_id = p_status_id and v.receipt_visible = true
  order by v.viewed_at desc;
end
$function$;

revoke all on function public.mark_tweaklr_status_viewed(uuid) from public, anon;
revoke all on function public.get_tweaklr_statuses(text, uuid) from public, anon;
revoke all on function public.get_tweaklr_status_viewers(uuid) from public, anon;
grant execute on function public.mark_tweaklr_status_viewed(uuid) to authenticated;
grant execute on function public.get_tweaklr_statuses(text, uuid) to authenticated;
grant execute on function public.get_tweaklr_status_viewers(uuid) to authenticated;

notify pgrst, 'reload schema';
