-- ============================================================
-- Migration: Draft publish lifecycle tracking
-- ============================================================
--
-- Adds columns to the drafts table to track the full publish
-- lifecycle: draft → publishing → published | failed
--
-- Fields:
--   publish_status    - current lifecycle state
--   published_at      - timestamp when successfully published
--   ebay_sku          - deterministic SKU used on eBay (LA-{draftId})
--   ebay_offer_id     - eBay Offer ID returned after offer creation
--   ebay_listing_id   - eBay Listing ID returned after publish
--   last_publish_error - last error message if publish failed
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Publish status enum-like column (text with check constraint)
-- ----------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'draft'
    CHECK (publish_status IN ('draft', 'publishing', 'published', 'failed'));

-- ----------------------------------------------------------------
-- 2. Publish timestamp
-- ----------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- ----------------------------------------------------------------
-- 3. eBay identifiers stored after successful publish
-- ----------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS ebay_sku          text,
  ADD COLUMN IF NOT EXISTS ebay_offer_id     text,
  ADD COLUMN IF NOT EXISTS ebay_listing_id   text;

-- ----------------------------------------------------------------
-- 4. Last publish error message (for failed state)
-- ----------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS last_publish_error text;

-- ----------------------------------------------------------------
-- 5. Index for filtering by publish status (dashboard queries)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_drafts_publish_status
  ON public.drafts (publish_status);

-- ----------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260315000000 completed:';
  RAISE NOTICE '  - drafts.publish_status added (draft|publishing|published|failed)';
  RAISE NOTICE '  - drafts.published_at added';
  RAISE NOTICE '  - drafts.ebay_sku added';
  RAISE NOTICE '  - drafts.ebay_offer_id added';
  RAISE NOTICE '  - drafts.ebay_listing_id added';
  RAISE NOTICE '  - drafts.last_publish_error added';
  RAISE NOTICE '  - idx_drafts_publish_status index created';
END;
$$;
