# Rebrand Phase 0 Database Baseline

**Product:** ListrAssistr
**Source project:** `wcednzaxmxwfiijzmjmx` (RankedCEO-CRM — shared with an unrelated CRM product)
**Captured:** 2026-08-14
**Gate:** P0-10 (database and Auth baseline); inputs to P0-11, P0-12, and P0-13
**Status:** In progress — row counts captured; `auth.users` count and storage baseline still open

## Method and limitations

Row counts were read from `pg_stat_user_tables.n_live_tup` via the Supabase
Dashboard SQL Editor, because this machine cannot open TCP connections to the
project's Postgres ports (see the session handoff for the network finding).

`n_live_tup` is a **planner estimate** maintained by autovacuum/analyze, not a
guaranteed count. Every table this baseline reports as empty was therefore
re-verified with an exact `count(*)`. Non-zero counts below should be treated as
close approximations and re-confirmed at export time, which the restore
rehearsal does anyway by comparing source and target counts per table.

This file records **counts and aggregates only**. No row-level data, user
identifiers, display names, postal codes, tokens, or customer records appear
here or in any other Phase 0 artifact, per DEC-0007.

CRM-owned tables in the same schema were also returned by the baseline query but
are deliberately not inventoried here — they are out of scope for this product's
migration and are classified in
[REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md](REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md).

## The 26 listing-app tables

Grouped by migration disposition rather than alphabetically, because the grouping
is the actionable part.

### Business data — migrate (12 tables, ~1,169 rows)

| Table                | Rows | Note                                     |
| -------------------- | ---: | ---------------------------------------- |
| listing_cogs         |  814 | Cost-of-goods per listing                |
| competitor_prices    |  257 | Could arguably be treated as regenerable |
| test_items           |   54 | QA fixture data; candidate for exclusion |
| profiles             |    9 | Token columns excluded from export       |
| organizations        |    9 |                                          |
| org_members          |    9 |                                          |
| knowledge_base       |    6 | RAG grounding; pgvector embeddings       |
| drafts               |    6 | Core listing records                     |
| optimization_history |    2 |                                          |
| org_invitations      |    1 |                                          |
| subscriptions        |    1 | Only one active subscription record      |
| support_tickets      |    1 |                                          |

### Regenerable cache — do not migrate (4 tables, 22,097 rows)

| Table                  |   Rows | Rebuilt by                     |
| ---------------------- | -----: | ------------------------------ |
| ebay_taxonomy_cache    | 15,116 | eBay Taxonomy API on first use |
| lookup_decisions       |  6,961 | Category resolution pipeline   |
| category_aspects_cache |     19 | Aspects fetch (7-day TTL)      |
| spot_price_cache       |      1 | `spot-prices` function         |

### Usage telemetry — migrate only if history is required (2 tables, 9,376 rows)

| Table          |  Rows | Note                                          |
| -------------- | ----: | --------------------------------------------- |
| usage_tracking | 6,667 | Quota enforcement may need recent rows only   |
| gemini_usage   | 2,709 | Cost telemetry; historical value is reporting |

### Taxonomy support — decide per table (2 tables, 45 rows)

| Table                | Rows | Note                               |
| -------------------- | ---: | ---------------------------------- |
| category_mappings    |   41 | Partly curated, not purely derived |
| category_hygiene_log |    4 | Audit trail from the hygiene cron  |

### Empty — nothing to migrate (6 tables, 0 rows)

All six confirmed by exact `count(*)` on 2026-08-14, run as `postgres` so RLS is
not a factor:

`ebay_tokens`, `market_watches`, `market_price_history`, `reprice_rules`,
`listing_financials`, `cost_alerts`

Notable: **`ebay_tokens` is dead schema, not an inactive feature.** eBay OAuth
tokens are stored on `public.profiles` instead. See RBR-0019 and RBR-0020.

Also notable: `market_price_history` is empty, which means the RLS gap fixed in
PR #464 was never actually exploited — no fabricated rows were inserted.

## Totals

| Measure                                |  Value |
| -------------------------------------- | -----: |
| Listing-app tables                     |     26 |
| Non-empty                              |     20 |
| Empty (verified)                       |      6 |
| Total rows across all 26               | 32,687 |
| Rows that are real business data       |  1,169 |
| Rows that are regenerable or telemetry | 31,518 |

**96% of rows are cache or telemetry.** The migration cohort is small: roughly
1,169 rows across 12 tables. This materially lowers the risk profile of cutover
and shrinks the manual dashboard export loop that the network constraint forces.

## eBay connection state

Aggregate only, captured 2026-08-14:

| Measure                        | Value |
| ------------------------------ | ----: |
| Profiles                       |     9 |
| Holding an eBay refresh token  |     2 |
| Holding an eBay access token   |     2 |
| With an unexpired access token |     0 |

Zero unexpired access tokens is expected, not a defect: eBay access tokens are
short-lived and `ebay-publish/auth.ts` refreshes on demand from the stored
refresh token.

**Decision input:** only 2 users would need to reconnect eBay after cutover. The
owner has confirmed that is an acceptable ask, so token columns are deliberately
excluded from both export and migration (RBR-0020). One profile has
`ebay_username` and `ebay_account_type` populated with no token present, so
`ebay_username` is not a reliable indicator of an active connection.

## Still open for P0-10

1. `auth.users` count — `profiles` has 9 rows and is expected to mirror it, but
   this has not been confirmed, and orphaned auth users would not appear above.
2. Storage baseline (bucket object counts and bytes) — tracked under P0-08.
3. Exact `count(*)` re-confirmation of the 20 non-empty tables at export time,
   which the P0-12 rehearsal produces as a side effect.

## Consequences for other gates

- **P0-11 / P0-12:** the rehearsal export set drops from 20 tables to 13 — the 12
  business tables plus `ebay_taxonomy_cache` retained deliberately as a
  volume/encoding stress test, since nothing else here is large enough to
  surface CSV import limits.
- **P0-13:** the cohort is much smaller than the 9 profiles suggest. Several are
  QA or test accounts and `test_items` is fixture data, so an explicit
  test-account exclusion rule is required before the cohort query is approved.
- **P0-08:** one profile references an avatar in the `avatars` storage bucket, so
  storage linkage is confirmed non-empty and cannot be skipped.
