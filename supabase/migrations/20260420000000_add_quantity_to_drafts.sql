-- Add quantity and pricing_mode columns to the drafts table.
-- quantity: how many units of the item are available (default 1)
-- pricing_mode: 'per_item' means listingPrice IS the per-unit price;
--               'total'    means listingPrice is the total for all units
--               (eBay receives listingPrice / quantity as the per-item price)

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'per_item';
