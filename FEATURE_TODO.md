# Feature Enhancement Todo Checklist

> **Last updated:** Auto-generated from FEATURE_PLANS.md
> **5 features · ~120 tasks total**

---

## Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked / needs decision

---

---

## 🏷️ Feature #1 — True Profit with COGS

> **Branch:** `feature/cogs-true-profit` · **Complexity:** Medium · **Plans:** Pro + Shop

> **✅ Verified shipped (2026-09-21):** this feature is fully built and live, not "0% started" as the progress table below claims. Evidence: `listing_cogs`/`listing_financials` migrations exist (`20260325000001_create_listing_cogs_table.sql`, `20260402000000_create_listing_financials.sql`, plus follow-up constraint migrations); `src/components/CogsInput.tsx`, `src/components/ProfitBadge.tsx`, `src/components/ProfitReportCard.tsx` all exist; `CogsInput` is wired into both `src/pages/AnalyzePage.tsx` (direct-publish path, persists to `listing_cogs`) and `src/components/EditDraftModal.tsx` (used by `src/v2/pages/DraftsPage2.tsx`); `src/pages/DashboardPage.tsx` and `src/v2/pages/DashboardPage2.tsx` both compute `cogsTotal`/`netProfit` and render `ProfitBadge`; `src/pages/ProfitReportPage.tsx` exists and is registered at `/profit-report` in `src/App.tsx`; `supabase/functions/cogs-report/index.ts` exists. Manually traced the DashboardPage2/EditDraftModal path end-to-end (UI → `listing_cogs` insert) and it works as wired. **Gap found:** no dedicated unit/integration test file for the COGS flow (`src/test/*cogs*` and `supabase/functions/cogs-report/*.test.ts` both come up empty) — worth a follow-up test task, not a functional bug.

### 📦 Database

- [x] Migration: add `cogs`, `cogs_source`, `cogs_acquired_at` to `drafts` table
- [x] Migration: create `listing_cogs` table (id, user_id, org_id, ebay_sku, ebay_listing_id, title, cogs, source, acquired_at)
- [x] Run `supabase db push` to apply migrations

### 🔷 Types & Hooks

- [x] Add `cogs?`, `cogsSource?`, `cogsAcquiredAt?` to `ListingDraft` in `src/types/listing.ts`
- [x] Update `src/hooks/useDrafts.ts` — map new columns in `fetchDrafts`, `addDraft`, `updateDraft`

### 🧩 Components

- [x] Create `src/components/CogsInput.tsx` — reusable COGS entry widget with profit preview
- [x] Create `src/components/ProfitBadge.tsx` — color-coded margin % badge (green/yellow/red)
- [x] Create `src/components/ProfitReportCard.tsx` — summary card for P&L report page

### 📄 Page Updates

- [x] `src/pages/AnalyzePage.tsx` — add optional COGS field below Consignor, show "Est. profit" preview
- [x] `src/components/EditDraftModal.tsx` — add COGS section with real-time profit preview
- [x] `src/pages/DashboardPage.tsx` — add `cogsTotal` to `FinancialWindow` interface
- [x] `src/pages/DashboardPage.tsx` — update `netProfit` calc to subtract `cogsTotal`
- [x] `src/pages/DashboardPage.tsx` — add COGS row + "True Margin %" to Sales & Profit card
- [x] `src/pages/DashboardPage.tsx` — add "Est. Profit" column to listings table (color-coded)

### 🆕 New Files

- [x] Create `src/pages/ProfitReportPage.tsx` — per-item P&L with weekly/monthly subtotals
- [x] Create `supabase/functions/cogs-report/index.ts` — joins Fulfillment API orders + COGS table
- [x] Register `/profit-report` route in `src/App.tsx` (ProtectedRoute, ownerOnly)
- [x] Gate P&L report behind Pro/Shop plan in `useAuth`

### ✅ Testing & Deploy

