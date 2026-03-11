-- Add listing_price and listing_format columns to drafts table
-- listing_price: the price the user chose to list at (not AI min/max)
-- listing_format: FIXED_PRICE (Buy It Now) or AUCTION

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS listing_price NUMERIC,
  ADD COLUMN IF NOT EXISTS listing_format TEXT DEFAULT 'FIXED_PRICE',
  ADD COLUMN IF NOT EXISTS ebay_category_breadcrumb TEXT;
