-- Phase 0 migration cohort selection query (P0-13)
--
-- Implements DEC-0029 (REBRAND_PHASE_0_DECISION_LOG.md): exactly one of the
-- owner's own duplicate profile rows transfers, exactly one of the QA/test
-- profile rows transfers, and every other profile -- real product users --
-- transfers. This is a SELECTION query only (row counts, for sanity-checking
-- against the ~1,169-row / 12-table baseline in REBRAND_PHASE_0_BASELINE.md)
-- -- it does not itself export or mutate any data.
--
-- IMPORTANT -- fill in locally, never commit real IDs:
-- The excluded_duplicate_profiles placeholder below must be filled in with
-- the actual profile IDs to EXCLUDE (the duplicates NOT chosen to transfer)
-- before running this against production. Per this project's secret/
-- customer-data handling convention (see CLAUDE.md, RBR-0020), those specific
-- identifiers were confirmed directly between the owner and a prior session
-- and are deliberately not written into any repo file. Fill them in in your
-- own local copy only; keep this committed version as placeholders.
--
-- Scope notes:
-- - profiles: token columns (ebay_access_token, ebay_refresh_token,
--   stripe_customer_id) must be excluded from any actual EXPORT using an
--   explicit column list -- RBR-0020. This query only counts rows, so it
--   doesn't touch those columns, but the real export step must.
-- - test_items: NOT cohort-filtered. It's global QA fixture data (default
--   user_id is a fixed sentinel UUID, not a real profile), not per-user
--   business data -- migrate wholesale or exclude entirely, a separate
--   decision from the cohort itself.
-- - knowledge_base: NOT cohort-filtered. Global RAG content (grading
--   standards, market appraisals) with no user_id/org_id column at all --
--   migrate wholesale if desired.
-- - optimization_history: has no tracked migration in this repo (created
--   manually, outside migration history -- confirmed via a no-op placeholder
--   in 20260324000001_add_optimization_tables.sql). Columns confirmed
--   2026-08-19 (id, user_id, listing_id, listing_title, optimization_type,
--   old_value, new_value, reasoning, applied_at, applied_by, result,
--   created_at) -- cohort-filtered below via user_id like every other
--   per-user table.
-- - reprice_rules: confirmed empty (0 rows) in the P0-10 baseline -- nothing
--   to select, omitted from this query.

WITH excluded_duplicate_profiles AS (
  -- Fill in locally with the actual profile IDs to exclude (owner's
  -- duplicate(s) not selected, QA/test duplicate(s) not selected). Leave
  -- empty (as committed) to see the full un-narrowed profile count instead.
  SELECT unnest(ARRAY[]::uuid[]) AS id
  -- Example once filled in:
  -- SELECT unnest(ARRAY[
  --   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,  -- owner's duplicate to exclude
  --   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid   -- QA/test duplicate to exclude
  -- ]) AS id
),
cohort_profiles AS (
  SELECT p.id AS user_id
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1
    FROM excluded_duplicate_profiles e
    WHERE e.id = p.id
  )
),
cohort_orgs AS (
  SELECT o.id AS org_id
  FROM public.organizations o
  WHERE o.owner_id IN (SELECT user_id FROM cohort_profiles)
)
SELECT 'profiles' AS table_name, count(*) AS cohort_rows
  FROM public.profiles p
  WHERE p.id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'organizations', count(*)
  FROM public.organizations o
  WHERE o.id IN (SELECT org_id FROM cohort_orgs)
UNION ALL
SELECT 'org_members', count(*)
  FROM public.org_members m
  WHERE m.user_id IN (SELECT user_id FROM cohort_profiles)
  AND m.org_id IN (SELECT org_id FROM cohort_orgs)
UNION ALL
SELECT 'org_invitations', count(*)
  FROM public.org_invitations i
  WHERE i.org_id IN (SELECT org_id FROM cohort_orgs)
UNION ALL
SELECT 'drafts', count(*)
  FROM public.drafts d
  WHERE d.user_id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'listing_cogs', count(*)
  FROM public.listing_cogs lc
  WHERE lc.user_id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'competitor_prices', count(*)
  FROM public.competitor_prices cp
  WHERE cp.user_id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'subscriptions', count(*)
  FROM public.subscriptions s
  WHERE s.user_id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'support_tickets', count(*)
  FROM public.support_tickets st
  WHERE st.user_id IN (SELECT user_id FROM cohort_profiles)
UNION ALL
SELECT 'test_items (NOT cohort-filtered -- global QA fixture, see note above)', count(*)
  FROM public.test_items
UNION ALL
SELECT 'knowledge_base (NOT cohort-filtered -- global RAG content, see note above)', count(*)
  FROM public.knowledge_base
UNION ALL
SELECT 'optimization_history', count(*)
  FROM public.optimization_history oh
  WHERE oh.user_id IN (SELECT user_id FROM cohort_profiles)
;
