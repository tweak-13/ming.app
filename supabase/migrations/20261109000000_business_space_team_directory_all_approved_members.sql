-- Business Space team directory visibility
-- Approved members can see the approved member directory for Business Spaces
-- they belong to. Owners/admins retain visibility of pending membership rows.
-- Invite secrets remain restricted to owners/admins by the RPC CASE expressions.

CREATE OR REPLACE FUNCTION public.get_my_ming_spaces_v2()
RETURNS TABLE(
  space_id uuid,
  owner_id uuid,
  name text,
  description text,
  nature text,
  privacy text,
  discoverable boolean,
  require_approval boolean,
  max_members integer,
  hue integer,
  location_linked boolean,
  expires_at timestamp with time zone,
  features jsonb,
  created_at timestamp with time zone,
  member_id uuid,
  member_role text,
  member_joined_at timestamp with time zone,
  member_approved boolean,
  invite_id uuid,
  invite_code_hash text,
  invite_hint text,
  invite_created_at timestamp with time zone,
  invite_expires_at timestamp with time zone,
  invite_max_uses integer,
  invite_uses integer,
  invite_revoked boolean,
  invite_version integer,
  member_display_name text,
  member_username text,
  member_avatar_url text,
  member_headline text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    s.id, s.owner_id, s.name, s.description, s.nature, s.privacy,
    s.discoverable, s.require_approval, s.max_members, s.hue,
    s.location_linked, s.expires_at, s.features, s.created_at,
    m.user_id, m.role, m.joined_at, m.approved,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.id ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.code_hash ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.hint ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.created_at ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.expires_at ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.max_uses ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.uses ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.revoked ELSE NULL END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND actor.role IN ('owner','admin')
    ) THEN i.version ELSE NULL END,
    p.display_name, p.username, p.avatar_url, p.headline
  FROM public.ming_spaces s
  JOIN public.ming_space_members m ON m.space_id = s.id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN LATERAL (
    SELECT si.* FROM public.ming_space_invites si
    WHERE si.space_id = s.id AND si.revoked = false
    ORDER BY si.version DESC
    LIMIT 1
  ) i ON true
  WHERE
    m.user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ming_space_members actor
      WHERE actor.space_id = s.id
        AND actor.user_id = (SELECT auth.uid())
        AND actor.approved = true
        AND (
          actor.role IN ('owner','admin')
          OR (s.nature = 'business' AND m.approved = true)
        )
    )
  ORDER BY s.created_at DESC, m.joined_at ASC;
$function$;
