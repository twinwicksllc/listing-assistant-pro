-- Migration: Competitor pricing intelligence cache
-- Stores per-listing competitor price snapshots fetched daily from eBay search.
-- Each row represents a search result snapshot for one of the user's active listings.

CREATE TABLE IF NOT EXISTS competitor_prices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The user's eBay listing ID this data applies to
  ebay_listing_id TEXT        NOT NULL,
  -- The search query used to find competitors (derived from listing title)
  search_query    TEXT        NOT NULL,
  -- Aggregate pricing stats across all found competitor listings
  avg_price       NUMERIC(10,2),
  min_price       NUMERIC(10,2),
  max_price       NUMERIC(10,2),
  median_price    NUMERIC(10,2),
  -- Signed difference: (your_price - avg_price). Negative = you are cheaper.
  price_delta     NUMERIC(10,2),
  -- The user's price at time of snapshot (to compute delta)
  your_price      NUMERIC(10,2),
  -- Number of competitor listings found in the search
  competitor_count INTEGER     DEFAULT 0,
  -- JSON array of price buckets for distribution chart
  -- e.g. [{"min":0,"max":50,"count":2},{"min":50,"max":100,"count":5}]
  price_distribution JSONB,
  -- Snapshot timestamps
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '25 hours')
);

-- Index for fast per-user, per-listing lookups on the dashboard
CREATE INDEX IF NOT EXISTS idx_competitor_prices_user_listing
  ON competitor_prices (user_id, ebay_listing_id, fetched_at DESC);

-- Index for cron cleanup of expired rows
CREATE INDEX IF NOT EXISTS idx_competitor_prices_expires
  ON competitor_prices (expires_at);

-- Row-level security: users can only read their own competitor data
ALTER TABLE competitor_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own competitor prices"
  ON competitor_prices FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (cron / edge functions) can insert and delete freely
CREATE POLICY "Service role can manage competitor prices"
  ON competitor_prices FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE competitor_prices IS
  'Daily competitor price snapshots per active eBay listing. Refreshed by competitor-prices-cron.';
COMMENT ON COLUMN competitor_prices.price_delta IS
  'Signed delta: your_price - avg_price. Negative = you are priced below market average.';
COMMENT ON COLUMN competitor_prices.price_distribution IS
  'JSON array of price-range buckets: [{min, max, count}] for rendering a price distribution chart.';
COMMENT ON COLUMN competitor_prices.expires_at IS
  'Row expires 25 hours after creation. Cron deletes expired rows before each run.';
