-- Migration: taxonomy-grounded category embeddings (Phase 2.2b, misclassification plan)
--
-- category-lookup's tier-4 fallback (askGeminiForCategory) asks Gemini to
-- invent an eBay category ID from training data -- exactly the "stale-ID
-- disease" CLAUDE.md documents at length elsewhere (a model confidently
-- returning an ID eBay retired, or that now silently belongs to a
-- different domain -- "40150" resolving to Action Figures rather than
-- Roosevelt Dime is the canonical example). This migration adds the
-- storage needed to replace that guess-from-memory fallback with a
-- retrieve-then-rank one: embed each live leaf category once, then at
-- request time retrieve a real shortlist via vector similarity for an LLM
-- to pick from -- so the LLM can never suggest an ID that isn't a real,
-- currently-live leaf, because it was never shown one that wasn't.
--
-- embedding: same 768-dim model/shape as knowledge_base's column
-- (20260622000000) -- reuses _helpers/rag/embedding.ts's getEmbedding
-- unchanged, no new embedding pipeline.
--
-- embedding_source_text: the exact `breadcrumb` string that was embedded
-- (breadcrumb's own last segment already IS category_name -- e.g.
-- "Coins & Paper Money > Coins: US > Half Dollars > Commemorative" for the
-- "Commemorative" leaf -- so embedding category_name separately would just
-- duplicate it), NOT a timestamp. sync-ebay-taxonomy stamps an
-- identical synced_at onto all ~15k rows every week (index.ts:266) and the
-- BEFORE UPDATE trigger bumps updated_at on every upserted row with no
-- IS DISTINCT FROM guard (20260421000000:47-57) -- so neither timestamp
-- can tell a backfill script which rows actually changed text since the
-- last embed. Comparing this column's stored value against the freshly
-- computed text is the only reliable "did this category's name/breadcrumb
-- actually change" signal, generalizing the metadata.embedding_model
-- watermark idea already used by backfill-knowledge-base-embeddings.
--
-- HNSW, not ivfflat: knowledge_base's ivfflat lists=100 was tuned for a
-- handful of rows (20260622000000's own comment: "simpler for initial
-- setup"). At ~15,116 rows, ivfflat's list count would need real tuning to
-- avoid a poor recall/speed tradeoff; HNSW needs no lists/probes tuning at
-- this scale and is the better default going forward.

ALTER TABLE public.ebay_taxonomy_cache
  ADD COLUMN IF NOT EXISTS embedding vector(768),
  ADD COLUMN IF NOT EXISTS embedding_source_text TEXT;

COMMENT ON COLUMN public.ebay_taxonomy_cache.embedding IS
  'Embedding of embedding_source_text (768-dim, same model as knowledge_base) -- populated by scripts/backfill-category-embeddings.mjs, not by sync-ebay-taxonomy itself. NULL until backfilled.';

COMMENT ON COLUMN public.ebay_taxonomy_cache.embedding_source_text IS
  'The exact text that was embedded: "[<model>] <breadcrumb>" (breadcrumb''s own last segment already is category_name, so no separate concatenation is needed; the model name is prefixed so a model swap -- GEMINI_EMBEDDING_MODEL is env-overridable -- forces a full re-embed rather than silently skipping unchanged breadcrumbs under a stale, incomparable vector). Compared against the freshly computed value to detect which rows need re-embedding -- synced_at/updated_at are refreshed on every row every weekly sync regardless of whether the text changed, so they cannot be used for this.';

-- Partial index: only leaf rows with a computed embedding are ever
-- candidates for match_ebay_categories's WHERE clause below, so indexing
-- non-leaf/NULL rows would only cost write time for no read benefit.
CREATE INDEX IF NOT EXISTS idx_ebay_taxonomy_cache_embedding_hnsw
  ON public.ebay_taxonomy_cache
  USING hnsw (embedding vector_cosine_ops)
  WHERE is_leaf = TRUE AND embedding IS NOT NULL;

-- RPC for the vector_llm candidate source in category-lookup. Hardened
-- versus match_knowledge_base's template (20260622000000:61-90), which
-- lacks SET search_path, schema-qualification, and an explicit GRANT --
-- same SECURITY DEFINER + search_path + service_role-only grant shape as
-- get_watches_due_for_refresh (20260916010000) and this project's other
-- cursor RPCs.
--
-- search_path includes `extensions`, not just `public`: confirmed the
-- `vector` extension (and its <=> operator) lives in a DIFFERENT schema
-- per environment -- `public` on listrassistr-qa (created there by
-- 20260622000000's unqualified `CREATE EXTENSION vector`, which resolved
-- to whatever schema was first in that project's search_path at the time)
-- but `extensions` on this repo's actual linked production project
-- (wcednzaxmxwfiijzmjmx), pre-provisioned before this repo's migrations
-- ever ran. `SET search_path = public` alone applied cleanly on QA but
-- failed on production with "operator does not exist: extensions.vector
-- <=> extensions.vector" -- caught by actually running this migration
-- against both real projects (2026-09-17), not just review. Both schemas
-- are included so this RPC is portable across the drift rather than
-- coupled to one environment's extension placement.
--
-- Freshness gate (Copilot review, PR #587): sync-ebay-taxonomy never
-- deletes rows -- it only upserts categories still present in eBay's live
-- tree and logs (never persists) which IDs disappeared. A category eBay
-- retired last month, embedded before it was retired, would otherwise
-- stay a candidate forever with is_leaf=TRUE alone as the filter.
--
-- 30 days, not category-lookup's own 7-day CACHE_STALE_DAYS
-- (index.ts:26/:837): checking this against real production data
-- (2026-09-17) found sync-ebay-taxonomy-weekly has not completed
-- successfully since 2026-08-23 -- ~4 weeks stale, meaning a strict 7-day
-- window returns ZERO candidates from all 15,111 real leaf rows today.
-- 30 days keeps this a real, non-decorative gate (it still excludes
-- truly abandoned/ancient rows) without going fully unguarded while the
-- underlying cron-health issue is investigated separately. TODO: tighten
-- back to 7 days, matching category-lookup's own gates, once that sync
-- is confirmed running on schedule again.
CREATE OR REPLACE FUNCTION public.match_ebay_categories(
  query_embedding vector(768),
  match_count INTEGER,
  match_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  category_id TEXT,
  category_name TEXT,
  breadcrumb TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    etc.category_id,
    etc.category_name,
    etc.breadcrumb,
    1 - (etc.embedding <=> query_embedding) AS similarity
  FROM public.ebay_taxonomy_cache etc
  WHERE etc.is_leaf = TRUE
    AND etc.embedding IS NOT NULL
    AND etc.synced_at >= now() - interval '30 days'
    AND 1 - (etc.embedding <=> query_embedding) > match_threshold
  ORDER BY etc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Newly created functions are executable by PUBLIC by default in Postgres
-- unless explicitly revoked (Copilot review, PR #587) -- confirmed exploitable
-- on this project's real production database: anon/authenticated could call
-- this SECURITY DEFINER function and read ebay_taxonomy_cache rows bypassing
-- its service-role-only RLS policy, entirely regardless of the GRANT below.
-- (Also confirmed the same gap pre-exists on get_watches_due_for_refresh,
-- get_users_for_inventory_sync, and get_next_competitor_price_batch --
-- out of scope to fix here, flagged separately.)
--
-- REVOKE ALL ... FROM PUBLIC alone is NOT sufficient here -- confirmed by
-- actually checking pg_proc.proacl after applying: Supabase's own
-- project-level ALTER DEFAULT PRIVILEGES grants EXECUTE to anon,
-- authenticated, AND service_role individually (not via the PUBLIC
-- pseudo-role) on every function created in `public`, owned by
-- postgres/supabase_admin. Revoking FROM PUBLIC does nothing to those
-- already-explicit per-role grants; anon/authenticated must be revoked
-- by name.
REVOKE ALL ON FUNCTION public.match_ebay_categories(vector(768), INTEGER, FLOAT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ebay_categories(vector(768), INTEGER, FLOAT) TO service_role;

COMMENT ON FUNCTION public.match_ebay_categories IS
  'Vector similarity search over ebay_taxonomy_cache''s live leaf categories, for category-lookup''s vector_llm candidate source (Phase 2.2b). Returns up to match_count categories synced within the last 30 days (widened from category-lookup''s own 7-day Gate 1/2 window because sync-ebay-taxonomy-weekly was found ~4 weeks stale on 2026-09-17 -- see migration comment; tighten back to 7 days once that cron is confirmed healthy), above match_threshold cosine similarity -- callers still validate any LLM-picked ID is present in this result set before treating it as a candidate.';
