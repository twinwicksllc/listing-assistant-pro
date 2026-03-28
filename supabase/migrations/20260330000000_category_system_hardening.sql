-- Migration: Category System Hardening
-- Addresses deficiencies #0, #2, #6, #7, #8, #9
--
-- Changes:
--   1. lookup_decisions audit table (deficiency #0, #9)
--   2. status column on category_mappings (deficiency #2)
--   3. item_type_normalized column + dedup (deficiency #6)
--   4. Extend category_aspects_cache key with marketplace_id + category_tree_id (deficiency #7)
--   5. effective_score + last_publish_success columns (deficiency #8)
--   6. Confidence decay support (deficiency #8)

-- ================================================================
-- 1. AUDIT TABLE: lookup_decisions
-- ================================================================
-- Persists the full decision trace for every category lookup.
-- Enables debugging, retraining, and before/after comparison.

CREATE TABLE IF NOT EXISTS public.lookup_decisions (
  id                BIGSERIAL PRIMARY KEY,
  request_id        TEXT NOT NULL,                    -- UUID for correlating multi-step lookups
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  query_text        TEXT,                             -- Original input text
  -- Candidate details
  candidate_source  TEXT NOT NULL,                    -- db_exact, db_fuzzy, ebay_api, gemini
  candidate_id      TEXT,                             -- eBay category ID of this candidate
  candidate_name    TEXT,                             -- Category name
  candidate_score   NUMERIC(5,2) DEFAULT 0,          -- Effective score (0-100)
  candidate_rank    INT DEFAULT 0,                    -- Rank within source (1 = best)
  -- Selection details
  was_selected      BOOLEAN DEFAULT FALSE,            -- True for the winning candidate
  reason_selected   TEXT,                             -- Why this candidate won or lost
  -- Verification
  verified_leaf     BOOLEAN,                          -- Is this a leaf category?
  verified_active   BOOLEAN,                          -- Is this category still active?
  -- Persistence
  persisted_to_db   BOOLEAN DEFAULT FALSE,            -- Was this saved to category_mappings?
  -- Latency
  latency_ms        INT DEFAULT 0                     -- Time for this source lookup
);

CREATE INDEX IF NOT EXISTS idx_lookup_decisions_request_id
  ON public.lookup_decisions(request_id);

CREATE INDEX IF NOT EXISTS idx_lookup_decisions_created_at
  ON public.lookup_decisions(created_at);

CREATE INDEX IF NOT EXISTS idx_lookup_decisions_candidate_id
  ON public.lookup_decisions(candidate_id)
  WHERE was_selected = TRUE;

-- RLS: service role only
ALTER TABLE public.lookup_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'lookup_decisions'
      AND policyname = 'Service role full access on lookup_decisions'
  ) THEN
    CREATE POLICY "Service role full access on lookup_decisions"
      ON public.lookup_decisions
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.lookup_decisions IS
  'Audit trail of every category lookup decision. Used for debugging, metrics, and retraining.';

-- ================================================================
-- 2. STATUS COLUMN on category_mappings (deficiency #2)
-- ================================================================
-- Controls whether a mapping is used in live lookups.
-- approved  = trusted, used in lookups
-- quarantine = unverified, not used in lookups until promoted
-- rejected  = known-bad, never used

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'quarantine'
    CHECK (status IN ('approved', 'quarantine', 'rejected'));

-- Backfill: trusted sources → approved, AI auto → quarantine
-- Only run if status column was just added (check by seeing if any rows have the default)
DO $$
BEGIN
  -- Check if we need to backfill (if most rows still have the default 'quarantine')
  IF EXISTS (SELECT 1 FROM public.category_mappings WHERE status = 'quarantine' LIMIT 1) THEN
    UPDATE public.category_mappings
      SET status = 'approved'
      WHERE verification_source IN ('user_verified', 'ebay_api')
        AND status = 'quarantine';

    -- ebay_api with high confidence also approved
    UPDATE public.category_mappings
      SET status = 'approved'
      WHERE verification_source = 'ebay_api'
        AND confidence >= 85;

    -- gemini_ai with high confidence → approved (it was verified by the API call)
    UPDATE public.category_mappings
      SET status = 'approved'
      WHERE verification_source = 'gemini_ai'
        AND confidence >= 90;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_category_mappings_status
  ON public.category_mappings(status)
  WHERE status = 'approved';

COMMENT ON COLUMN public.category_mappings.status IS
  'Lookup status: approved (used in live lookups), quarantine (pending review), rejected (known-bad)';

-- ================================================================
-- 3. NORMALIZED item_type + DEDUP SUPPORT (deficiency #6)
-- ================================================================

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS item_type_normalized TEXT;

-- Backfill: lowercase, strip non-alphanumeric (except spaces/hyphens), collapse whitespace
UPDATE public.category_mappings
  SET item_type_normalized = LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        COALESCE(item_type, coin_type, ''),
        '[^a-zA-Z0-9\s\-]', '', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
  WHERE item_type_normalized IS NULL;

-- Unique index on normalized key (only for approved rows to avoid conflict on dedup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_mappings_normalized_unique
  ON public.category_mappings(item_type_normalized)
  WHERE item_type_normalized IS NOT NULL AND status = 'approved';

COMMENT ON COLUMN public.category_mappings.item_type_normalized IS
  'Normalized item_type for dedup: lowercase, stripped punctuation, collapsed whitespace';

-- ================================================================
-- 4. EXTEND category_aspects_cache KEY (deficiency #7)
-- ================================================================
-- Add marketplace_id and category_tree_id for context-correct caching.
-- Default marketplace_id = 'EBAY_US' and category_tree_id = '0' (US tree).

ALTER TABLE public.category_aspects_cache
  ADD COLUMN IF NOT EXISTS marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US';

ALTER TABLE public.category_aspects_cache
  ADD COLUMN IF NOT EXISTS category_tree_id TEXT NOT NULL DEFAULT '0';

-- Drop old PK and create composite PK
-- (Wrapped in DO block for idempotency)
DO $$
BEGIN
  -- Check if the old PK exists and is single-column
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'category_aspects_cache_pkey'
      AND conrelid = 'public.category_aspects_cache'::regclass
  ) THEN
    ALTER TABLE public.category_aspects_cache DROP CONSTRAINT category_aspects_cache_pkey;
    ALTER TABLE public.category_aspects_cache
      ADD CONSTRAINT category_aspects_cache_pkey
      PRIMARY KEY (category_id, marketplace_id, category_tree_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- If composite PK already exists, ignore
  NULL;
END $$;

-- ================================================================
-- 5. SCORING & DECAY SUPPORT (deficiency #8)
-- ================================================================

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS effective_score NUMERIC(5,2) DEFAULT 0;

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS last_publish_success TIMESTAMPTZ;

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS publish_success_count INT DEFAULT 0;

ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS publish_failure_count INT DEFAULT 0;

-- Backfill effective_score from confidence + source weight
UPDATE public.category_mappings
  SET effective_score = CASE
    WHEN verification_source = 'user_verified' THEN LEAST(confidence + 10, 100)
    WHEN verification_source = 'ebay_api'      THEN LEAST(confidence + 5, 100)
    WHEN verification_source = 'gemini_ai'     THEN confidence
    WHEN verification_source = 'ai_auto'       THEN GREATEST(confidence - 10, 0)
    ELSE confidence
  END
  WHERE effective_score = 0 OR effective_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_category_mappings_effective_score
  ON public.category_mappings(effective_score DESC)
  WHERE status = 'approved';

COMMENT ON COLUMN public.category_mappings.effective_score IS
  'Computed score: source_weight + confidence + recency_bonus - ambiguity_penalty. Used for candidate ranking.';
COMMENT ON COLUMN public.category_mappings.last_publish_success IS
  'Last time a listing using this mapping was successfully published to eBay.';
COMMENT ON COLUMN public.category_mappings.publish_success_count IS
  'Number of successful publishes using this mapping. Used for score promotion.';
COMMENT ON COLUMN public.category_mappings.publish_failure_count IS
  'Number of failed publishes using this mapping. Used for score demotion.';

-- ================================================================
-- 6. DEDUP RPC for category-hygiene-cron (deficiency #9)
-- ================================================================
-- Returns the "loser" rows: for each (category_id, item_type_normalized)
-- group with >1 approved row, returns all rows except the one with the
-- highest effective_score. The cron job rejects these.

CREATE OR REPLACE FUNCTION public.find_duplicate_mappings()
RETURNS TABLE (
  id            UUID,
  category_id   TEXT,
  item_type_normalized TEXT,
  effective_score NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH ranked AS (
    SELECT
      cm.id,
      cm.ebay_category_id,
      cm.item_type_normalized,
      cm.effective_score,
      ROW_NUMBER() OVER (
        PARTITION BY cm.ebay_category_id, cm.item_type_normalized
        ORDER BY cm.effective_score DESC, cm.updated_at DESC
      ) AS rn
    FROM public.category_mappings cm
    WHERE cm.status IN ('approved', 'quarantine')
      AND cm.item_type_normalized IS NOT NULL
  )
  SELECT ranked.id, ranked.ebay_category_id, ranked.item_type_normalized, ranked.effective_score
  FROM ranked
  WHERE ranked.rn > 1;
$$;

COMMENT ON FUNCTION public.find_duplicate_mappings IS
  'Returns duplicate category_mappings rows (losers) for dedup by the hygiene cron job.';