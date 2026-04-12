-- Add staging/publishing fields to drafts table so drafts can serve as a
-- true pre-publish staging area (format, price, all image URLs).

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS listing_format TEXT DEFAULT 'FIXED_PRICE',
  ADD COLUMN IF NOT EXISTS listing_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auction_start_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auction_buy_it_now NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS image_urls TEXT[];
