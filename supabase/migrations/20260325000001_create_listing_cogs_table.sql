-- Migration: Create listing_cogs table
-- Persistent COGS records linked to published listings by SKU / listing ID.
-- Survives draft deletion so the Profit Report can always match sold orders to costs.

CREATE TABLE IF NOT EXISTS public.listing_cogs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id           UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  ebay_sku         TEXT,
  ebay_listing_id  TEXT,
  title            TEXT        NOT NULL DEFAULT '',
  cogs             NUMERIC     NOT NULL DEFAULT 0,
  cogs_source      TEXT        NOT NULL DEFAULT 'manual',
  acquired_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_cogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own listing_cogs"
  ON public.listing_cogs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indexes for fast joins when matching sold orders
CREATE INDEX IF NOT EXISTS idx_listing_cogs_sku
  ON public.listing_cogs(ebay_sku);

CREATE INDEX IF NOT EXISTS idx_listing_cogs_listing_id
  ON public.listing_cogs(ebay_listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_cogs_user_id
  ON public.listing_cogs(user_id);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_listing_cogs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_listing_cogs_updated_at
  BEFORE UPDATE ON public.listing_cogs
  FOR EACH ROW EXECUTE FUNCTION public.set_listing_cogs_updated_at();