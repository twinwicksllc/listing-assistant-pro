-- Migration: Add quantity and unit_cogs columns to listing_financials
-- These columns are needed to correctly handle multi-unit eBay orders.
--
-- Previously, COGS was stored as a single value regardless of how many units
-- were sold. This migration adds:
--   quantity   - the number of units sold in this line item (default 1 for
--                all existing rows, which is correct for single-unit orders)
--   unit_cogs  - the per-unit COGS (for reference / future repricing logic)
--
-- The existing `cogs` column is now the TOTAL line COGS (unit_cogs × quantity).
-- Existing rows with quantity=1 are unaffected: total line COGS = unit COGS.
--
-- To backfill existing multi-quantity rows: simply re-run the COGS report
-- for the desired date range. The upsert is idempotent and will recompute
-- all values correctly using the updated cogs-report edge function.

ALTER TABLE public.listing_financials
  ADD COLUMN IF NOT EXISTS quantity   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_cogs  NUMERIC;

-- Update column comments to clarify semantics
COMMENT ON COLUMN public.listing_financials.quantity IS
  'Number of units sold in this line item (from eBay lineItem.quantity)';

COMMENT ON COLUMN public.listing_financials.unit_cogs IS
  'Per-unit cost of goods sold (from listing_cogs). Multiply by quantity for total line COGS.';

COMMENT ON COLUMN public.listing_financials.cogs IS
  'Total line COGS = unit_cogs × quantity (null = unknown). Used in net_profit calculation.';

COMMENT ON COLUMN public.listing_financials.net_profit IS
  'sale_price + shipping_buyer_paid - ebay_fees - cogs (total) - shipping_label_cost - refund';