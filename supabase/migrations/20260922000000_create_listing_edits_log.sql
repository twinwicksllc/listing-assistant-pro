-- Migration: Create listing_edits_log table
-- Immutable audit trail of every edit made to a live eBay listing via the
-- Listing Editor (ebay-edit-listing / ebay-reprice). Written on every save
-- attempt, success or failure, so users can see what changed and when.

CREATE TABLE IF NOT EXISTS public.listing_edits_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  ebay_sku        TEXT,
  ebay_listing_id TEXT,
  ebay_offer_id   TEXT,
  fields_changed  TEXT[]      NOT NULL DEFAULT '{}',
  old_values      JSONB       NOT NULL DEFAULT '{}',
  new_values      JSONB       NOT NULL DEFAULT '{}',
  success         BOOLEAN     NOT NULL DEFAULT false,
  error_message   TEXT,
  ebay_api_path   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_edits_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own edit logs" ON public.listing_edits_log;

CREATE POLICY "Users can read own edit logs"
  ON public.listing_edits_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_listing_edits_sku
  ON public.listing_edits_log(ebay_sku);

CREATE INDEX IF NOT EXISTS idx_listing_edits_listing_id
  ON public.listing_edits_log(ebay_listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_edits_user_id
  ON public.listing_edits_log(user_id);

CREATE INDEX IF NOT EXISTS idx_listing_edits_created_at
  ON public.listing_edits_log(created_at DESC);
