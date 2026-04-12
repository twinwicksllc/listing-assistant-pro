-- Migration: Add COGS columns to drafts table
-- Adds cost of goods sold tracking to every listing draft

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS cogs             NUMERIC       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cogs_source      TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cogs_acquired_at TIMESTAMPTZ   DEFAULT NULL;

COMMENT ON COLUMN public.drafts.cogs IS
  'Cost of goods sold — what the seller paid to acquire this item';
COMMENT ON COLUMN public.drafts.cogs_source IS
  'How COGS was entered: manual | import | consignor_split';
COMMENT ON COLUMN public.drafts.cogs_acquired_at IS
  'Date item was acquired (for aged-inventory reporting)';