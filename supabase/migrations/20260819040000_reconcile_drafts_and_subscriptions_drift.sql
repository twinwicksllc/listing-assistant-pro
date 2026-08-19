-- Migration: reconcile drafts and subscriptions column drift
--
-- Resolves RBR-0021. `drafts` live has 9 columns absent from tracked
-- migrations (confirmed via information_schema.columns, 2026-08-19):
-- condition_id, ebay_category_name, fulfillment_policy_id, listing_id,
-- payment_policy_id, price, return_policy_id, status, updated_at. Built
-- from migrations alone, a fresh database would silently lack listing
-- status, price, listing ID, and all three eBay business-policy bindings --
-- the publish flow would fail in ways that present as application bugs
-- rather than schema problems (see REBRAND_PHASE_0_RESTORE_REPORT.md).
--
-- `subscriptions` live has `org_id` and no `created_at` column at all, the
-- exact inverse of what the original migration
-- (20260320000000_add_stripe_subscription_tables.sql) declared -- both
-- sides have 11 columns, so a count-based comparison alone misses this.
--
-- Re-verifying column-by-column on 2026-08-19 also found three additional,
-- previously undocumented drifts on `subscriptions` not caught by the
-- original 2026-08-14 investigation (which focused on column names, not
-- nullability): `current_period_end`, `stripe_sub_id`, and `stripe_cust_id`
-- are all declared NOT NULL by the original migration but are nullable in
-- live production. Relaxed here to match live -- this migration describes
-- what production already is, not what it was originally designed to be.
--
-- The `subscriptions_status_check` CHECK constraint (RBR-0022) is
-- deliberately NOT reinstated here -- see that migration's own header for
-- why (the live column default doesn't satisfy the original 8-value list).

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS condition_id TEXT,
  ADD COLUMN IF NOT EXISTS ebay_category_name TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS listing_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS price NUMERIC,
  ADD COLUMN IF NOT EXISTS return_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_drafts_published_at ON public.drafts(published_at);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  DROP COLUMN IF EXISTS created_at,
  ALTER COLUMN current_period_end DROP NOT NULL,
  ALTER COLUMN stripe_sub_id DROP NOT NULL,
  ALTER COLUMN stripe_cust_id DROP NOT NULL;
