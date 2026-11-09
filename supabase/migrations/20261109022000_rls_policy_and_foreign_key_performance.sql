begin;

-- Remove a redundant ALL policy; the four owner-only policies already cover
-- the exact same operations and predicates.
drop policy if exists "Ming push subscriptions owner" on public.ming_push_subscriptions;

-- Resolve the remaining auth.uid() init-plan warnings without changing policy
-- semantics.
alter policy "Users can create their own profile" on public.profiles
  with check (id = (select auth.uid()));
alter policy "Users can update their own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
alter policy "Users can view discoverable profiles" on public.profiles
  using (is_discoverable = true or id = (select auth.uid()));
alter policy "Users can manage their own device locations" on public.profile_device_locations
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Ming chat realtime read" on realtime.messages
using (
  extension = any (array['broadcast'::text,'presence'::text])
  and split_part(realtime.topic(),':',1)='ming'
  and split_part(realtime.topic(),':',2)='chat'
  and exists (
    select 1 from public.connections c
    where c.status='accepted'
      and (
        (c.requester_id=(select auth.uid()) and c.recipient_id=(split_part(realtime.topic(),':',4))::uuid)
        or (c.recipient_id=(select auth.uid()) and c.requester_id=(split_part(realtime.topic(),':',4))::uuid)
      )
      and (split_part(realtime.topic(),':',3))::uuid=least(c.requester_id,c.recipient_id)
      and (split_part(realtime.topic(),':',4))::uuid=greatest(c.requester_id,c.recipient_id)
  )
);

alter policy "Ming chat realtime write" on realtime.messages
with check (
  extension = any (array['broadcast'::text,'presence'::text])
  and split_part(realtime.topic(),':',1)='ming'
  and split_part(realtime.topic(),':',2)='chat'
  and exists (
    select 1 from public.connections c
    where c.status='accepted'
      and (
        (c.requester_id=(select auth.uid()) and c.recipient_id=(split_part(realtime.topic(),':',4))::uuid)
        or (c.recipient_id=(select auth.uid()) and c.requester_id=(split_part(realtime.topic(),':',4))::uuid)
      )
      and (split_part(realtime.topic(),':',3))::uuid=least(c.requester_id,c.recipient_id)
      and (split_part(realtime.topic(),':',4))::uuid=greatest(c.requester_id,c.recipient_id)
  )
);

-- Cover the foreign-key columns identified by the Supabase performance audit.
create index if not exists idx_daily_update_comments_author on public.daily_update_comments(author_id);
create index if not exists idx_daily_update_likes_user on public.daily_update_likes(user_id);
create index if not exists idx_discover_places_created_by on public.discover_places(created_by);
create index if not exists idx_message_reactions_user on public.message_reactions(user_id);
create index if not exists idx_ming_anon_comments_author on public.ming_anonymous_comments(author_id);
create index if not exists idx_ming_anon_posts_author on public.ming_anonymous_posts(author_id);
create index if not exists idx_ming_call_invites_caller on public.ming_call_invites(caller_id);
create index if not exists idx_ming_comments_parent on public.ming_comments(parent_comment_id);
create index if not exists idx_ming_friendly_activity_comments_author on public.ming_friendly_activity_comments(author_id);
create index if not exists idx_ming_friendly_communities_creator on public.ming_friendly_communities(creator_id);
create index if not exists idx_ming_friendly_community_comments_author on public.ming_friendly_community_comments(author_id);
create index if not exists idx_ming_friendly_community_comments_parent on public.ming_friendly_community_comments(parent_comment_id);
create index if not exists idx_ming_friendly_community_posts_author on public.ming_friendly_community_posts(author_id);
create index if not exists idx_ming_space_dna_user on public.ming_space_dna_state(user_id);
create index if not exists idx_ming_space_files_content on public.ming_space_files(content_id);
create index if not exists idx_ming_space_files_owner on public.ming_space_files(owner_id);
create index if not exists idx_ming_space_files_product on public.ming_space_files(product_id);
create index if not exists idx_ming_space_product_bids_bidder on public.ming_space_product_bids(bidder_id);
create index if not exists idx_tweak_tiktok_oauth_states_user on public.tweak_tiktok_oauth_states(tweaklr_user_id);

commit;