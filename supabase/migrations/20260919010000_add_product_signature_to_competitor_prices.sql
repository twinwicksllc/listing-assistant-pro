-- Adds a column so a fresh comp lookup for one listing can be reused by a
-- DIFFERENT listing of the same underlying product for the same seller (see
-- computeProductSignature/attemptSignatureMatch in
-- supabase/functions/_helpers/competitorSearch.ts). This cuts eBay Browse
-- API + Gemini calls when a seller has multiple listings of the same coin/
-- collectible, without changing behavior for listings that don't match.
--
-- Additive, nullable, no backfill -- same shape as the comp_item_ids column
-- (20260918020000_add_comp_item_ids_to_competitor_prices.sql): existing rows
-- simply don't participate in signature matching until their next refresh
-- writes one.

ALTER TABLE public.competitor_prices
  ADD COLUMN IF NOT EXISTS product_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_user_signature
  ON public.competitor_prices (user_id, product_signature)
  WHERE product_signature IS NOT NULL;

COMMENT ON COLUMN public.competitor_prices.product_signature IS
  'Normalized, order-insensitive, category-scoped signature derived from the
   listing title (see computeProductSignature in competitorSearch.ts) --
   used to find an existing fresh comp lookup for a DIFFERENT listing of the
   same underlying product owned by the same seller. NULL whenever the title
   yields fewer than 4 significant tokens after stopword/listing-boilerplate
   removal -- deliberately conservative: production data (2026-09-18 audit)
   showed short/garbled titles ("202", "Year") producing spurious repeats via
   the search_query heuristic fallback, which must never be mistaken for
   real product matches. Exact string match only, not fuzzy/trigram --
   rejected token-overlap fuzzy matching (as used by category-lookup''s
   db_fuzzy source) because two DIFFERENT products with overlapping generic
   tokens could otherwise silently share price comps. Grading-service names,
   grade numbers, and single-character mint marks are deliberately NOT
   stripped from this signature (unlike this file''s query-broadening
   stopWords/gradeNoise sets) -- they are load-bearing identity signal for
   this app''s coin/collectible vertical (e.g. "1909 S VDB" vs "1909 VDB" is
   a key-date vs common-date distinction that must never collapse).';
