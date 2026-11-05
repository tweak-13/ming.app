-- Reliable per-member likes for Business Space updates.
-- Run this migration in the Supabase SQL Editor after deploying the app.

create or replace function public.toggle_ming_business_space_post_like(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_kind text;
  v_payload jsonb;
  v_liked_by jsonb;
  v_liked boolean;
  v_count integer;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select c.space_id, c.kind, coalesce(c.payload, '{}'::jsonb)
    into v_space_id, v_kind, v_payload
  from public.ming_space_content c
  where c.id = p_content_id
  for update;

  if not found or v_kind <> 'business_post' then
    raise exception 'Business post not found';
  end if;

  if not exists (
    select 1
    from public.ming_spaces s
    join public.ming_space_members m on m.space_id = s.id
    where s.id = v_space_id
      and s.nature = 'business'
      and m.user_id = v_user
      and m.approved = true
  ) then
    raise exception 'Approved Business Space membership required';
  end if;

  v_liked_by := v_payload->'likedBy';
  if v_liked_by is null or jsonb_typeof(v_liked_by) <> 'array' then
    v_liked_by := '[]'::jsonb;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(v_liked_by) as liked(user_id)
    where liked.user_id = v_user::text
  ) then
    select coalesce(jsonb_agg(to_jsonb(liked.user_id)), '[]'::jsonb)
      into v_liked_by
    from jsonb_array_elements_text(v_liked_by) as liked(user_id)
    where liked.user_id <> v_user::text;
    v_liked := false;
  else
    v_liked_by := v_liked_by || jsonb_build_array(v_user::text);
    v_liked := true;
  end if;

  v_count := jsonb_array_length(v_liked_by);

  update public.ming_space_content
  set payload = jsonb_set(
    jsonb_set(coalesce(payload, '{}'::jsonb), '{likedBy}', v_liked_by, true),
    '{likeCount}', to_jsonb(v_count), true
  ),
  updated_at = now()
  where id = p_content_id;

  return jsonb_build_object(
    'liked', v_liked,
    'like_count', v_count,
    'liked_by', v_liked_by
  );
end;
$function$;

revoke all on function public.toggle_ming_business_space_post_like(uuid) from public, anon;
grant execute on function public.toggle_ming_business_space_post_like(uuid) to authenticated;
