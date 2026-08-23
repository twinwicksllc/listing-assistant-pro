-- Migration: Create ebay_taxonomy_meta table
--
-- Tracks eBay's `categoryTreeVersion` so we can detect taxonomy DRIFT.
--
-- WHY
-- ---
-- eBay returns `categoryTreeVersion` on Taxonomy API responses and their
-- documentation recommends tracking it. When that version changes, eBay has
-- restructured the category tree, which can silently invalidate:
--   * cached breadcrumbs in ebay_taxonomy_cache
--   * stored mappings in category_mappings
--   * any hardcoded leaf category ID in the codebase
--
-- Previously the version was discarded, so a restructure only surfaced later
-- as hard-to-diagnose "wrong category" reports. The weekly sync-ebay-taxonomy
-- cron now records it here and logs loudly when it changes.
--
-- This table holds exactly one row per category tree (tree "0" = EBAY_US).

CREATE TABLE IF NOT EXISTS public.ebay_taxonomy_meta (
  -- eBay category tree ID. "0" is the EBAY_US marketplace tree.
  category_tree_id      TEXT PRIMARY KEY,

  -- The version string eBay reported at the last successful sync,
  -- e.g. "137". A change here means the taxonomy was restructured.
  category_tree_version TEXT NOT NULL,

  -- Number of leaf categories observed in that version. A large swing is a
  -- useful secondary signal that something structural changed.
  leaf_count            INTEGER,

  -- When the version above was last confirmed by a successful sync.
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Standard audit columns
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on any write (mirrors ebay_taxonomy_cache).
CREATE OR REPLACE FUNCTION public.set_ebay_taxonomy_meta_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ebay_taxonomy_meta_updated_at ON public.ebay_taxonomy_meta;

CREATE TRIGGER trg_ebay_taxonomy_meta_updated_at
  BEFORE UPDATE ON public.ebay_taxonomy_meta
  FOR EACH ROW EXECUTE FUNCTION public.set_ebay_taxonomy_meta_updated_at();

-- RLS: service role only (internal metadata, never exposed to end-users).
ALTER TABLE public.ebay_taxonomy_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on ebay_taxonomy_meta"
  ON public.ebay_taxonomy_meta;

CREATE POLICY "Service role full access on ebay_taxonomy_meta"
  ON public.ebay_taxonomy_meta
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.ebay_taxonomy_meta IS
  'Tracks eBay categoryTreeVersion per category tree so taxonomy restructures '
  'are detected. Written by the weekly sync-ebay-taxonomy cron.';

COMMENT ON COLUMN public.ebay_taxonomy_meta.category_tree_version IS
  'eBay categoryTreeVersion at last successful sync. A change means eBay '
  'restructured the tree; cached breadcrumbs, stored category_mappings and '
  'hardcoded leaf IDs should be re-verified.';
