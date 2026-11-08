-- Tweaklr: allow authors to delete their own Friendship Space replies.
-- Also remove any nested descendants and return their voice files for cleanup.
begin;

create or replace function public.delete_ming_friendship_space_post_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_author uuid;
  v_post_author uuid;
  v_voice_paths text[];
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select c.author_id, p.author_id
    into v_author, v_post_author
  from public.ming_comments c
  join public.ming_space_content p
    on p.id = c.target_id
   and p.kind = 'friend_post'
  join public.ming_spaces s
    on s.id = c.space_id
   and s.nature = 'friendly'
  join public.ming_space_members m
    on m.space_id = c.space_id
   and m.user_id = v_user
   and m.approved = true
  where c.id = p_comment_id
    and c.target_type = 'space_content';

  if not found then
    raise exception 'Comment or reply not found or unavailable';
  end if;

  if v_user <> v_author and v_user <> v_post_author then
    raise exception 'Only the comment author or post author can delete this comment';
  end if;

  with recursive comment_tree(id) as (
    select p_comment_id
    union all
    select child.id
    from public.ming_comments child
    join comment_tree parent on child.parent_comment_id = parent.id
  )
  select coalesce(
    array_agg(distinct c.voice_path) filter (where c.voice_path is not null),
    '{}'::text[]
  )
  into v_voice_paths
  from public.ming_comments c
  join comment_tree t on t.id = c.id;

  with recursive comment_tree(id) as (
    select p_comment_id
    union all
    select child.id
    from public.ming_comments child
    join comment_tree parent on child.parent_comment_id = parent.id
  )
  delete from public.ming_comments c
  using comment_tree t
  where c.id = t.id;

  return jsonb_build_object(
    'voice_paths',
    to_jsonb(coalesce(v_voice_paths, '{}'::text[]))
  );
end;
$function$;

revoke all on function public.delete_ming_friendship_space_post_comment(uuid) from public, anon;
grant execute on function public.delete_ming_friendship_space_post_comment(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
