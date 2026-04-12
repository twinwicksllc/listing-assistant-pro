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

### 📦 Database
- [ ] Migration: add `cogs`, `cogs_source`, `cogs_acquired_at` to `drafts` table
- [ ] Migration: create `listing_cogs` table (id, user_id, org_id, ebay_sku, ebay_listing_id, title, cogs, source, acquired_at)
- [ ] Run `supabase db push` to apply migrations

### 🔷 Types & Hooks
- [ ] Add `cogs?`, `cogsSource?`, `cogsAcquiredAt?` to `ListingDraft` in `src/types/listing.ts`
- [ ] Update `src/hooks/useDrafts.ts` — map new columns in `fetchDrafts`, `addDraft`, `updateDraft`

### 🧩 Components
- [ ] Create `src/components/CogsInput.tsx` — reusable COGS entry widget with profit preview
- [ ] Create `src/components/ProfitBadge.tsx` — color-coded margin % badge (green/yellow/red)
- [ ] Create `src/components/ProfitReportCard.tsx` — summary card for P&L report page

### 📄 Page Updates
- [ ] `src/pages/AnalyzePage.tsx` — add optional COGS field below Consignor, show "Est. profit" preview
- [ ] `src/components/EditDraftModal.tsx` — add COGS section with real-time profit preview
- [ ] `src/pages/DashboardPage.tsx` — add `cogsTotal` to `FinancialWindow` interface
- [ ] `src/pages/DashboardPage.tsx` — update `netProfit` calc to subtract `cogsTotal`
- [ ] `src/pages/DashboardPage.tsx` — add COGS row + "True Margin %" to Sales & Profit card
- [ ] `src/pages/DashboardPage.tsx` — add "Est. Profit" column to listings table (color-coded)

### 🆕 New Files
- [ ] Create `src/pages/ProfitReportPage.tsx` — per-item P&L with weekly/monthly subtotals
- [ ] Create `supabase/functions/cogs-report/index.ts` — joins Fulfillment API orders + COGS table
- [ ] Register `/profit-report` route in `src/App.tsx` (ProtectedRoute, ownerOnly)
- [ ] Gate P&L report behind Pro/Shop plan in `useAuth`

### ✅ Testing & Deploy
- [ ] `npm run build` — verify zero TypeScript errors
- [ ] Test: enter COGS in AnalyzePage → save draft → confirm DB values
- [ ] Test: profit calculation on Dashboard with real order + COGS data
- [ ] Git: `git checkout -b feature/cogs-true-profit`
- [ ] Git: commit + push branch
- [ ] GitHub: open PR, review, merge to main
- [ ] Verify: GitHub Actions deploy completes successfully

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

### 📦 Database
- [ ] Migration: create `market_watches` table (id, user_id, org_id, query, category_id, label, prices, counts, sell_through_rate, last_checked_at)
- [ ] Migration: create `market_price_history` table (id, watch_id, sampled_at, avg/min/max price, counts)
- [ ] Run `supabase db push`

### ⚡ Edge Functions
- [ ] Create `supabase/functions/market-watch-refresh/index.ts`
  - [ ] Call eBay `findItemsAdvanced` — active listing count + price range
  - [ ] Call eBay `findCompletedItems` — sold count + avg sold price
  - [ ] Compute `sell_through_rate = sold / (sold + active) * 100`
  - [ ] Update `market_watches` row
  - [ ] Insert `market_price_history` row
  - [ ] Return full market snapshot
- [ ] Create `supabase/functions/market-watch-cron/index.ts`
  - [ ] Query watches not refreshed in 24h
  - [ ] Call `market-watch-refresh` for each (max 50/run)
  - [ ] Register cron in `supabase/config.toml`
- [ ] Create `supabase/functions/keyword-research/index.ts`
  - [ ] Accept `{ query, categoryId? }`
  - [ ] Call both eBay Finding APIs
  - [ ] 4-hour result cache in Supabase
  - [ ] Return `{ activeCount, soldCount, sellThroughRate, avgSoldPrice, priceRange, topSellers }`

