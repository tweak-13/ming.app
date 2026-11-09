begin;
drop policy if exists "Users can create their own update comments" on public.daily_update_comments;
create policy "Users can create their own update comments"
on public.daily_update_comments
for insert to authenticated
with check (
  (select auth.uid()) = author_id
  and exists (
    select 1 from public.daily_updates u
    where u.id = update_id
      and u.created_at > now() - interval '24 hours'
  )
);
commit;