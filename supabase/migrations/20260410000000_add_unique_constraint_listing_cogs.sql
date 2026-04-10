-- Migration: Add unique partial index on listing_cogs(user_id, ebay_sku)
--
-- The original migration only created regular (non-unique) indexes, which means
-- upsert calls with onConflict: "ebay_sku" silently failed in PostgreSQL (it
-- requires a unique or exclusion constraint to resolve conflicts).
--
-- This index is PARTIAL (WHERE ebay_sku IS NOT NULL) so NULL skus don't collide
-- with each other, allowing insert-only rows when only listingId is known.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_cogs_user_sku
  ON public.listing_cogs (user_id, ebay_sku)
  WHERE ebay_sku IS NOT NULL;
