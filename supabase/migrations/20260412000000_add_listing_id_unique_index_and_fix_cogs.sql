-- Migration: Add unique index on (user_id, ebay_listing_id) to listing_cogs
-- and clean up duplicate rows.
--
-- Previously only (user_id, ebay_sku) had a unique constraint. This meant:
--   1. COGS upserts by listing ID would create duplicate rows
--   2. Items without SKU couldn't be reliably upserted
--
-- The eBay item number (ebay_listing_id) is the most stable identifier and
-- should be the PRIMARY matching key for COGS records.

-- Step 1: Remove duplicate listing_cogs rows (keep the most recently updated one)
-- This is necessary before we can add the unique index.
DELETE FROM public.listing_cogs a
USING public.listing_cogs b
WHERE a.user_id = b.user_id
  AND a.ebay_listing_id IS NOT NULL
  AND a.ebay_listing_id = b.ebay_listing_id
  AND a.id < b.id;  -- keep the row with the larger (newer) id

-- Step 2: Add unique partial index on (user_id, ebay_listing_id)
-- Partial: only where ebay_listing_id IS NOT NULL, so NULL values don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_cogs_user_listing_id
  ON public.listing_cogs (user_id, ebay_listing_id)
  WHERE ebay_listing_id IS NOT NULL;