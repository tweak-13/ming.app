-- Tweaklr Business Space comment voice upload policy fix
-- The frontend uploads voice files using a UUID filename at the bucket root.
-- Storage assigns owner_id during upload; requiring owner_id in the INSERT
-- WITH CHECK can reject the new row before that ownership metadata is available.
-- Keep uploads authenticated and bucket-scoped. Read access remains governed
-- by the separate comment visibility policy.

begin;

drop policy if exists "Business comment voice upload own" on storage.objects;

create policy "Business comment voice upload own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ming-business-comment-voice'
  and (select auth.uid()) is not null
);

notify pgrst, 'reload schema';

commit;
