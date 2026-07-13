# Phase 4 - RAG Knowledge Base Expansion & Quality Assurance

Branch: feature/phase4-rag-expansion-qa (off main @ 98c3a03, post PR #400 merge)

## Part A - RAG Knowledge Base Expansion
- [x] Design domain -> RAG category mapping (generalize beyond coins_bullion)
- [x] Add DOMAIN_RAG_CATEGORIES config mapping domains to knowledge_base category values
- [x] Generalize visual-agent.ts RAG injection to use the mapping (not just coins_bullion)
- [x] Write new knowledge content for 5 domains: sneakers, electronics, jewelry, auto_parts, luxury_handbags
- [x] Extend scripts/seed-knowledge-base.cjs with the new domain content (new categories, additive, idempotent)
- [x] Verify deno check/lint/fmt clean on touched files (0 new errors vs. main baseline)

## Part B - Domain Tracking (prerequisite for QA feedback loop)
- [x] Add migration: domain column on drafts table (nullable TEXT)
- [x] Add migration: domain + time_to_sale_days columns on listing_financials table
- [x] Add domain field to ListingDraft interface (src/types/listing.ts)
- [x] Wire domain into useDrafts.ts addDraft()/updateDraft()/fetchDrafts()
- [x] Set domain on draft creation in AnalyzePage (from Pass-1 identification)
- [x] Update cogs-report/index.ts to resolve domain + published_at from drafts (by ebay_sku/ebay_listing_id) and persist domain + computed time_to_sale_days into listing_financials

## Part C - Quality-Assurance Feedback Loop (scoped realistically)
- [x] New SQL view: domain_quality_metrics aggregating listing_financials by domain (count sold, avg net profit, avg time_to_sale_days)
- [x] New edge function domain-quality-report exposing per-domain metrics + a "refinement candidate" flag (longest time-to-sale / lowest margin domain)
- [x] Add a "Domain Quality" section to AdminPage.tsx displaying the metrics
- [x] Explicitly document in roadmap that rejection-rate/edit-rate need new instrumentation not yet present (out of scope for this phase, flagged as future work)

## Part D - Wrap-up
- [x] Update COMPREHENSIVE_LISTING_TYPES_ROADMAP.md Phase 4 section: mark shipped, document what was built vs. deferred
- [x] Run full verification (deno check/lint/fmt, tsc, eslint, vitest - all clean, 24/24 tests passing)
- [x] Commit, push, open PR against main
