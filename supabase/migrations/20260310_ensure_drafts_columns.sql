-- Ensure all required columns exist on drafts table
-- This handles cases where migrations may not have applied correctly
-- Adds all columns needed for draft staging and publishing

ALTER TABLE public.drafts
  -- Core draft fields
  ADD COLUMN IF NOT EXISTS price_min NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_max NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_urls TEXT[],
  ADD COLUMN IF NOT EXISTS ebay_category_id TEXT,
  ADD COLUMN IF NOT EXISTS item_specifics JSONB DEFAULT '{}',
  
  -- Organization support
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  
  -- Item details
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS consignor TEXT DEFAULT '',
  
  -- Listing format and pricing
  ADD COLUMN IF NOT EXISTS listing_format TEXT DEFAULT 'FIXED_PRICE',
  ADD COLUMN IF NOT EXISTS listing_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auction_start_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auction_buy_it_now NUMERIC(10,2);
