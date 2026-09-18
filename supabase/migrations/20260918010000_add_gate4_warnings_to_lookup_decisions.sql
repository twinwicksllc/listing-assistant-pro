-- Migration: persist Gate 4 (required-aspect satisfiability) warnings on
-- every gated candidate, not just the winner.
--
-- CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md §2.4/§6 (Phase 6): Gate 4
-- ships warn-only -- it never drops a candidate unless
-- CATEGORY_GATE4_ENFORCE=true (currently false in production) -- and is
-- meant to stay that way until two weeks of real warn-only data has been
-- reviewed for false positives.
--
-- Checked directly against the live code and the live lookup_decisions
-- table (2026-09-18): gateCandidate() in category-lookup/index.ts computes
-- gate4Warnings for EVERY candidate (part of resolverCore.ts's
-- GatedCandidate), but it was never persisted anywhere. It only ever
-- reached the HTTP response body for the WINNING candidate
-- (result.winner.gate4Warnings in the `lookup` action's response). The
-- audit table had no column for it at all. So there was zero queryable
-- data to ever review -- the two-week clock had not started, because
-- nothing was being recorded, not because not enough time had passed.
--
-- TEXT[] (not JSONB): gate4Warnings is a plain array of human-readable
-- warning strings (see checkAspectSatisfiability's push(`Required aspect
-- "${aspect.name}" has no plausible value...`)), not structured data --
-- matches this table's sibling image_urls TEXT[] convention
-- (20260310200000_add_staging_columns_to_drafts.sql) rather than the
-- JSONB convention used for genuinely structured payloads elsewhere
-- (category_aspects_cache.aspects, competitor_prices.price_distribution).
ALTER TABLE public.lookup_decisions
  ADD COLUMN IF NOT EXISTS gate4_warnings TEXT[];

COMMENT ON COLUMN public.lookup_decisions.gate4_warnings IS
  'Gate 4 (required-aspect satisfiability) warnings for THIS candidate, empty/null when none. Recorded for every gated candidate (survivors and drops alike, winner and non-winners), not just the winner -- reviewing false-positive rate requires seeing warnings on candidates that were never selected too. Warn-only: presence here never dropped a candidate unless CATEGORY_GATE4_ENFORCE=true. This is the queryable dataset Phase 6 needs before promoting Gate 4 to enforcing.';
