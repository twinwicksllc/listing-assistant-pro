-- Migration: Cursor RPC for the rewritten competitor-prices-cron
--
-- Replaces the per-user loop that crashed production with WORKER_RESOURCE_LIMIT
-- (see 20260818000000's header for the full incident). Returns a small, capped
-- batch of (user, listing) pairs due for a competitor-price refresh, drawn from
-- user_active_listings LEFT JOIN competitor_prices, ordered fairly across users.
--
-- RPC rather than a view: the staleness cutoff must be a runtime parameter
-- derived from CACHE_TTL_MS in supabase/functions/_helpers/competitorSearch.ts
-- (the single source of truth for that TTL -- that file's own history already
-- de-duplicated this constant once). A view can't take a runtime parameter
-- without hard-coding a second, driftable copy of the TTL in SQL.
--
-- Fairness ranking is the critical piece: a plain
-- `ORDER BY fetched_at ASC NULLS FIRST LIMIT N` is NOT fair across users --
-- one heavy user's hundreds of never-fetched rows would monopolize every
-- tick's slots, which is exactly the starvation this migration exists to fix.
-- Ranking each listing within its own user first (ROW_NUMBER() PARTITION BY
-- user_id), then ordering globally by that per-user rank, guarantees every
-- user's single stalest listing is pulled before any user's second-stalest.
--
-- service_role-only grant for the same reason as get_users_for_inventory_sync
-- (20260818010000) -- this is SECURITY DEFINER and bypasses RLS.

CREATE OR REPLACE FUNCTION public.get_next_competitor_price_batch(
  p_limit INTEGER,
  p_stale_before TIMESTAMPTZ
)
RETURNS TABLE (
  user_id UUID,
  ebay_listing_id TEXT,
  title TEXT,
  price NUMERIC,
  category_id TEXT,
  last_fetched_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      ual.user_id,
      ual.ebay_listing_id,
      ual.title,
      ual.price,
      ual.category_id,
      cp.fetched_at AS last_fetched_at,
      ROW_NUMBER() OVER (
        PARTITION BY ual.user_id
        ORDER BY cp.fetched_at ASC NULLS FIRST
      ) AS per_user_rank
    FROM public.user_active_listings ual
    LEFT JOIN public.competitor_prices cp
      ON cp.user_id = ual.user_id AND cp.ebay_listing_id = ual.ebay_listing_id
    WHERE cp.fetched_at IS NULL OR cp.fetched_at < p_stale_before
  )
  SELECT user_id, ebay_listing_id, title, price, category_id, last_fetched_at
  FROM candidates
  ORDER BY per_user_rank ASC, last_fetched_at ASC NULLS FIRST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_competitor_price_batch(INTEGER, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_next_competitor_price_batch IS
  'Returns up to p_limit (user, listing) pairs due for a competitor-price refresh, fairness-ranked per user so no single high-volume user monopolizes a tick. Used by competitor-prices-cron.';
