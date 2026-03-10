-- Update spot_price_cache with current realistic fallback values
-- (metals.live was the old source and is now unreachable)
-- New source: metals.dev (METALS_DEV_API_KEY Supabase secret)
-- Cache TTL changed from 15 minutes to 12 hours to stay within
-- metals.dev free tier (100 req/month ÷ 2 refreshes/day = ~60 req/month)

-- Update the seeded fallback row with current approximate spot prices (March 2026)
UPDATE public.spot_price_cache
SET
  gold       = 2900,
  silver     = 32,
  platinum   = 970,
  fetched_at = '2000-01-01T00:00:00Z',  -- keep epoch so first real fetch triggers immediately
  source     = 'fallback'
WHERE id = 1;

-- Update the default source label
ALTER TABLE public.spot_price_cache
  ALTER COLUMN source SET DEFAULT 'metals.dev';

COMMENT ON TABLE public.spot_price_cache IS
  'Single-row cache of precious metal spot prices. Refreshed every 12 hours via metals.dev API. API key stored as METALS_DEV_API_KEY Supabase secret.';
