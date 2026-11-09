begin;

create policy "Anonymous posts are RPC only"
on public.ming_anonymous_posts
for all to anon, authenticated
using (false) with check (false);

create policy "Anonymous comments are RPC only"
on public.ming_anonymous_comments
for all to anon, authenticated
using (false) with check (false);

create or replace function public.create_ming_anonymous_post(p_space_id uuid,p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_post public.ming_anonymous_posts;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then
    raise exception 'Anonymous posts must contain 1–2000 characters.';
  end if;
  if not exists(
    select 1
    from public.ming_spaces s
    join public.ming_space_members m on m.space_id=s.id
    where s.id=p_space_id and s.nature='anonymous'
      and coalesce((s.features->>'anonymousPosts')::boolean,true)
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Posting is disabled or approved Anonymous Space membership is required'; end if;

  insert into public.ming_anonymous_posts(space_id,author_id,body)
  values(p_space_id,v_user,btrim(p_body))
  returning * into v_post;

  return jsonb_build_object('id',v_post.id,'body',v_post.body,'created_at',v_post.created_at,'is_mine',true);
end;
$function$;

create or replace function public.add_ming_anonymous_comment(p_post_id uuid,p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_comment public.ming_anonymous_comments;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 1000 then
    raise exception 'Anonymous comments must contain 1–1000 characters.';
  end if;
  if not exists(
    select 1
    from public.ming_anonymous_posts p
    join public.ming_spaces s on s.id=p.space_id and s.nature='anonymous'
    join public.ming_space_members m on m.space_id=s.id
    where p.id=p_post_id
      and coalesce((s.features->>'anonymousComments')::boolean,true)
      and m.user_id=v_user and m.approved=true
  ) then raise exception 'Replies are disabled or approved Anonymous Space membership is required'; end if;

  insert into public.ming_anonymous_comments(post_id,author_id,body)
  values(p_post_id,v_user,btrim(p_body))
  returning * into v_comment;

  return jsonb_build_object('id',v_comment.id,'body',v_comment.body,'created_at',v_comment.created_at,'is_mine',true);
end;
$function$;

revoke all on function public.create_ming_anonymous_post(uuid,text) from public,anon;
revoke all on function public.add_ming_anonymous_comment(uuid,text) from public,anon;
grant execute on function public.create_ming_anonymous_post(uuid,text) to authenticated;
grant execute on function public.add_ming_anonymous_comment(uuid,text) to authenticated;

commit;