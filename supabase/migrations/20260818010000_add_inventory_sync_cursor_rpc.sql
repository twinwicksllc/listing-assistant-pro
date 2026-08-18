-- Migration: Cursor RPC for inventory-sync-cron
--
-- Selects which connected users' active-listing inventory (user_active_listings,
-- see 20260818000000) is oldest/never synced, so inventory-sync-cron can process
-- a small, capped batch per invocation instead of looping every user in one call
-- to the heavy ebay-listings function (see that migration's header for the full
-- WORKER_RESOURCE_LIMIT incident context).
--
-- "Oldest-synced-user-first" is derived via MIN(last_seen_at) over
-- user_active_listings rather than a new profiles tracking column, so it's
-- always exactly consistent with actual table state -- a separately-updated
-- tracking column could drift if a sync pass upserts rows but crashes before
-- updating it (or vice versa).
--
-- Per 20260817010000_grant_execute_org_functions.sql's confirmed finding,
-- every SECURITY DEFINER function in public gets EXECUTE on service_role only
-- by Supabase's own project-level default, not authenticated/anon -- this
-- function bypasses RLS, so it must stay service_role-only (no grant to
-- authenticated/anon is added here).

CREATE OR REPLACE FUNCTION public.get_users_for_inventory_sync(
  p_limit INTEGER,
  p_stale_before TIMESTAMPTZ
)
RETURNS TABLE (user_id UUID, oldest_last_seen_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, MIN(ual.last_seen_at)
  FROM public.profiles p
  LEFT JOIN public.user_active_listings ual ON ual.user_id = p.id
  WHERE p.ebay_refresh_token IS NOT NULL
  GROUP BY p.id
  HAVING MIN(ual.last_seen_at) IS NULL OR MIN(ual.last_seen_at) < p_stale_before
  ORDER BY MIN(ual.last_seen_at) ASC NULLS FIRST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_for_inventory_sync(INTEGER, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_users_for_inventory_sync IS
  'Returns up to p_limit connected users whose user_active_listings cache is oldest or never populated, for inventory-sync-cron''s capped per-invocation batch.';
