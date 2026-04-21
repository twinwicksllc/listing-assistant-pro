-- Migration: Create ebay_taxonomy_cache table
--
-- This table is the source of truth for eBay category breadcrumbs.
-- It is populated by the sync-ebay-taxonomy weekly cron job which calls
-- GET /commerce/taxonomy/v1/category_tree/0 (full tree, single API call)
-- and walks all leaf nodes. Any category not yet in this table is looked
-- up on-the-fly via getCategorySubtree and auto-cached here.
--
-- This replaces ALL hardcoded EBAY_CATEGORY_BREADCRUMBS maps in the codebase.
-- When eBay renames or restructures categories the weekly sync keeps us current.

CREATE TABLE IF NOT EXISTS public.ebay_taxonomy_cache (
  -- eBay leaf category ID (e.g. "39461").  This is the PRIMARY KEY so that
  -- every category appears exactly once and upserts are conflict-free.
  category_id       TEXT PRIMARY KEY,

  -- Leaf node display name (e.g. "Commemorative")
  category_name     TEXT NOT NULL,

  -- Full ancestor path (e.g. "Coins & Paper Money > Coins: US > Half Dollars > Commemorative")
  breadcrumb        TEXT NOT NULL,

  -- Direct parent category ID — allows future tree-walk queries without eBay API
  parent_category_id TEXT,

  -- True when this node had no children at sync time.
  -- After a sync all rows should be leaves; this column documents intent.
  is_leaf           BOOLEAN NOT NULL DEFAULT TRUE,

  -- When the weekly sync last wrote/confirmed this row
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Standard audit columns
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by parent (for future tree-walk UI)
CREATE INDEX IF NOT EXISTS idx_ebay_taxonomy_cache_parent
  ON public.ebay_taxonomy_cache (parent_category_id);

-- Fast recency queries (find stale rows after a sync)
CREATE INDEX IF NOT EXISTS idx_ebay_taxonomy_cache_synced
  ON public.ebay_taxonomy_cache (synced_at DESC);

-- Auto-update updated_at on any write
CREATE OR REPLACE FUNCTION public.set_ebay_taxonomy_cache_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ebay_taxonomy_cache_updated_at
  BEFORE UPDATE ON public.ebay_taxonomy_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_ebay_taxonomy_cache_updated_at();

-- RLS: service role only (internal cache, never exposed to end-users directly)
ALTER TABLE public.ebay_taxonomy_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ebay_taxonomy_cache"
  ON public.ebay_taxonomy_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.ebay_taxonomy_cache IS
  'Cache of ALL eBay US leaf categories with full breadcrumb paths. '
  'Populated/refreshed weekly by sync-ebay-taxonomy cron. '
  'Single rows also written on-the-fly when a category is first encountered. '
  'Replaces all hardcoded EBAY_CATEGORY_BREADCRUMBS maps in the codebase.';

COMMENT ON COLUMN public.ebay_taxonomy_cache.breadcrumb IS
  'Full eBay ancestor path joined with " > ", e.g. '
  '"Coins & Paper Money > Coins: US > Half Dollars > Commemorative"';

COMMENT ON COLUMN public.ebay_taxonomy_cache.synced_at IS
  'Timestamp of the most recent authoritative write (full-tree sync or live lookup). '
  'Rows older than 8 days were missed by the last weekly sync and should be reverified.';
