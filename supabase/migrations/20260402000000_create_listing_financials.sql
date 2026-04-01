-- Migration: Create listing_financials table (Phase 1 — additive only)
-- Unified financial record for every sold eBay order line item.
-- Written by the cogs-report edge function as a dual-write alongside the
-- existing listing_cogs / live-API fetch flow.  Phase 2 will switch reads
-- to this table; Phase 1 only populates it.

CREATE TABLE IF NOT EXISTS public.listing_financials (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- eBay order identifiers
  order_id             TEXT        NOT NULL,
  ebay_listing_id      TEXT,                        -- legacyItemId from eBay (may be null)
  ebay_sku             TEXT,                        -- SKU as set on the eBay listing

  -- Item description (denormalised for fast reporting without joins)
  title                TEXT        NOT NULL DEFAULT '',

  -- Revenue side (from eBay Fulfillment API)
  sale_price           NUMERIC     NOT NULL DEFAULT 0,  -- lineItemCost * quantity
  shipping_buyer_paid  NUMERIC     NOT NULL DEFAULT 0,  -- deliveryCost.shippingCost

  -- Cost side
  ebay_fees            NUMERIC     NOT NULL DEFAULT 0,  -- sum of marketplaceFees
  cogs                 NUMERIC,                         -- from listing_cogs (null = unknown)
  shipping_label_cost  NUMERIC,                         -- outbound label cost (Phase 2+)
  refund               NUMERIC     NOT NULL DEFAULT 0,  -- refund / partial refund amount

  -- Derived (stored for fast aggregation; recomputed on each upsert)
  net_profit           NUMERIC     NOT NULL DEFAULT 0,

  -- Timestamps
  sold_at              TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.listing_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own listing_financials" ON public.listing_financials;

CREATE POLICY "Users can manage own listing_financials"
  ON public.listing_financials
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── Unique constraint for idempotent upserts ──────────────────────────────────
-- Each (user, order, listing) tuple is unique — one row per line item per order.
-- ebay_listing_id is the most stable identifier; order_id alone is not enough
-- because one order can have multiple line items from different listings.
-- We allow NULL in ebay_listing_id; NULLS are treated as distinct in unique
-- indexes by default in Postgres, so we use a partial unique index trick:
--   * When ebay_listing_id IS NOT NULL → unique on (user_id, order_id, ebay_listing_id)
--   * When ebay_listing_id IS NULL but ebay_sku IS NOT NULL
--     → unique on (user_id, order_id, ebay_sku)
-- In practice both will almost always be non-null for published listings.

CREATE UNIQUE INDEX IF NOT EXISTS uidx_lf_order_listing
  ON public.listing_financials (user_id, order_id, ebay_listing_id)
  WHERE ebay_listing_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_lf_order_sku
  ON public.listing_financials (user_id, order_id, ebay_sku)
  WHERE ebay_listing_id IS NULL AND ebay_sku IS NOT NULL;

-- ─── Performance indexes ───────────────────────────────────────────────────────
-- Fast date-range queries for P&L reports
CREATE INDEX IF NOT EXISTS idx_lf_user_sold_at
  ON public.listing_financials (user_id, sold_at DESC);

-- Lookup by SKU (linking back to listing_cogs or drafts)
CREATE INDEX IF NOT EXISTS idx_lf_sku
  ON public.listing_financials (ebay_sku)
  WHERE ebay_sku IS NOT NULL;

-- Lookup by eBay listing ID
CREATE INDEX IF NOT EXISTS idx_lf_listing_id
  ON public.listing_financials (ebay_listing_id)
  WHERE ebay_listing_id IS NOT NULL;

-- ─── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_listing_financials_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lf_updated_at ON public.listing_financials;

CREATE TRIGGER trg_lf_updated_at
  BEFORE UPDATE ON public.listing_financials
  FOR EACH ROW EXECUTE FUNCTION public.set_listing_financials_updated_at();

-- ─── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.listing_financials IS
  'Unified per-line-item financial record for sold eBay orders. '
  'Populated by the cogs-report edge function. '
  'Phase 1: write-only (reads still use legacy listing_cogs + live API). '
  'Phase 2 will switch all reporting reads to this table.';

COMMENT ON COLUMN public.listing_financials.sale_price IS
  'Item sale price × quantity (lineItemCost from eBay Fulfillment API)';
COMMENT ON COLUMN public.listing_financials.shipping_buyer_paid IS
  'Shipping amount collected from the buyer';
COMMENT ON COLUMN public.listing_financials.ebay_fees IS
  'Sum of all eBay marketplace fees for this line item';
COMMENT ON COLUMN public.listing_financials.cogs IS
  'Cost of goods sold — looked up from listing_cogs at report time (null = unknown)';
COMMENT ON COLUMN public.listing_financials.shipping_label_cost IS
  'Outbound shipping label cost — to be populated in a later phase';
COMMENT ON COLUMN public.listing_financials.refund IS
  'Refund or partial refund issued to the buyer (stored as positive amount)';
COMMENT ON COLUMN public.listing_financials.net_profit IS
  'sale_price + shipping_buyer_paid - ebay_fees - cogs - shipping_label_cost - refund';