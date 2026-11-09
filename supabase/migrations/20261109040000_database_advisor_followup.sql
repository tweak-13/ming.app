begin;

-- Internal authorization helper: callers must use the guarded comment RPCs.
revoke all on function public.can_access_daily_update_activity(uuid,uuid)
  from public, anon, authenticated;

-- Explicit deny policies document and preserve backend-only access for tables
-- that are accessed solely through validated SECURITY DEFINER RPCs or service
-- role Edge Functions.
do $block$
declare
  v_table text;
  v_tables text[] := array[
    'daily_update_activity_comments',
    'ming_comments',
    'ming_friendly_activity_comments',
    'ming_friendly_communities',
    'ming_friendly_community_comments',
    'ming_friendly_community_members',
    'ming_friendly_community_posts',
    'ming_space_activity',
    'ming_space_dna_state',
    'ming_space_open_roles',
    'ming_space_role_applications',
    'tweak_tiktok_connections',
    'tweak_tiktok_oauth_states',
    'tweak_tiktok_videos',
    'tweaklr_status_mutes',
    'tweaklr_status_reactions',
    'tweaklr_status_settings',
    'tweaklr_status_views',
    'tweaklr_statuses'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop policy if exists "No direct client access" on public.%I',v_table);
    execute format(
      'create policy "No direct client access" on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table
    );
    execute format('revoke all on table public.%I from anon, authenticated',v_table);
  end loop;
end
$block$;

-- The block-list pair is the natural row identity.
alter table public.user_blocks drop constraint if exists user_blocks_unique;
alter table public.user_blocks add constraint user_blocks_pkey primary key (blocker_id,blocked_id);

-- Supabase advisor foreign-key coverage.
create index if not exists idx_daily_update_activity_comments_user
  on public.daily_update_activity_comments(user_id);
create index if not exists idx_ming_space_open_roles_created_by
  on public.ming_space_open_roles(created_by);
create index if not exists idx_tweaklr_status_mutes_author
  on public.tweaklr_status_mutes(author_id);
create index if not exists idx_tweaklr_status_reactions_user
  on public.tweaklr_status_reactions(user_id);
create index if not exists idx_tweaklr_status_views_viewer
  on public.tweaklr_status_views(viewer_id);
create index if not exists idx_tweaklr_statuses_space
  on public.tweaklr_statuses(space_id);

-- Media authorization lookups are JSONB containment checks.
create index if not exists idx_ming_space_content_payload_gin
  on public.ming_space_content using gin(payload jsonb_path_ops);
create index if not exists idx_tweaklr_statuses_media_path
  on public.tweaklr_statuses(media_path);

-- Finish the RLS init-plan optimization for notification read-state cleanup.
alter policy "Users can delete their expired notification read state"
on public.user_notification_reads
using (user_id = (select auth.uid()));

commit;