drop policy if exists "Users can read visible Daily Update comments" on public.daily_update_comments;
create policy "Users can read visible Daily Update comments"
on public.daily_update_comments for select to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.daily_updates u
    where u.id = daily_update_comments.update_id
      and u.author_id = (select auth.uid())
  )
  or (
    is_private = false
    and is_anonymous = false
    and exists (
      select 1 from public.daily_updates u
      where u.id = daily_update_comments.update_id
        and u.created_at > now() - interval '24 hours'
    )
  )
);
