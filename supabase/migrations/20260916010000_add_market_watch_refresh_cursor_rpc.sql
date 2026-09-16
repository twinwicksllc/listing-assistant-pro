-- Migration: Cursor RPC for market-watch-refresh's daily batch mode
--
-- Problem 3, Phase 3.4 of the pricing-reliability plan: market_watches has
-- had the right time-series schema since 20260323000000, and
-- market-watch-refresh already knows how to populate one snapshot correctly
-- -- but nothing has ever called it automatically. Confirmed by grepping
-- every cron.schedule() call across all migrations: no job targets
-- market-watch-refresh. A user-created watch only updates if the user
-- remembers to click "Refresh"; left alone, last_checked_at just goes stale
-- forever.
--
-- This is the SMALL version of Phase 3.4 (daily refresh of watches users
-- already created), not the "moat dataset" version (proactively seeding
-- watches for popular terms across the whole seller base) -- that stays
-- explicitly out of scope: it multiplies the Jina-scraping ToS exposure this
-- function already carries (Phase 3.3, unresolved) and breaks the
-- per-user-owned-watch RLS model this table was built around.
--
-- Same shape as get_users_for_inventory_sync (20260818010000): oldest/never-
-- refreshed first, capped batch, SECURITY DEFINER + service_role-only grant
-- per 20260817010000's confirmed project-level default.

CREATE OR REPLACE FUNCTION public.get_watches_due_for_refresh(
  p_limit INTEGER,
  p_stale_before TIMESTAMPTZ
)
RETURNS TABLE (watch_id UUID, last_checked_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, market_watches.last_checked_at
  FROM public.market_watches
  WHERE last_checked_at IS NULL OR last_checked_at < p_stale_before
  ORDER BY last_checked_at ASC NULLS FIRST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_watches_due_for_refresh(INTEGER, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_watches_due_for_refresh IS
  'Returns up to p_limit market_watches rows whose last_checked_at is oldest or never set, for market-watch-refresh''s capped daily batch mode (Phase 3.4).';
