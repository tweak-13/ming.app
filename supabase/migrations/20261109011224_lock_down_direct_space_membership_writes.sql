drop policy if exists "own membership access" on public.ming_space_members;
create policy "read own membership"
on public.ming_space_members
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.ming_space_members from public, anon, authenticated;
grant select on table public.ming_space_members to authenticated;