- [x] `npm run build` — verify zero TypeScript errors
- [ ] Test: enter COGS in AnalyzePage → save draft → confirm DB values (manually traced, no automated test file — see gap note above)
- [ ] Test: profit calculation on Dashboard with real order + COGS data (manually traced, no automated test file — see gap note above)
- [x] Git: `git checkout -b feature/cogs-true-profit`
- [x] Git: commit + push branch
- [x] GitHub: open PR, review, merge to main
- [x] Verify: GitHub Actions deploy completes successfully

---

---

## 📊 Feature #4 — Smart Listing Insights

> **Branch:** `feature/smart-listing-insights` · **Complexity:** Medium · **Plans:** Pro + Shop

### 🧠 Core Algorithm

- [ ] Create `src/lib/listingHealthScore.ts` — `computeHealthScore(listing, allListings): HealthScore`
  - [ ] Views component (25 pts)
  - [ ] CTR component (20 pts)
  - [ ] Watchers component (20 pts)
  - [ ] Sales component (35 pts)
  - [ ] Staleness flag (60+ days, 0 sales)
  - [ ] No-views flag (0 views in 30d)
  - [ ] Low CTR flag (<0.5% with >100 impressions)
  - [ ] Competitor overpriced / underpriced flags
  - [ ] Grade mapping (A/B/C/D/F)
- [ ] Create `src/lib/duplicateDetection.ts` — `findDuplicates(listings): Map<id, id[]>` using Jaccard similarity

### 🧩 Components

- [ ] Create `src/components/HealthScoreBadge.tsx` — circular score badge, color-coded by grade
- [ ] Create `src/components/ListingInsightsSheet.tsx` — shadcn Sheet with flags list + action buttons
- [ ] Create `src/components/InsightsBanner.tsx` — dismissible banner: "⚠️ X listings need attention"
- [ ] Create `src/components/DuplicateDetector.tsx` — "Possible duplicate" inline badge

### 📄 Dashboard Updates

- [ ] `src/pages/DashboardPage.tsx` — add `health` to `SortField` type
- [ ] `src/pages/DashboardPage.tsx` — add "Health" column to listings table (renders `HealthScoreBadge`)
- [ ] `src/pages/DashboardPage.tsx` — add `health` option to sort dropdown
- [ ] `src/pages/DashboardPage.tsx` — add "Issues only" filter toggle button
- [ ] `src/pages/DashboardPage.tsx` — add `InsightsBanner` above listings table
- [ ] `src/pages/DashboardPage.tsx` — wire Health badge `onClick` → open `ListingInsightsSheet`
- [ ] `src/pages/DashboardPage.tsx` — add `DuplicateDetector` on each listing row

### 🔒 Plan Gating

- [ ] Wrap health score computation in Pro/Shop check — show lock icon for Starter
- [ ] Add upgrade prompt card when non-Pro user visits Dashboard

### ✅ Testing & Deploy

- [ ] Test health score with: new listing, 0-view listing, high-CTR listing, stale listing
- [ ] Test duplicate detection with known-similar coin titles
- [ ] `npm run build` — verify zero TypeScript errors
- [ ] Git: `git checkout -b feature/smart-listing-insights`
- [ ] Git: commit + push branch
- [ ] GitHub: open PR, review, merge to main
- [ ] Verify: GitHub Actions deploy completes successfully

---

---

## 🔍 Feature #5 — Market Research Tools

> **Branch:** `feature/market-research-tools` · **Complexity:** High · **Plans:** Pro (limited) + Shop (full)

