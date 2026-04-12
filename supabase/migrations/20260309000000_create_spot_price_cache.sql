-- Shared spot price cache table
-- Stores a single row of metal spot prices, refreshed every 15 minutes
-- All users and edge functions read from this shared cache

CREATE TABLE IF NOT EXISTS public.spot_price_cache (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforces single row
  gold        numeric(10, 4) NOT NULL,
  silver      numeric(10, 4) NOT NULL,
  platinum    numeric(10, 4) NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'metals.live'
);

-- Seed with reasonable fallback values so the row always exists
INSERT INTO public.spot_price_cache (id, gold, silver, platinum, fetched_at, source)
VALUES (1, 2650, 31, 1000, '2000-01-01T00:00:00Z', 'fallback')
ON CONFLICT (id) DO NOTHING;

-- Allow edge functions (service role) to read and upsert
ALTER TABLE public.spot_price_cache ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — no policy needed for edge functions
-- Allow authenticated users to read spot prices (for PricingCard)
CREATE POLICY "Anyone can read spot price cache"
  ON public.spot_price_cache
  FOR SELECT
  USING (true);