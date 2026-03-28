-- Migration: Add category_aspects_cache table for dynamic eBay aspect rules
-- Stores the output of eBay's getItemAspectsForCategory API per category ID
-- Eliminates the need for hardcoded CATEGORY_ASPECT_RULES in ebay-publish

-- 1. Create the cache table
CREATE TABLE IF NOT EXISTS public.category_aspects_cache (
  category_id    TEXT PRIMARY KEY,           -- eBay leaf category ID (e.g., "39464")
  category_name  TEXT,                       -- Human-readable name (e.g., "Morgan (1878-1921)")
  aspects        JSONB NOT NULL DEFAULT '[]', -- Array of aspect objects from eBay API
  -- Each aspect: {
  --   name: string,
  --   required: boolean,
  --   usage: "RECOMMENDED" | "OPTIONAL",
  --   mode: "FREE_TEXT" | "SELECTION_ONLY",
  --   dataType: "STRING" | "NUMBER" | "DATE" | "STRING_ARRAY",
  --   values: string[] | null  (allowed values for SELECTION_ONLY)
  -- }
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Index for expiry checks (find stale entries to refresh)
CREATE INDEX IF NOT EXISTS idx_category_aspects_cache_expires
  ON public.category_aspects_cache(expires_at);

-- 3. Also enhance category_mappings with breadcrumb storage
-- (getCategorySuggestions returns full ancestor paths — store them)
ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS breadcrumb TEXT;

COMMENT ON TABLE public.category_aspects_cache IS 
  'Cache of eBay getItemAspectsForCategory API responses. Refreshed every 7 days. Replaces hardcoded CATEGORY_ASPECT_RULES.';

COMMENT ON COLUMN public.category_mappings.breadcrumb IS 
  'Full eBay category breadcrumb path (e.g., "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)")';

-- 4. RLS policies (service role only — these are internal caches)
ALTER TABLE public.category_aspects_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on category_aspects_cache"
  ON public.category_aspects_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');