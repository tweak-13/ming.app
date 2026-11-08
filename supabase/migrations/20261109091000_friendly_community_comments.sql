-- Friendly Community comments and creator-only deletion.
begin;

create or replace function public.get_ming_friendly_community_comments(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
stable
as $function$
declare v_user uuid := (select auth.uid()); v_community uuid; v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select community_id into v_community from public.ming_friendly_community_posts where id=p_post_id;
  if not found or not exists(select 1 from public.ming_friendly_community_members where community_id=v_community and user_id=v_user and status='approved') then
    raise exception 'Post unavailable or community membership required';
  end if;
  select jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'author_id',c.author_id,'body',c.body,'created_at',c.created_at,
    'author_name',coalesce(pr.display_name,pr.username,'Community member'),
    'author_username',pr.username,'author_avatar_url',pr.avatar_url
  ) order by c.created_at asc),'[]'::jsonb))
  into v_result
  from public.ming_friendly_community_comments c
  left join public.profiles pr on pr.id=c.author_id
  where c.post_id=p_post_id;
  return v_result;
end;
$function$;

create or replace function public.delete_ming_friendly_community(p_community_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.ming_friendly_community_members where community_id=p_community_id and user_id=v_user and role='owner' and status='approved') then
    raise exception 'Only the community creator can delete this community';
  end if;
  delete from public.ming_friendly_communities where id=p_community_id;
  return jsonb_build_object('success',true);
end;
$function$;

revoke all on function public.get_ming_friendly_community_comments(uuid) from public,anon;
revoke all on function public.delete_ming_friendly_community(uuid) from public,anon;
grant execute on function public.get_ming_friendly_community_comments(uuid) to authenticated;
grant execute on function public.delete_ming_friendly_community(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
