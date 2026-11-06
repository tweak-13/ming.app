-- Tweaklr Business Space comment replies and author deletion
-- Apply after 20261106020000_universal_comments_core.sql.
begin;

create or replace function public.get_ming_business_space_post_comments(p_content_id uuid)
returns setof jsonb
language sql security definer set search_path = '' stable
as $function$
  select jsonb_build_object(
    'id', c.id,
    'parent_comment_id', c.parent_comment_id,
    'is_mine', c.author_id = (select auth.uid()),
    'body', c.body,
    'anonymous', c.visibility = 'anonymous',
    'private_to_author', c.visibility = 'private_to_post_author',
    'voice_path', c.voice_path,
    'voice_duration', c.voice_duration,
    'voice_view_once', c.voice_view_once,
    'voice_viewed', (select auth.uid()) = any(c.voice_viewed_by),
    'created_at_ms', floor(extract(epoch from c.created_at) * 1000)::bigint,
    'author_display_name', case when c.visibility = 'anonymous' then null else coalesce(pr.display_name, pr.username, 'Space member') end,
    'author_username', case when c.visibility = 'anonymous' then null else pr.username end,
    'author_avatar_url', case when c.visibility = 'anonymous' then null else pr.avatar_url end
  )
  from public.ming_comments c
  join public.ming_space_content p on p.id = c.target_id and p.kind = 'business_post'
  join public.ming_spaces s on s.id = c.space_id and s.nature = 'business'
  join public.ming_space_members m on m.space_id = c.space_id and m.user_id = (select auth.uid()) and m.approved = true
  left join public.profiles pr on pr.id = c.author_id
  where c.target_type = 'space_content' and c.target_id = p_content_id
    and (c.visibility <> 'private_to_post_author' or c.author_id = (select auth.uid()) or p.author_id = (select auth.uid()))
  order by c.created_at asc;
$function$;

create or replace function public.add_ming_business_space_post_comment_reply(p_parent_comment_id uuid, p_text text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_parent public.ming_comments;
  v_comment public.ming_comments;
  v_profile public.profiles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'Write a reply first'; end if;
  if char_length(btrim(p_text)) > 1000 then raise exception 'Reply must be 1000 characters or fewer'; end if;

  select c.* into v_parent
  from public.ming_comments c
  join public.ming_space_content p on p.id = c.target_id and p.kind = 'business_post'
  join public.ming_spaces s on s.id = c.space_id and s.nature = 'business'
  join public.ming_space_members m on m.space_id = c.space_id and m.user_id = v_user and m.approved = true
  where c.id = p_parent_comment_id and c.target_type = 'space_content' and c.parent_comment_id is null
    and (c.visibility <> 'private_to_post_author' or c.author_id = v_user or p.author_id = v_user)
  for update of c;
  if not found then raise exception 'Comment is unavailable or cannot be replied to'; end if;

  insert into public.ming_comments(target_type,target_id,space_id,parent_comment_id,author_id,body,visibility)
  values('space_content',v_parent.target_id,v_parent.space_id,v_parent.id,v_user,btrim(p_text),v_parent.visibility)
  returning * into v_comment;

  select * into v_profile from public.profiles where id = v_user;
  return jsonb_build_object(
    'id',v_comment.id,'parent_comment_id',v_comment.parent_comment_id,'is_mine',true,'body',v_comment.body,
    'anonymous',v_comment.visibility='anonymous','private_to_author',v_comment.visibility='private_to_post_author',
    'voice_path',null,'voice_duration',null,'voice_view_once',false,'voice_viewed',false,
    'created_at_ms',floor(extract(epoch from v_comment.created_at)*1000)::bigint,
    'author_display_name',case when v_comment.visibility='anonymous' then null else coalesce(v_profile.display_name,v_profile.username,'Space member') end,
    'author_username',case when v_comment.visibility='anonymous' then null else v_profile.username end,
    'author_avatar_url',case when v_comment.visibility='anonymous' then null else v_profile.avatar_url end
  );
end;
$function$;

create or replace function public.delete_ming_business_space_post_comment(p_comment_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_voice_paths text[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_comments c
    join public.ming_space_content p on p.id=c.target_id and p.kind='business_post'
    join public.ming_spaces s on s.id=c.space_id and s.nature='business'
    join public.ming_space_members m on m.space_id=c.space_id and m.user_id=v_user and m.approved=true
    where c.id=p_comment_id and c.target_type='space_content' and c.author_id=v_user
  ) then raise exception 'You can only delete your own comment'; end if;

  with recursive comment_tree(id) as (
    select p_comment_id
    union all
    select child.id from public.ming_comments child join comment_tree parent on child.parent_comment_id=parent.id
  )
  select coalesce(array_agg(distinct c.voice_path) filter(where c.voice_path is not null), '{}')
    into v_voice_paths
  from public.ming_comments c join comment_tree t on t.id=c.id;

  delete from public.ming_comments where id=p_comment_id and author_id=v_user;
  return jsonb_build_object('voice_paths',to_jsonb(coalesce(v_voice_paths,'{}'::text[])));
end;
$function$;

revoke all on function public.add_ming_business_space_post_comment_reply(uuid,text) from public,anon;
revoke all on function public.delete_ming_business_space_post_comment(uuid) from public,anon;
grant execute on function public.add_ming_business_space_post_comment_reply(uuid,text) to authenticated;
grant execute on function public.delete_ming_business_space_post_comment(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