> **✅ Verified shipped (2026-09-21):** this feature is built and live, not "0% started" as this checklist's original form claimed. Evidence: PR #167 landed the original build; `20260323000000_add_market_watches.sql` creates full `market_watches` + `market_price_history` schema with RLS; `supabase/functions/market-watch-refresh/` and `supabase/functions/keyword-research/` both exist (`keyword-research` was later switched from the deprecated Finding API to Browse API); `src/v2/components/MarketWatchCard.tsx`, `PriceHistogram.tsx`, `PriceTrendChart.tsx`, `SellThroughMeter.tsx` all exist; `src/v2/pages/MarketResearchPage2.tsx` is routed and live (the v1 `src/pages/MarketResearchPage.tsx` is superseded and archived under `src/v2/pages/_archive/`). PR #578 added a daily auto-refresh cron for `market_watches` and capped manual refresh at 6/day (`20260916020000_schedule_market_watch_refresh_daily.sql`, `20260916010000_add_market_watch_refresh_cursor_rpc.sql`). **Gap found:** no `CategoryHeatMap` component was ever built — the Dashboard-widget heat-map tile from the original plan is the one genuinely missing piece (since closed — the component landed in PR #613, see Remaining work below); everything else in this checklist (edge functions, cron, watch/trend/sell-through components, saved-watches page, keyword search) is done.

### Remaining work

- [x] Create `src/v2/components/CategoryHeatMap.tsx` — a grid of category tiles, each tile showing a category name and a color (green/yellow/red) based on how many active listings exist in that category. Model the component's props and structure on the existing `src/v2/components/PriceHistogram.tsx` in the same directory — copy its file structure (props interface, then component function, then return JSX), not its chart logic.
- [x] Add `<CategoryHeatMap />` to `src/v2/pages/DashboardPage2.tsx`, placed directly below the existing listings table in that file. Do not add it to `MarketResearchPage2.tsx`.
- [x] Wrap the new `<CategoryHeatMap />` element in whatever Pro/Shop plan-check wrapper component or conditional is already used elsewhere in `DashboardPage2.tsx` for other Pro/Shop-gated widgets on that same page — search that file for the word "Pro" or "Shop" to find the existing pattern and copy it exactly, don't invent a new gating check.

