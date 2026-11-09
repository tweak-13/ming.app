# Supabase migration state

Connected Supabase project: `avnuejgqaxygxeiyqeny`

## Migrations applied in this hardening pass

These files use the exact version identifiers recorded in the connected project's migration ledger:

- `20261109022517_view_once_claim_trigger_fix.sql`
- `20261109023319_space_content_and_business_feature_guards.sql`
- `20261109023346_marketplace_and_space_file_security.sql`
- `20261109023959_require_storage_removal_before_file_record_delete.sql`

They have already been applied to the connected project and their effects were smoke-tested.

## Important: historical migration drift

The existing migrations directory predates this pass and is not yet a fully reproducible clean-install history. At audit time it contained 38 SQL files while the connected project reported 36 applied migration records. Several historical filenames have version/name differences from the database ledger, and some applied ledger entries do not have a matching source file in this directory.

I have not renamed or replayed those historical scripts: the database ledger records migration names and versions, but does not retain every original SQL body, so guessing a mapping could cause destructive duplicate DDL or silently omit prior changes.

**Do not run every historical SQL file manually or point a fresh project at this folder as though it were a verified clean-install chain.** The connected project is the authoritative current environment. Before creating another environment or using `supabase db push` for a clean deployment, reconcile the complete migration history against a schema dump and create a verified baseline.

## Operational rule

For the connected project, apply future schema changes through a reviewed migration, record the exact version in this folder, and verify the resulting schema, grants, RLS policies, and advisor output. Do not apply the same SQL a second time merely because an old filename appears in the repository.
