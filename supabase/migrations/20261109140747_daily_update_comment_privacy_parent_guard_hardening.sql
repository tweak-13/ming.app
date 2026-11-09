drop trigger if exists validate_daily_update_comment_parent on public.daily_update_comments;
drop function if exists private.validate_daily_update_comment_parent();

create or replace function public.validate_daily_update_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent_update uuid;
  v_parent_parent uuid;
  v_parent_private boolean;
begin
  if new.parent_comment_id is null then return new; end if;
  select c.update_id, c.parent_comment_id, c.is_private
    into v_parent_update, v_parent_parent, v_parent_private
  from public.daily_update_comments c
  where c.id = new.parent_comment_id;
  if not found or v_parent_update <> new.update_id then
    raise exception 'Reply target does not belong to this update';
  end if;
  if v_parent_parent is not null then raise exception 'Replies can only be one level deep'; end if;
  if new.parent_comment_id = new.id then raise exception 'A comment cannot reply to itself'; end if;
  if new.is_private is distinct from v_parent_private then
    raise exception 'A reply must use the same privacy setting as its parent comment';
  end if;
  return new;
end;
$function$;