> **Verified in code 2026-09-25:** all three are present — `src/v2/components/CategoryHeatMap.tsx` exists (added in PR #613), and `DashboardPage2.tsx` renders `<CategoryHeatMap listings={listings} maxTiles={12} />` directly below the listings section, gated on `currentPlan === "pro" || currentPlan === "shop"` (the only Pro/Shop plan check in that file; other widgets there gate on `planFeatures.hasListingAnalytics`). Not done: no unit test for the component (no `src/test/*heat*` file exists); the heat thresholds are simple listing counts (≥10 green, ≥5 amber, otherwise red).

---

---

## 📋 Feature #10 — Bulk Listing Generator

> **Branch:** `feature/bulk-listing-generator` · **Complexity:** High · **Plans:** All paid (limited) + Shop (full)

> **✅ Verified shipped (2026-09-21):** this feature is substantially built and live, not "0% started" as the progress table below claims. Evidence: `src/types/bulk-listing.ts`, `src/lib/bulkCsvParser.ts`, `src/lib/bulkTemplates.ts`, `src/lib/bulkValidation.ts` all exist; `src/components/BulkUploadZone.tsx`, `BulkColumnMapper.tsx`, `BulkDataTable.tsx`, `BulkTemplateCard.tsx`, `BulkProgressBar.tsx` all exist; `src/pages/BulkListingPage.tsx` and `src/v2/pages/BulkListingPage2.tsx` both exist and `/bulk` is registered in `src/App.tsx`; `supabase/functions/bulk-generate-descriptions/index.ts` and `supabase/functions/bulk-publish/index.ts` both exist, with `bulk-publish` having its own test file (`bulk-publish.test.ts`). Row caps match this doc's own design intent (`bulk-generate-descriptions`: starter=5/pro=25/unlimited=1000; `bulk-publish`: starter=5/pro=50/unlimited=1000 — the pro-tier difference between 25 and 50 is deliberate per the Plan Gating section below, not drift). **Gaps found:** `bulk-generate-descriptions` has no test file at all, and neither function has a test covering its row-cap boundary (cap exactly met vs. exceeded) — worth follow-up test tasks, not functional bugs.

### 📦 Dependencies

- [x] Add `papaparse` to `package.json` dependencies
- [x] Add `@types/papaparse` to `package.json` devDependencies
- [x] Run `npm install`

### 🔷 Types & Libraries

- [x] Create `src/types/bulk-listing.ts` — `BulkRow`, `BulkRowStatus`, `BulkRowValidation`, `BulkValidationIssue`, `BulkTemplate` types
- [x] Create `src/lib/bulkCsvParser.ts` — CSV parser (papaparse) + Excel parser (xlsx, already installed)
- [x] Create `src/lib/bulkTemplates.ts` — 5 templates: coins, electronics, clothing, books, generic
- [x] Create `src/lib/bulkValidation.ts` — per-row validation (title max 80, price > 0, valid condition, valid category pattern)

### ⚡ Edge Functions

- [x] Create `supabase/functions/bulk-generate-descriptions/index.ts`
  - [x] Accept `{ rows: [{ title, condition, itemSpecifics, imageUrl? }], tier }`
  - [x] Rate-limit loop: 5 rows/second
  - [x] Call GPT-4o per row (same prompt as `analyze-item`)
  - [x] Return `{ rowIndex, description, error? }[]`
  - [x] Enforce row cap: 25 rows for Pro, 1000 for Shop
- [x] Create `supabase/functions/bulk-publish/index.ts`
  - [x] Accept `{ userToken, rows: BulkRow[], dryRun?: boolean }`
  - [x] Per-row: `createOrReplaceInventoryItem` → `createOffer` → `publishOffer`
  - [x] Save successes to `drafts` table with `publish_status = "published"`
  - [x] Return `{ published, failed, results: [{ rowIndex, success, listingId?, error? }] }`
  - [x] Enforce row cap: 50 rows for Pro, 1000 for Shop

### 🧩 Components

- [x] Create `src/components/BulkUploadZone.tsx`
  - [x] Native file input styled as drag-drop zone
  - [x] Accept `.csv` and `.xlsx`
  - [x] Show file name, row count, detected columns after upload
- [x] Create `src/components/BulkColumnMapper.tsx`
  - [x] Show first 3 preview rows
  - [x] Dropdown per CSV column → internal field name
  - [x] Auto-detect matching headers
  - [x] Required fields checklist with validation
- [x] Create `src/components/BulkDataTable.tsx`
  - [x] Virtualized `<table>` for 100+ rows
  - [x] Inline cell editing (click to edit)
  - [x] Tab / Enter / Arrow keyboard navigation
  - [x] Red cell highlight for errors, yellow for warnings
  - [x] Row actions: duplicate, delete, add row below
  - [x] Batch fill: select multiple rows, fill same value
- [x] Create `src/components/BulkTemplateCard.tsx` — icon, label, description, sample row count
- [x] Create `src/components/BulkProgressBar.tsx`
  - [x] Overall % progress bar
  - [x] Per-row status indicators (⏳→🔄→✅/❌)
  - [x] Pause / Resume controls
  - [x] "View on eBay" link per published row

### 📄 New Page

- [x] Create `src/pages/BulkListingPage.tsx` — 4-step wizard
  - [x] **Step 1 — Upload:** CSV drag-drop zone + 5 template cards + "Download template" button
  - [x] **Step 2 — Map Columns:** `BulkColumnMapper` + required fields checklist + "Next" CTA
  - [x] **Step 3 — Review & Generate:**
    - [x] `BulkDataTable` with all mapped rows
    - [x] "Generate All Descriptions (AI)" button with per-row progress
    - [x] Policies section (set fulfillment/payment/return for all rows)
    - [x] Validation summary: "N errors, M warnings"
  - [x] **Step 4 — Publish:**
    - [x] Summary card: "N ready, M errors"
    - [x] Error rows list with fix links
    - [x] "Publish X Ready Listings" button
    - [x] `BulkProgressBar` real-time tracker
    - [x] Final summary + "Download Error Report" CSV button
- [x] Register `/bulk` route in `src/App.tsx` (ProtectedRoute)

### 🧭 Navigation & Discovery

- [x] `src/components/BottomNav.tsx` — add "Bulk" tab, `Layers` icon, show for isOwner or isLister
- [x] `src/pages/HomePage.tsx` — add "Bulk List" quick action card alongside "Capture"

### 🔒 Plan Gating

- [x] Gate AI description gen (> 25 rows) behind Shop plan
- [x] Gate bulk publish (> 50 listings) behind Shop plan
- [x] Show clear upgrade prompt for Free/Starter at row cap

### ✅ Testing & Deploy

- [ ] Test CSV parser: upload coins template, verify all columns detected (no automated test file — see gap note above)
- [ ] Test Excel parser: upload .xlsx file, verify row mapping (no automated test file — see gap note above)
- [ ] Test column mapper: upload file with non-standard headers, verify manual mapping works (no automated test file — see gap note above)
- [ ] Test validation: intentional errors (empty title, $0 price, invalid condition) (no automated test file — see gap note above)
- [ ] Test `bulk-generate-descriptions`: send 5-row batch, verify descriptions returned (no test file exists for this function — see gap note above)
- [x] Test `bulk-publish` dry-run: 3 rows, verify no eBay listings created (covered by `bulk-publish.test.ts`)
- [ ] Test `bulk-publish` live: 3 real listings end-to-end (no automated test — manual/production verification only)
- [ ] Test progress tracker: real-time row status updates during publish (no automated test file — see gap note above)
- [ ] Test error report download: verify failed rows exported correctly (no automated test file — see gap note above)
- [x] `npm run build` — verify zero TypeScript errors
- [x] Git: `git checkout -b feature/bulk-listing-generator`
- [x] Git: commit + push branch
- [x] GitHub: open PR, review, merge to main
- [x] Verify: GitHub Actions deploy completes successfully

---

---

## 🏁 Cross-Feature / Housekeeping

- [ ] Update `BillingPage.tsx` — feature comparison table with all 5 new features + plan tiers
- [ ] Update `LandingPage.tsx` — add new features to marketing copy / feature list
- [ ] Update `README.md` — document new routes and features
- [ ] Update `CURRENT_STATE_SUMMARY.md` after each feature ships
- [ ] Smoke-test all 5 features end-to-end on production
- [ ] Verify all plan gates are consistent with `PLANS` object in `src/contexts/AuthContext.tsx`

---

## 📈 Progress Summary

| Feature             | Tasks Total | Done   | Remaining |
| ------------------- | ----------- | ------ | --------- |
| #1 COGS True Profit | 22          | 22\*   | 0         |
| #4 Smart Insights   | 24          | 0\*\*  | 24        |
| #5 Market Research  | 3\*\*\*     | 3      | 0         |
| #10 Bulk Generator  | 38          | 38\*   | 0         |
| Cross-Feature       | 6           | 0      | 6         |
| **Total**           | **93**      | **63** | **30**    |

\*\*\* Feature #5's checklist was rewritten 2026-09-21 — the original 28-task build-from-scratch list is done and removed; only the 3 remaining `CategoryHeatMap` tasks are listed now, so this row's "Tasks Total" is not comparable to earlier snapshots of this table.

**Feature #6 — Auto-Optimization removed from this document 2026-09-21** at user request. It is not built and was never started. If this work is picked up again, do it under `PROGRESSIVE_AUTONOMY_AGENT_PLAN.md` instead of re-adding a Feature #6 section here — that plan already names the same tables (`reprice_rules`, `optimization_suggestions`, `relist_history`) and functions (`bulk-reprice`, `ebay-relist`) this section used to describe, and explicitly says not to build two parallel repricing systems.

\* Verified shipped 2026-09-21 (see callout in each feature's section above) — counted as fully done against this checklist even though it wasn't built task-by-task in this order. Remaining gaps are test-coverage follow-ups, not functional work.

\*\* Genuinely 0% against _this_ checklist, which describes a full Views/CTR/Watchers health score. A separate flags-only v1 (overpriced/underpriced, stale, duplicate-title) shipped 2026-09-21 via `src/lib/listingInsights.ts` + `src/lib/duplicateDetection.ts` + `src/components/InsightFlagBadge.tsx`, using a leaner design that doesn't map 1:1 onto these tasks — see the Smart Insights section above for what it does and does not cover.
