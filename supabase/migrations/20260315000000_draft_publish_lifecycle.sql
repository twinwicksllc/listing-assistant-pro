-- Migration: Draft publish lifecycle tracking fields
-- Adds fields to track eBay publish status, listing IDs, and errors per draft.
-- These fields are written by the usePublishDraft hook after each publish attempt.

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS publish_status   TEXT    DEFAULT 'draft'
    CHECK (publish_status IN ('draft', 'publishing', 'published', 'failed')),
  ADD COLUMN IF NOT EXISTS published_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ebay_sku         TEXT,
  ADD COLUMN IF NOT EXISTS ebay_offer_id    TEXT,
  ADD COLUMN IF NOT EXISTS ebay_listing_id  TEXT,
  ADD COLUMN IF NOT EXISTS last_publish_error TEXT;

-- Index for filtering drafts by publish status (e.g. show only unpublished)
CREATE INDEX IF NOT EXISTS idx_drafts_publish_status
  ON drafts (publish_status);

-- Index for looking up a draft by its eBay SKU (for idempotent retry detection)
CREATE INDEX IF NOT EXISTS idx_drafts_ebay_sku
  ON drafts (ebay_sku)
  WHERE ebay_sku IS NOT NULL;

COMMENT ON COLUMN drafts.publish_status IS
  'Lifecycle state: draft (default) | publishing (in-flight) | published (live on eBay) | failed';
COMMENT ON COLUMN drafts.published_at IS
  'Timestamp when the draft was successfully published to eBay';
COMMENT ON COLUMN drafts.ebay_sku IS
  'Deterministic eBay SKU used for this listing (LA-{draftId prefix})';
COMMENT ON COLUMN drafts.ebay_offer_id IS
  'eBay Offer ID returned after createOffer call';
COMMENT ON COLUMN drafts.ebay_listing_id IS
  'eBay Listing ID returned after publishOffer call (null if publish step failed)';
COMMENT ON COLUMN drafts.last_publish_error IS
  'Error message from the most recent failed publish attempt';
