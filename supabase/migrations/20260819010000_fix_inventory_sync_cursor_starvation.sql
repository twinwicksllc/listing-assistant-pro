-- Migration: fix get_users_for_inventory_sync starvation bug
--
-- Companion to 20260819000000_add_profiles_last_ebay_sync_at.sql -- see that
-- migration's header for the full incident. Replaces the MIN(last_seen_at)
-- aggregate over user_active_listings (which a zero-listing user could never
-- satisfy, since no row is ever written for them) with the new
-- profiles.last_ebay_sync_at column, set unconditionally after every sync
-- attempt regardless of outcome.
--
-- The OUT parameter is renamed (oldest_last_seen_at -> last_ebay_sync_at) to
-- match the new source column, so this must DROP first: Postgres rejects
-- CREATE OR REPLACE FUNCTION when it would change the row type defined by
-- OUT parameters (SQLSTATE 42P13). Safe to drop and recreate -- the only
-- caller (inventory-sync-cron/index.ts) reads candidates by user_id only,
-- never by this column's name.
DROP FUNCTION IF EXISTS public.get_users_for_inventory_sync(INTEGER, TIMESTAMPTZ);

CREATE FUNCTION public.get_users_for_inventory_sync(
  p_limit INTEGER,
  p_stale_before TIMESTAMPTZ
)
RETURNS TABLE (user_id UUID, last_ebay_sync_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.last_ebay_sync_at
  FROM public.profiles p
  WHERE p.ebay_refresh_token IS NOT NULL
    AND (p.last_ebay_sync_at IS NULL OR p.last_ebay_sync_at < p_stale_before)
  ORDER BY p.last_ebay_sync_at ASC NULLS FIRST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_for_inventory_sync(INTEGER, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_users_for_inventory_sync IS
  'Returns up to p_limit connected users whose last inventory-sync-cron attempt (profiles.last_ebay_sync_at) is oldest or never happened. Unlike the original version, this is unaffected by how many listings a user actually has -- a zero-listing account only occupies a slot once per staleness window, not every tick.';
