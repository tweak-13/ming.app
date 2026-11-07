-- Allow a Friendly post's publisher to permanently delete their own post.
-- Apply this migration in the Tweaklr Supabase SQL Editor.
begin;

create or replace function public.delete_ming_friendly_space_post(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_payload jsonb;
  v_space_id uuid;
  v_media_paths text[];
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select c.payload, c.space_id
    into v_payload, v_space_id
  from public.ming_space_content c
  join public.ming_spaces s on s.id = c.space_id and s.nature = 'friendly'
  where c.id = p_content_id
    and c.kind = 'friend_post'
    and c.author_id = v_user
  for update of c;

  if not found then
    raise exception 'Post not found or you are not its publisher';
  end if;

  select coalesce(array_agg(x.path), '{}'::text[])
    into v_media_paths
  from jsonb_to_recordset(
    case when jsonb_typeof(v_payload->'media') = 'array'
      then v_payload->'media' else '[]'::jsonb end
  ) as x(path text)
  where x.path is not null and btrim(x.path) <> '';

  delete from public.ming_space_content
  where id = p_content_id and author_id = v_user and kind = 'friend_post';

  return jsonb_build_object('deleted', true, 'media_paths', to_jsonb(v_media_paths));
end;
$function$;

revoke all on function public.delete_ming_friendly_space_post(uuid) from public, anon;
grant execute on function public.delete_ming_friendly_space_post(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