### 🧩 Components
- [ ] Create `src/components/MarketWatchCard.tsx` — watch card with prices, trend arrow, refresh/delete buttons
- [ ] Create `src/components/PriceTrendChart.tsx` — Recharts `LineChart` (avg/min/max lines, responsive)
- [ ] Create `src/components/SellThroughMeter.tsx` — circular progress gauge (green/yellow/red)
- [ ] Create `src/components/CategoryHeatMap.tsx` — category grid tiles for Dashboard widget

### 📄 New Page
- [ ] Create `src/pages/MarketResearchPage.tsx`
  - [ ] Keyword search bar at top
  - [ ] `KeywordResearchResults` card (active/sold counts, sell-through %, avg price)
  - [ ] Saved watches list with `MarketWatchCard` per entry
  - [ ] `PriceTrendChart` section (shows on watch selection)
  - [ ] Competitor spotlight panel (top 3 active listings for query)
  - [ ] "Add to watches" / "Remove watch" toggle button
- [ ] Register `/market` route in `src/App.tsx` (ProtectedRoute, ownerOnly)

### 🧭 Navigation
- [ ] `src/components/BottomNav.tsx` — add "Market" tab, `TrendingUp` icon, show for Pro/Shop ownerOnly

### 📊 Dashboard Integration
- [ ] `src/pages/DashboardPage.tsx` — add `CategoryHeatMap` widget below listings table

### 🔒 Plan Gating
- [ ] Gate keyword research (save to watch) behind Pro+
- [ ] Gate price history chart + cron refresh behind Shop
- [ ] Gate > 5 saved watches behind Shop

### ✅ Testing & Deploy
- [ ] Test `market-watch-refresh` with real eBay token + "Morgan Dollar" query
- [ ] Test cron function processes correct watches
- [ ] Test `PriceTrendChart` renders with 0 history points (empty state)
- [ ] Test `SellThroughMeter` at 0%, 50%, 100%
- [ ] `npm run build` — verify zero TypeScript errors
- [ ] Git: `git checkout -b feature/market-research-tools`
- [ ] Git: commit + push branch
- [ ] GitHub: open PR, review, merge to main
- [ ] Verify: GitHub Actions deploy completes successfully

---

---

## ⚡ Feature #6 — Auto-Optimization
> **Branch:** `feature/auto-optimization` · **Complexity:** High · **Plans:** Pro (view+price) + Shop (full AI)

### 📦 Database
- [ ] Migration: create `relist_history` table (id, user_id, original/new listing_id, original/new price, reason, relisted_at)
- [ ] Migration: create `reprice_rules` table (id, user_id, rule_type, rule_value, floor_price, apply_to, is_active, last_run_at)
- [ ] Migration: create `optimization_suggestions` table (id, user_id, listing_id, suggestion_type, current_value, suggested_value, reason, priority, is_dismissed, is_applied)
- [ ] Run `supabase db push`

### ⚡ Edge Functions
- [ ] Create `supabase/functions/ebay-relist/index.ts`
  - [ ] Accept `{ userToken, listingId, newPrice?, reason }`
  - [ ] End current eBay listing via Inventory API
  - [ ] Create new offer + publish
  - [ ] Insert row in `relist_history`
  - [ ] Return `{ success, newListingId, newOfferId }`
- [ ] Create `supabase/functions/bulk-reprice/index.ts`
  - [ ] Accept `{ userToken, items: [{ sku, newPrice }] }`
  - [ ] Batch `updateOffer` calls (eBay Inventory API)
  - [ ] Return per-item `{ sku, success, error? }[]`
- [ ] Create `supabase/functions/title-optimizer/index.ts`
  - [ ] Accept `{ title, categoryId, competitorTitles }`
  - [ ] Call GPT-4o with keyword extraction prompt
  - [ ] Cache results by `sha256(title + categoryId)` for 24h
  - [ ] Return `{ optimizedTitle, keywordsAdded, keywordsRemoved, explanation }`
- [ ] Create `supabase/functions/image-scorer/index.ts`
  - [ ] Accept `{ imageUrl }`
  - [ ] Call GPT-4o Vision with scoring rubric
  - [ ] Return `{ overallScore: 1-5, breakdown: {...}, suggestions: string[] }`

### 🧩 Components
- [ ] Create `src/components/ActionQueueCard.tsx` — suggestion row with Apply/Dismiss/Preview buttons
- [ ] Create `src/components/TitleOptimizerModal.tsx` — side-by-side diff, Accept/Edit/Reject actions
- [ ] Create `src/components/ImageScoreCard.tsx` — star rating, dimension breakdown bars, suggestions
- [ ] Create `src/components/RepriceRuleBuilder.tsx` — rule type dropdown, %, floor price, scope selector

