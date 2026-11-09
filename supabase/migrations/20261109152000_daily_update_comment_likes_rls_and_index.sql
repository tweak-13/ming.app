begin;
drop index if exists public.daily_update_comments_update_created_idx;
create index if not exists daily_update_comment_likes_user_id_idx
  on public.daily_update_comment_likes(user_id);
drop policy if exists "Users manage their own Daily Update comment likes" on public.daily_update_comment_likes;
create policy "Users manage their own Daily Update comment likes"
on public.daily_update_comment_likes
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
commit;