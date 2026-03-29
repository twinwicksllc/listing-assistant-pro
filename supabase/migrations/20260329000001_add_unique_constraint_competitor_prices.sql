-- Add unique constraint to competitor_prices for safe upsert operations
-- Ensures only one "latest" snapshot per user per listing
-- Previous approach (delete + insert) can have race conditions; upsert is atomic

ALTER TABLE competitor_prices
  ADD CONSTRAINT uq_competitor_prices_user_listing 
  UNIQUE (user_id, ebay_listing_id);

-- Note: If duplicate rows exist in dev/sandbox, this migration may fail.
-- If needed, manually delete duplicates first:
-- DELETE FROM competitor_prices WHERE id NOT IN (
--   SELECT DISTINCT ON (user_id, ebay_listing_id) id 
--   FROM competitor_prices 
--   ORDER BY user_id, ebay_listing_id, fetched_at DESC
-- );
