-- Migration: Local cache of each user's currently-active eBay listings
--
-- competitor-prices-cron crashed in production 2026-08-18 with
-- WORKER_RESOURCE_LIMIT (546): one user alone had 539+ stale listings, and
-- enumerating + refreshing all of them in one Edge Function invocation
-- exceeded Supabase's fixed, non-configurable per-invocation ceiling (2.0s
-- cumulative CPU-time + 256MB memory -- this budget does not reset across
-- loop iterations within a single invocation, so total work done matters,
-- not how it's parallelized).
--
-- Root design problem: there was no local cache of "what listings does this
-- user have" -- learning that requires a live call to the very heavy
-- ebay-listings function (paginated Inventory API, per-offer detail fetches,
-- Trading API fallback merge, Analytics, Fulfillment, Finances, per-listing
-- watch-count calls). Calling that every few minutes per user to decide what
-- needs a competitor-price refresh would reintroduce the same resource
-- problem earlier in the pipeline.
--
-- This table decouples "learning what a user has" (slow/expensive,
-- populated by the new inventory-sync-cron on a slow cadence) from "does
-- this listing need a competitor-price refresh" (fast/cheap, read by the
-- rewritten competitor-prices-cron's cursor via get_next_competitor_price_batch,
-- see 20260818020000). Mirrors competitor_prices' RLS policy shape
-- (20260316000000_create_competitor_prices.sql).

CREATE TABLE IF NOT EXISTS user_active_listings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_listing_id TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  price           NUMERIC(10,2),
  category_id     TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_active_listings_user_listing UNIQUE (user_id, ebay_listing_id)
);

-- Supports both get_next_competitor_price_batch's per-user LEFT JOIN cursor
-- and get_users_for_inventory_sync's MIN(last_seen_at) aggregate.
CREATE INDEX IF NOT EXISTS idx_user_active_listings_user_last_seen
  ON user_active_listings (user_id, last_seen_at);

ALTER TABLE user_active_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own active listings"
  ON user_active_listings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage active listings"
  ON user_active_listings FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE user_active_listings IS
  'Cache of each user''s currently-active eBay listings, populated by inventory-sync-cron on a slow cadence. Decouples listing enumeration from the fast competitor-price refresh cursor.';
COMMENT ON COLUMN user_active_listings.last_seen_at IS
  'Updated to the sync pass timestamp every time inventory-sync-cron sees this listing still active. Rows not touched by a pass for a given user are pruned as ended/sold.';
COMMENT ON COLUMN user_active_listings.first_seen_at IS
  'Set once on first insert; left untouched on subsequent upserts (sync writes omit this column so the DEFAULT only applies to the initial row).';
