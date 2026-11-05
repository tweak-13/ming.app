-- Standalone Business Space post comments migration.
-- Run this file in the Supabase SQL Editor.

create or replace function public.add_ming_business_space_post_comment(
  p_content_id uuid,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_kind text;
  v_comments jsonb;
  v_comment jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if p_text is null or char_length(btrim(p_text)) not between 1 and 1000 then
    raise exception 'Comment must be between 1 and 1000 characters';
  end if;

  select c.space_id, c.kind, coalesce(c.payload->'comments', '[]'::jsonb)
    into v_space_id, v_kind, v_comments
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

  if jsonb_typeof(v_comments) <> 'array' then
    v_comments := '[]'::jsonb;
  end if;

  if jsonb_array_length(v_comments) >= 100 then
    raise exception 'This discussion has reached its limit';
  end if;

  v_comment := jsonb_build_object(
    'id', gen_random_uuid(),
    'authorId', v_user,
    'text', btrim(p_text),
    'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  update public.ming_space_content
  set payload = jsonb_set(
        coalesce(payload, '{}'::jsonb),
        '{comments}',
        v_comments || jsonb_build_array(v_comment),
        true
      ),
      updated_at = now()
  where id = p_content_id;

  return v_comment;
end;
$function$;

revoke all on function public.add_ming_business_space_post_comment(uuid, text) from public, anon;
grant execute on function public.add_ming_business_space_post_comment(uuid, text) to authenticated;