### 📄 New Page
- [ ] Create `src/pages/OptimizationPage.tsx`
  - [ ] Summary stats row (price suggestions, relist candidates, title fixes, image issues)
  - [ ] Priority-sorted suggestion table with `ActionQueueCard` rows
  - [ ] "Apply All Price Suggestions" + "Dismiss All Info" bulk action buttons
  - [ ] Reprice rules configuration section with `RepriceRuleBuilder`
  - [ ] Auto-relist settings (age threshold, price delta)
- [ ] Register `/optimize` route in `src/App.tsx` (ProtectedRoute, ownerOnly)

### 🧭 Navigation
- [ ] `src/components/BottomNav.tsx` — add "Optimize" tab, `Zap` icon, Shop only, ownerOnly

### 📊 Dashboard Integration
- [ ] `src/pages/DashboardPage.tsx` — add "⚡ Optimize" button on each listing row
  - [ ] On click: navigate to `/optimize?listing=<id>`

### 🔒 Plan Gating
- [ ] Gate suggestion view (read only) behind Pro+
- [ ] Gate apply reprice + relist behind Pro+
- [ ] Gate title optimizer + image scorer behind Shop only
- [ ] Gate auto-relist cron behind Shop only

### ✅ Testing & Deploy
- [ ] Test `ebay-relist` with a real ended/stale listing
- [ ] Test `title-optimizer` with "1921 Morgan Silver Dollar" + 3 competitor titles
- [ ] Test `image-scorer` with a real listing image URL
- [ ] Test `bulk-reprice` with 3 SKUs in dry-run mode
- [ ] Test suggestion queue populates correctly from health score data (Feature #4)
- [ ] `npm run build` — verify zero TypeScript errors
- [ ] Git: `git checkout -b feature/auto-optimization`
- [ ] Git: commit + push branch
- [ ] GitHub: open PR, review, merge to main
- [ ] Verify: GitHub Actions deploy completes successfully

---

---

## 📋 Feature #10 — Bulk Listing Generator
> **Branch:** `feature/bulk-listing-generator` · **Complexity:** High · **Plans:** All paid (limited) + Shop (full)

### 📦 Dependencies
- [ ] Add `papaparse` to `package.json` dependencies
- [ ] Add `@types/papaparse` to `package.json` devDependencies
- [ ] Run `npm install`

### 🔷 Types & Libraries
- [ ] Create `src/types/bulk-listing.ts` — `BulkRow`, `BulkRowStatus`, `BulkRowValidation`, `BulkValidationIssue`, `BulkTemplate` types
- [ ] Create `src/lib/bulkCsvParser.ts` — CSV parser (papaparse) + Excel parser (xlsx, already installed)
- [ ] Create `src/lib/bulkTemplates.ts` — 5 templates: coins, electronics, clothing, books, generic
- [ ] Create `src/lib/bulkValidation.ts` — per-row validation (title max 80, price > 0, valid condition, valid category pattern)

### ⚡ Edge Functions
- [ ] Create `supabase/functions/bulk-generate-descriptions/index.ts`
  - [ ] Accept `{ rows: [{ title, condition, itemSpecifics, imageUrl? }], tier }`
  - [ ] Rate-limit loop: 5 rows/second
  - [ ] Call GPT-4o per row (same prompt as `analyze-item`)
  - [ ] Return `{ rowIndex, description, error? }[]`
  - [ ] Enforce row cap: 25 rows for Pro, 1000 for Shop
- [ ] Create `supabase/functions/bulk-publish/index.ts`
  - [ ] Accept `{ userToken, rows: BulkRow[], dryRun?: boolean }`
  - [ ] Per-row: `createOrReplaceInventoryItem` → `createOffer` → `publishOffer`
  - [ ] Save successes to `drafts` table with `publish_status = "published"`
  - [ ] Return `{ published, failed, results: [{ rowIndex, success, listingId?, error? }] }`
  - [ ] Enforce row cap: 50 rows for Pro, 1000 for Shop

### 🧩 Components
- [ ] Create `src/components/BulkUploadZone.tsx`
  - [ ] Native file input styled as drag-drop zone
  - [ ] Accept `.csv` and `.xlsx`
  - [ ] Show file name, row count, detected columns after upload
- [ ] Create `src/components/BulkColumnMapper.tsx`
  - [ ] Show first 3 preview rows
  - [ ] Dropdown per CSV column → internal field name
  - [ ] Auto-detect matching headers
  - [ ] Required fields checklist with validation
- [ ] Create `src/components/BulkDataTable.tsx`
  - [ ] Virtualized `<table>` for 100+ rows
  - [ ] Inline cell editing (click to edit)
  - [ ] Tab / Enter / Arrow keyboard navigation
  - [ ] Red cell highlight for errors, yellow for warnings
  - [ ] Row actions: duplicate, delete, add row below
  - [ ] Batch fill: select multiple rows, fill same value
- [ ] Create `src/components/BulkTemplateCard.tsx` — icon, label, description, sample row count
- [ ] Create `src/components/BulkProgressBar.tsx`
  - [ ] Overall % progress bar
  - [ ] Per-row status indicators (⏳→🔄→✅/❌)
  - [ ] Pause / Resume controls
  - [ ] "View on eBay" link per published row

### 📄 New Page
- [ ] Create `src/pages/BulkListingPage.tsx` — 4-step wizard
  - [ ] **Step 1 — Upload:** CSV drag-drop zone + 5 template cards + "Download template" button
  - [ ] **Step 2 — Map Columns:** `BulkColumnMapper` + required fields checklist + "Next" CTA
  - [ ] **Step 3 — Review & Generate:**
    - [ ] `BulkDataTable` with all mapped rows
    - [ ] "Generate All Descriptions (AI)" button with per-row progress
    - [ ] Policies section (set fulfillment/payment/return for all rows)
    - [ ] Validation summary: "N errors, M warnings"
  - [ ] **Step 4 — Publish:**
    - [ ] Summary card: "N ready, M errors"
    - [ ] Error rows list with fix links
    - [ ] "Publish X Ready Listings" button
    - [ ] `BulkProgressBar` real-time tracker
    - [ ] Final summary + "Download Error Report" CSV button
- [ ] Register `/bulk` route in `src/App.tsx` (ProtectedRoute)

### 🧭 Navigation & Discovery
- [ ] `src/components/BottomNav.tsx` — add "Bulk" tab, `Layers` icon, show for isOwner or isLister
- [ ] `src/pages/HomePage.tsx` — add "Bulk List" quick action card alongside "Capture"

### 🔒 Plan Gating
- [ ] Gate AI description gen (> 25 rows) behind Shop plan
- [ ] Gate bulk publish (> 50 listings) behind Shop plan
- [ ] Show clear upgrade prompt for Free/Starter at row cap

### ✅ Testing & Deploy
- [ ] Test CSV parser: upload coins template, verify all columns detected
- [ ] Test Excel parser: upload .xlsx file, verify row mapping
- [ ] Test column mapper: upload file with non-standard headers, verify manual mapping works
- [ ] Test validation: intentional errors (empty title, $0 price, invalid condition)
- [ ] Test `bulk-generate-descriptions`: send 5-row batch, verify descriptions returned
- [ ] Test `bulk-publish` dry-run: 3 rows, verify no eBay listings created
- [ ] Test `bulk-publish` live: 3 real listings end-to-end
- [ ] Test progress tracker: real-time row status updates during publish
- [ ] Test error report download: verify failed rows exported correctly
- [ ] `npm run build` — verify zero TypeScript errors
- [ ] Git: `git checkout -b feature/bulk-listing-generator`
- [ ] Git: commit + push branch
- [ ] GitHub: open PR, review, merge to main
- [ ] Verify: GitHub Actions deploy completes successfully

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

| Feature | Tasks Total | Done | Remaining |
|---|---|---|---|
| #1 COGS True Profit | 22 | 0 | 22 |
| #4 Smart Insights | 24 | 0 | 24 |
| #5 Market Research | 28 | 0 | 28 |
| #6 Auto-Optimization | 30 | 0 | 30 |
| #10 Bulk Generator | 38 | 0 | 38 |
| Cross-Feature | 6 | 0 | 6 |
| **Total** | **148** | **0** | **148** |