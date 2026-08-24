-- Migration: category-hygiene-cron precedence rewrite (Phase 5 of
-- CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md, plan section 3.2).
--
-- The resolver rewrite (Phase 4, PR #532) deleted effective_score from the
-- live decision path entirely -- category-lookup no longer computes or
-- reads it. Two of category-hygiene-cron's four duties were built entirely
-- around that score (decay by 5 after 90 days; expire at score <= 10) and
-- have nothing left to operate on under the new model, so they are dropped
-- by this migration's edge-function counterpart (not by SQL -- the decay/
-- expire logic simply no longer exists in category-hygiene-cron/index.ts).
--
-- What changes here, in SQL:
--   1. find_duplicate_mappings() is rewritten from "keep highest
--      effective_score" to a precedence rule with NO arithmetic, consistent
--      with the resolver's own "no arithmetic" principle (plan section 2):
--        - keep the user_verified row if one exists among the duplicates
--        - otherwise keep the most recently successfully-published row
--        - otherwise keep the most recently updated row
--      and reject the rest.
--   2. A new find_rotted_mappings() RPC: category_mappings rows whose
--      ebay_category_id is no longer a live leaf in ebay_taxonomy_cache --
--      the exact Finding B scenario, but for our own table instead of the
--      AI prompt. These are flagged status = 'needs_review' by the cron
--      job (not silently rejected), since a human should confirm the
--      replacement.
--
-- 'needs_review' is added to category_mappings.status's CHECK constraint
-- alongside the existing approved/quarantine/rejected values.

-- ================================================================
-- 1. Add 'needs_review' to the status CHECK constraint
-- ================================================================

ALTER TABLE public.category_mappings
  DROP CONSTRAINT IF EXISTS category_mappings_status_check;

ALTER TABLE public.category_mappings
  ADD CONSTRAINT category_mappings_status_check
  CHECK (status IN ('approved', 'quarantine', 'rejected', 'needs_review'));

COMMENT ON COLUMN public.category_mappings.status IS
  'Lookup status: approved (used in live lookups), quarantine (pending review), '
  'rejected (known-bad), needs_review (flagged by category-hygiene-cron rot '
  'detection -- ebay_category_id is no longer a live leaf; a human should '
  'confirm the replacement before it is used in live lookups again)';

-- ================================================================
-- 2. Precedence-based dedup (replaces score-based dedup)
-- ================================================================

DROP FUNCTION IF EXISTS public.find_duplicate_mappings();

CREATE OR REPLACE FUNCTION public.find_duplicate_mappings()
RETURNS TABLE (
  id            UUID,
  category_id   TEXT,
  item_type_normalized TEXT,
  verification_source  TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH ranked AS (
    SELECT
      cm.id,
      cm.ebay_category_id,
      cm.item_type_normalized,
      cm.verification_source,
      ROW_NUMBER() OVER (
        PARTITION BY cm.ebay_category_id, cm.item_type_normalized
        ORDER BY
          -- Precedence, not arithmetic: a human correction always survives
          -- a duplicate group over any automated source.
          (cm.verification_source = 'user_verified') DESC,
          cm.last_publish_success DESC NULLS LAST,
          cm.updated_at DESC
      ) AS rn
    FROM public.category_mappings cm
    WHERE cm.status IN ('approved', 'quarantine')
      AND cm.item_type_normalized IS NOT NULL
  )
  SELECT ranked.id, ranked.ebay_category_id, ranked.item_type_normalized, ranked.verification_source
  FROM ranked
  WHERE ranked.rn > 1;
$$;

COMMENT ON FUNCTION public.find_duplicate_mappings IS
  'Returns duplicate category_mappings rows (losers) for dedup by the hygiene '
  'cron job. Precedence, not score: user_verified > most-recently-published > '
  'most-recently-updated. Consistent with the resolver''s no-arithmetic model.';

-- ================================================================
-- 3. Rot detection: mappings pointing at categories that are no longer
--    live leaves in ebay_taxonomy_cache
-- ================================================================

DROP FUNCTION IF EXISTS public.find_rotted_mappings();

CREATE OR REPLACE FUNCTION public.find_rotted_mappings()
RETURNS TABLE (
  id            UUID,
  category_id   TEXT,
  item_type_normalized TEXT,
  cache_status  TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    cm.id,
    cm.ebay_category_id,
    cm.item_type_normalized,
    CASE
      WHEN tc.category_id IS NULL THEN 'absent_from_cache'
      ELSE 'not_a_leaf'
    END AS cache_status
  FROM public.category_mappings cm
  LEFT JOIN public.ebay_taxonomy_cache tc
    ON tc.category_id = cm.ebay_category_id
  WHERE cm.status = 'approved'
    AND (tc.category_id IS NULL OR tc.is_leaf IS NOT TRUE);
$$;

COMMENT ON FUNCTION public.find_rotted_mappings IS
  'Returns approved category_mappings rows whose ebay_category_id is no '
  'longer a confirmed live leaf in ebay_taxonomy_cache (Finding B''s class of '
  'bug, applied to our own table). Flagged needs_review by the hygiene cron, '
  'not silently rejected -- a human should confirm the replacement.';
