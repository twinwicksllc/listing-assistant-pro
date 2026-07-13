-- Migration: Add domain tracking (Phase 4 - additive only)
-- Adds a `domain` column to both `drafts` and `listing_financials` so that
-- per-domain quality metrics (time-to-sale, net profit) can be computed once
-- a listing sells. Also adds `time_to_sale_days` to `listing_financials`,
-- computed at write-time by the cogs-report edge function from the draft's
-- published_at and the order's sold_at.
--
-- This is purely additive: existing rows get NULL domain (unknown / created
-- before this migration) and are simply excluded from per-domain aggregates
-- until a draft's domain is set on future analyses.

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS domain TEXT;

COMMENT ON COLUMN public.drafts.domain IS
  'Item domain classified by Pass-1 AI identification (e.g. coins_bullion, sneakers, electronics). '
  'NULL for drafts created before this column existed. Used for per-domain quality-assurance reporting.';

CREATE INDEX IF NOT EXISTS idx_drafts_domain
  ON public.drafts (domain)
  WHERE domain IS NOT NULL;

ALTER TABLE public.listing_financials
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS time_to_sale_days NUMERIC;

COMMENT ON COLUMN public.listing_financials.domain IS
  'Item domain, resolved from the matching drafts row (by ebay_sku / ebay_listing_id) at cogs-report time. '
  'NULL when no matching draft is found (e.g. listing created outside the app, or before domain tracking existed).';

COMMENT ON COLUMN public.listing_financials.time_to_sale_days IS
  'Days between the draft''s published_at and this order''s sold_at. NULL when published_at is unknown.';

CREATE INDEX IF NOT EXISTS idx_lf_domain
  ON public.listing_financials (domain)
  WHERE domain IS NOT NULL;

-- ─── Domain quality metrics view ───────────────────────────────────────────
-- Aggregates sold-listing financials by domain to power the Phase 4
-- quality-assurance feedback loop (a lightweight report, not a full
-- dashboard). Only includes rows with a known domain and sold_at.
--
-- NOTE: rejection-rate and edit-rate are NOT included here because there is
-- no existing instrumentation to track listing edits or publish rejections
-- anywhere in the codebase. This view intentionally scopes to metrics that
-- are derivable today (count sold, avg net profit, avg time-to-sale). See
-- COMPREHENSIVE_LISTING_TYPES_ROADMAP.md Phase 4 section for the documented
-- deferral of rejection-rate/edit-rate to future instrumentation work.
CREATE OR REPLACE VIEW public.domain_quality_metrics AS
SELECT
  lf.user_id,
  lf.domain,
  COUNT(*)                                  AS sold_count,
  AVG(lf.net_profit)                        AS avg_net_profit,
  AVG(lf.sale_price)                        AS avg_sale_price,
  AVG(lf.time_to_sale_days)                 AS avg_time_to_sale_days,
  MIN(lf.sold_at)                           AS earliest_sale,
  MAX(lf.sold_at)                           AS latest_sale
FROM public.listing_financials lf
WHERE lf.domain IS NOT NULL
GROUP BY lf.user_id, lf.domain;

COMMENT ON VIEW public.domain_quality_metrics IS
  'Per-user, per-domain rollup of sold-listing financials: count, avg net profit, avg sale price, avg time-to-sale. '
  'Powers the Phase 4 domain-quality-report edge function. Rejection-rate/edit-rate are deferred (no instrumentation yet).';

-- Views inherit RLS from underlying tables only when declared with the
-- security_invoker option (Postgres 15+) - Supabase Postgres supports this.
ALTER VIEW public.domain_quality_metrics SET (security_invoker = true);
