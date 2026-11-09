drop policy if exists "Users can create own visible Daily Update comments" on public.daily_update_comments;
create policy "Users can create own visible Daily Update comments"
on public.daily_update_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.daily_updates u
    where u.id = daily_update_comments.update_id
      and u.created_at > now() - interval '24 hours'
  )
);

create or replace function private.validate_daily_update_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.parent_comment_id is not null and not exists (
    select 1
    from public.daily_update_comments parent
    where parent.id = new.parent_comment_id
      and parent.update_id = new.update_id
      and parent.parent_comment_id is null
      and parent.is_private = new.is_private
  ) then
    raise exception 'Replies must belong to the same update and match the parent comment privacy';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_daily_update_comment_parent on public.daily_update_comments;
create trigger validate_daily_update_comment_parent
before insert or update of parent_comment_id, update_id, is_private
on public.daily_update_comments
for each row execute function private.validate_daily_update_comment_parent();
