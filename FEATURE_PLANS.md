# Listing Assistant Pro — Feature Enhancement Plans

> **Repository:** `twinwicksllc/listing-assistant-pro` · **Branch:** `main`
> **Baseline commit:** `c2ffc0e` (Sales & Profit card)
> **Stack:** React 18 + TypeScript + Vite · Supabase Edge Functions (Deno) · Tailwind/shadcn · Recharts · eBay APIs

---

## Table of Contents

1. [Feature #1 — True Profit with COGS](#feature-1--true-profit-with-cogs)
2. [Feature #4 — Smart Listing Insights](#feature-4--smart-listing-insights)
3. [Feature #5 — Market Research Tools](#feature-5--market-research-tools)
4. [Feature #6 — Auto-Optimization](#feature-6--auto-optimization)
5. [Feature #10 — Bulk Listing Generator](#feature-10--bulk-listing-generator)
6. [Master Todo Checklist](#master-todo-checklist)

---

---

# Feature #1 — True Profit with COGS

## Overview

Allow sellers to record what they **paid** for each item (Cost of Goods Sold). Combine COGS with the existing Sales & Profit card data (revenue, eBay fees, shipping labels) to calculate **true net profit per item and in aggregate**. This is the single most requested feature by resellers — most think they are profitable until they subtract COGS.

## Goals

- Per-draft/listing: store acquisition cost, source, and date purchased
- Dashboard: show true profit = revenue − eBay fees − shipping labels − COGS
- Profit margin % with and without COGS for comparison
- Sortable "profit per item" column in the listings table
- Low-margin / loss alerts on the dashboard
- CSV export of COGS-augmented P&L report

## Technical Architecture

### Database Changes

**New column on `drafts` table:**

```sql
ALTER TABLE public.drafts
  ADD COLUMN cogs NUMERIC(10, 2) DEFAULT NULL,           -- acquisition cost
  ADD COLUMN cogs_source TEXT DEFAULT NULL,               -- e.g. "estate sale", "auction"
  ADD COLUMN cogs_acquired_at DATE DEFAULT NULL;          -- date purchased
```

**New column on `profiles` table (for dashboard COGS enrichment):**

```sql
-- Store COGS keyed by eBay SKU for published listings
-- This lets the dashboard match Fulfillment API orders to COGS data
CREATE TABLE public.listing_cogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ebay_sku TEXT,                  -- matches draft.ebay_sku after publish
  ebay_listing_id TEXT,           -- matches draft.ebay_listing_id
  title TEXT,                     -- human-readable reference
  cogs NUMERIC(10, 2) NOT NULL,
  cogs_source TEXT,
  cogs_acquired_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX listing_cogs_user_idx ON public.listing_cogs(user_id);
CREATE INDEX listing_cogs_sku_idx ON public.listing_cogs(ebay_sku);
```

### Frontend Changes

**1. `src/types/listing.ts`** — Add COGS fields to `ListingDraft`:

```typescript
cogs?: number;            // acquisition cost (what seller paid)
cogsSource?: string;      // e.g. "estate sale", "eBay purchase"
cogsAcquiredAt?: string;  // ISO date string
```

**2. `src/hooks/useDrafts.ts`** — Map new DB columns in fetch/add/update functions

**3. `src/components/EditDraftModal.tsx`** — Add COGS section:

- Number input for acquisition cost
- Text input for source (autocomplete from previous entries)
- Date picker for purchase date
- Real-time profit preview: `listingPrice - cogs = estimated profit`

**4. `src/pages/AnalyzePage.tsx`** — Add COGS entry in the save draft flow:

- Optional COGS input below Consignor field
- Shows "Est. true profit: $X.XX" preview after entry

**5. `src/pages/DashboardPage.tsx`** — Extend Sales & Profit card:

- New `fetchCogsData()` function queries `listing_cogs` table joined to order SKUs
- Add `cogsTotal: number` to `FinancialWindow` interface
- Update `netProfit` calculation: `revenue + shippingCollected - ebayFees - shippingLabels - cogsTotal`
- Add "COGS" row in the breakdown table with red negative styling
- Add "True Margin" % row showing margin after COGS
- Add "Without COGS" toggle to compare before/after COGS

**6. `src/pages/DashboardPage.tsx`** — Listings table column:

- Add "Est. Profit" column showing `listingPrice - cogs` for each row
- Color-coded: green (>20% margin), yellow (5-20%), red (<5% or loss)
- Sort by profit column

**7. New `src/pages/ProfitReportPage.tsx`** — Standalone P&L report:

- Table of all sold items with COGS, revenue, fees, true profit
- Subtotals by time period (weekly/monthly)
- Export to CSV / Excel button
- "Best performers" and "worst performers" summary cards

**8. New `supabase/functions/cogs-report/index.ts`** — Edge function:

- Joins Fulfillment API order data with `listing_cogs` table
- Returns per-item P&L and aggregate summaries
- Used by ProfitReportPage

### New Components

- `src/components/CogsInput.tsx` — Reusable COGS entry widget used in AnalyzePage and EditDraftModal
- `src/components/ProfitBadge.tsx` — Color-coded margin badge used in listings table
- `src/components/ProfitReportCard.tsx` — Summary card for ProfitReportPage

### Navigation

Add "P&L Report" link in Dashboard page header (owner-only). No new bottom nav tab needed — accessible via Dashboard.

### Plan Gating

- COGS entry field: **All plans** (free data entry)
- True profit on dashboard aggregate: **Pro + Shop**
- Per-item P&L report page + CSV export: **Pro + Shop**

---

---

# Feature #4 — Smart Listing Insights

## Overview

Analyze each seller's live eBay listings and surface **actionable intelligence**: which listings are underperforming, which have poor health scores, which have pricing opportunities, and which should be relisted. This turns the raw dashboard data into clear "next actions."

## Goals

- Listing Health Score (0–100) per listing based on views, impressions, CTR, watchers, age
- Underperforming alert badges on listings with low view/sales ratio
- "Stale listing" detection (active > 60 days with 0 sales)
- Pricing opportunity flags (listing price significantly above or below competitor median)
- Duplicate listing detection (two listings with very similar titles)
- Weekly Insights email / in-app digest (most urgent issues)
- Sortable "Health Score" column in the dashboard listings table

## Technical Architecture

### Health Score Algorithm

Calculated entirely client-side in the browser from existing `EbayListing` data — no new API calls needed.

```typescript
// src/lib/listingHealthScore.ts
export interface HealthScore {
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  flags: HealthFlag[];
}

export interface HealthFlag {
  type:
    | "stale"
    | "no_views"
    | "low_ctr"
    | "no_watchers"
    | "overpriced"
    | "underpriced"
    | "duplicate";
  severity: "warning" | "critical";
  message: string;
  action: string; // suggested fix
}

export function computeHealthScore(
  listing: EbayListing,
  allListings: EbayListing[],
): HealthScore {
  let score = 100;
  const flags: HealthFlag[] = [];

  // Views component (max 25 pts)
  const viewScore = Math.min(25, (listing.views30d / 50) * 25);
  score -= 25 - viewScore;

  // CTR component (max 20 pts) — good CTR is >= 2%
  const ctrScore = Math.min(20, (listing.clickThroughRate / 2) * 20);
  score -= 20 - ctrScore;

  // Watcher component (max 20 pts)
  const watchScore = Math.min(20, (listing.watchCount / 5) * 20);
  score -= 20 - watchScore;

  // Sales component (max 35 pts)
  const saleScore = listing.transactions30d > 0 ? 35 : 0;
  score -= 35 - saleScore;

  // Staleness flag: active > 60 days with 0 sales
  if (listing.listingDate) {
    const ageDays =
      (Date.now() - new Date(listing.listingDate).getTime()) / 86400000;
    if (ageDays > 60 && listing.transactions === 0) {
      flags.push({
        type: "stale",
        severity: "warning",
        message: "Listed 60+ days with no sales",
        action: "Relist with lower price or better photos",
      });
      score = Math.max(0, score - 10);
    }
  }

  // No views in 30d
  if (listing.views30d === 0) {
    flags.push({
      type: "no_views",
      severity: "critical",
      message: "Zero views in 30 days",
      action: "Review title keywords and category",
    });
  }

  // Low CTR
  if (listing.impressions30d > 100 && listing.clickThroughRate < 0.5) {
    flags.push({
      type: "low_ctr",
      severity: "warning",
      message: "Low click-through rate (<0.5%)",
      action: "Improve main photo and title",
    });
  }

  // Competitor pricing flags (if competitor data available)
  if (listing.competitor?.medianPrice) {
    const delta =
      ((listing.price - listing.competitor.medianPrice) /
        listing.competitor.medianPrice) *
      100;
    if (delta > 20) {
      flags.push({
        type: "overpriced",
        severity: "warning",
        message: `Priced ${delta.toFixed(0)}% above market median`,
        action: `Consider lowering to ~$${listing.competitor.medianPrice.toFixed(2)}`,
      });
      score = Math.max(0, score - 15);
    } else if (delta < -20) {
      flags.push({
        type: "underpriced",
        severity: "warning",
        message: `Priced ${Math.abs(delta).toFixed(0)}% below market median`,
        action: "You may be leaving money on the table",
      });
    }
  }

  // Grade mapping
  const grade =
    score >= 80
      ? "A"
      : score >= 60
        ? "B"
        : score >= 40
          ? "C"
          : score >= 20
            ? "D"
            : "F";
  return { score: Math.max(0, Math.round(score)), grade, flags };
}
```

### Frontend Changes

**1. `src/lib/listingHealthScore.ts`** — New utility file with the algorithm above

**2. `src/pages/DashboardPage.tsx`** — Listings table additions:

- New "Health" column: circular score badge (color-coded A=green, B=blue, C=yellow, D=orange, F=red)
- Clicking the badge opens a `ListingInsightsSheet` side panel
- New "Issues" filter button: "Show only listings with warnings/critical flags"
- Insights summary banner at top of listings table: "⚠️ 3 listings need attention"

**3. New `src/components/ListingInsightsSheet.tsx`** — Side panel (shadcn Sheet):

- Listing thumbnail + title + current price
- Large circular health score dial
- Flags list with severity icons, messages, and action buttons
- "Apply Fix" shortcuts: one-click relist, price adjustment, etc.
- Historical score trend (if we start storing scores over time)

**4. New `src/components/InsightsBanner.tsx`** — Top-of-dashboard summary:

- Count of critical vs warning issues
- Quick action links ("Fix 2 critical listings")
- Dismissible until next data refresh

**5. New `src/components/DuplicateDetector.tsx`** — Inline badge on listings:

- Client-side: compare all listing titles using normalized token comparison
- Flag pairs with Jaccard similarity > 0.7 as potential duplicates
- Show "Possible duplicate" badge with link to the similar listing

**6. `src/pages/DashboardPage.tsx`** — New sort option `"health"` for listing table

### Duplicate Detection Logic

```typescript
// src/lib/duplicateDetection.ts
function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((t) => b.has(t)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export function findDuplicates(listings: EbayListing[]): Map<string, string[]> {
  // Returns Map<listingId, [similarListingId, ...]>
}
```

### Plan Gating

- Basic health score badge: **Pro + Shop**
- Full insights sheet with action buttons: **Pro + Shop**
- Weekly insights digest email: **Shop only**

---

---

# Feature #5 — Market Research Tools

## Overview

Give sellers real-time intelligence about the eBay marketplace for their categories: what competitors are pricing, which categories are trending, and what keywords are driving traffic. Builds on the existing `ebay-competitor-search` edge function and `competitor_prices` table.

## Goals

- Saved market watches: user pins specific search terms / categories to monitor
- Price trend charts: 30/60/90-day price movement for a search query
- Category heat map: visual of which categories in your portfolio are "hot"
- Keyword research: type a query, see estimated search volume + competition level
- "Sold vs. Active" ratio: show sell-through rate for a given search
- Competitor spotlight: top 3 competing listings for each of your listings

## Technical Architecture

### Database Changes

**New `market_watches` table:**

```sql
CREATE TABLE public.market_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  category_id TEXT,
  label TEXT,                        -- user-friendly name
  last_checked_at TIMESTAMPTZ,
  avg_price NUMERIC(10,2),
  min_price NUMERIC(10,2),
  max_price NUMERIC(10,2),
  active_count INTEGER,
  sold_count INTEGER,                -- from eBay completed listings
  sell_through_rate NUMERIC(5,2),    -- sold / (sold + active) * 100
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX market_watches_user_idx ON public.market_watches(user_id);
```

**New `market_price_history` table:**

```sql
CREATE TABLE public.market_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id UUID NOT NULL REFERENCES public.market_watches(id) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ DEFAULT NOW(),
  avg_price NUMERIC(10,2),
  min_price NUMERIC(10,2),
  max_price NUMERIC(10,2),
  active_count INTEGER,
  sold_count INTEGER
);
CREATE INDEX market_price_history_watch_idx ON public.market_price_history(watch_id);
CREATE INDEX market_price_history_sampled_idx ON public.market_price_history(sampled_at);
```

### New Edge Functions

**1. `supabase/functions/market-watch-refresh/index.ts`**

- Input: `{ watchId, userId }`
- Calls eBay Finding API (`findCompletedItems` + `findItemsAdvanced`) for the saved query
- Extracts sold prices, active prices, counts
- Updates `market_watches` row and inserts `market_price_history` row
- Returns fresh market snapshot

**2. `supabase/functions/market-watch-cron/index.ts`**

- Cron job (daily) — scans all `market_watches` rows not updated in 24h
- Calls `market-watch-refresh` for each
- Rate-limited: max 50 watches per run to stay within eBay API limits

**3. `supabase/functions/keyword-research/index.ts`**

- Input: `{ query, categoryId? }`
- Calls eBay `findItemsAdvanced` for active listings count
- Calls eBay `findCompletedItems` for sold count
- Returns: `{ activeCount, soldCount, sellThroughRate, avgSoldPrice, priceRange, topSellers }`
- Cached in Supabase for 4 hours to minimize API calls

### Frontend Changes

**1. New `src/pages/MarketResearchPage.tsx`** — Main research hub:

- **Search bar at top**: enter any keyword to get instant market snapshot
- **Saved Watches panel**: list of pinned searches with last-updated prices and trend arrows
- **Keyword research results card**: active count, sold count, sell-through rate, avg price, price range
- **Price trend chart** (Recharts `LineChart`): 30-day history for selected watch
- **Top competitors panel**: top 3 active competing listings with thumbnails and prices

**2. New `src/components/MarketWatchCard.tsx`** — Individual watch card:

- Query label + last-updated timestamp
- Price: avg/min/max with trend arrow (vs. previous snapshot)
- Sell-through rate badge
- "Refresh now" and "Delete watch" buttons

**3. New `src/components/PriceTrendChart.tsx`** — Recharts line chart:

- X-axis: dates (last 30 samples)
- Y-axis: price ($)
- Three lines: avg, min, max
- Tooltip showing exact values on hover
- Responsive container, dark-mode aware colors

**4. New `src/components/SellThroughMeter.tsx`** — Visual gauge:

- Circular progress meter (0–100%)
- Color coded: green >50%, yellow 20-50%, red <20%
- Tooltip: "X sold items vs Y active listings"

**5. `src/pages/DashboardPage.tsx`** — Category heat map widget:

- Groups seller's listings by `categoryId`
- Fetches sell-through rate for each category from `market_watches` (if watch exists)
- Renders a colored grid of category tiles
- Clicking a tile navigates to MarketResearchPage with that category pre-selected

**6. `src/App.tsx`** — Add `/market` route (ProtectedRoute, ownerOnly)

**7. `src/components/BottomNav.tsx`** — Add "Market" tab with `TrendingUp` icon (Pro/Shop only, ownerOnly)

### eBay API Integration

Uses the existing eBay Finding API pattern already established in `ebay-competitor-search`. Key endpoints:

- `findItemsAdvanced` — active listings
- `findCompletedItems` — sold items (requires `itemFilter[0].name=SoldItemsOnly`)
- Existing auth pattern: user OAuth token passed in headers

### Plan Gating

- Single keyword lookup (no save): **All paid plans**
- Saved watches (up to 5): **Pro**
- Saved watches (unlimited) + price history charts + cron refresh: **Shop**
- Category heat map: **Pro + Shop**

---

---

# Feature #6 — Auto-Optimization

## Overview

Take the insights from Feature #4 (health scores) and Feature #5 (market data) and automate corrective actions: auto-relist stale items, suggest and apply bulk price updates, optimize titles with better keywords, and rate image quality. This is the "set it and forget it" tier that justifies premium pricing.

## Goals

- Smart Relist: one-click relist of stale/ended listings with optional price adjustment
- Bulk Price Update: apply AI-suggested price changes to multiple listings at once
- Title Optimizer: AI rewrites titles using high-performing keywords from market research
- Image Quality Scorer: rate listing photos 1–5 and suggest improvements
- Auto-Reprice Rules: set rules like "always stay 5% below market median"
- Action Queue: dashboard widget showing pending auto-optimization suggestions

## Technical Architecture

### New Edge Functions

**1. `supabase/functions/ebay-relist/index.ts`**

- Input: `{ userToken, listingId, newPrice?, reason }`
- Calls eBay Inventory API to end current listing if needed
- Creates new offer/listing with updated price
- Records relist event in new `relist_history` table
- Returns: `{ success, newListingId, newOfferId }`

**2. `supabase/functions/ebay-bulk-reprice/index.ts`** (extends existing `ebay-reprice`)

- Input: `{ userToken, items: [{ sku, newPrice }] }`
- Batch updates prices using eBay Inventory API `updateOffer`
- Returns per-item success/failure array
- Max 50 items per call (eBay rate limit)

**3. `supabase/functions/title-optimizer/index.ts`**

- Input: `{ title, categoryId, competitorTitles: string[] }`
- Calls OpenAI GPT-4o with a carefully crafted prompt
- Analyzes top competitor titles for winning keyword patterns
- Returns: `{ optimizedTitle, keywordsAdded, keywordsRemoved, explanation }`
- Results cached by `(title, categoryId)` hash for 24h

**4. `supabase/functions/image-scorer/index.ts`**

- Input: `{ imageUrl }`
- Calls GPT-4o Vision to evaluate listing photo
- Scores: background cleanliness, lighting, focus, composition, subject prominence
- Returns: `{ overallScore: 1-5, breakdown: {...}, suggestions: string[] }`

**5. Extend `supabase/functions/ebay-reprice/index.ts`**

- Add support for rule-based repricing: `{ rule: "beat_median_by", percent: 5 }`
- Store active reprice rules in new `reprice_rules` table

### Database Changes

**New `relist_history` table:**

```sql
CREATE TABLE public.relist_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_listing_id TEXT,
  new_listing_id TEXT,
  original_price NUMERIC(10,2),
  new_price NUMERIC(10,2),
  reason TEXT,                 -- "stale_60d", "manual", "auto_rule"
  relisted_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New `reprice_rules` table:**

```sql
CREATE TABLE public.reprice_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,        -- "beat_median_by_pct", "match_lowest", "floor_price"
  rule_value NUMERIC(10,2),       -- e.g. 5.0 for "5% below median"
  floor_price NUMERIC(10,2),      -- never go below this
  apply_to TEXT DEFAULT 'all',    -- 'all' | specific categoryId
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New `optimization_suggestions` table:**

```sql
CREATE TABLE public.optimization_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id TEXT,
  suggestion_type TEXT NOT NULL,   -- "relist", "reprice", "title", "image"
  current_value TEXT,
  suggested_value TEXT,
  reason TEXT,
  priority INTEGER DEFAULT 1,      -- 1=critical, 2=warning, 3=info
  is_dismissed BOOLEAN DEFAULT FALSE,
  is_applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Frontend Changes

**1. New `src/pages/OptimizationPage.tsx`** — Action queue hub:

- **Summary cards**: "5 listings need attention", "3 price updates suggested", "2 titles can be improved"
- **Priority queue table**: sorted by priority, showing listing + suggestion + one-click "Apply" button
- **Bulk actions**: "Apply all price suggestions", "Dismiss all info-level"
- **Rule configuration section**: set and manage reprice rules
- **Auto-relist settings**: configure age threshold (30/60/90 days) and price delta

**2. New `src/components/ActionQueueCard.tsx`** — Individual suggestion row:

- Listing thumbnail, title, current value, suggested value, reason
- "Apply" button (calls appropriate edge function)
- "Dismiss" button
- "Preview" button (shows before/after comparison)

**3. New `src/components/TitleOptimizerModal.tsx`** — Modal for title improvements:

- Side-by-side current vs. optimized title
- Highlighted diff (added keywords in green, removed in red)
- "Accept", "Edit", or "Reject" actions
- Shows explanation from AI

**4. New `src/components/ImageScoreCard.tsx`** — Photo quality widget:

- Star rating display (1–5)
- Breakdown bars for each dimension
- Bullet-point suggestions
- "Re-score" button

**5. New `src/components/RepriceRuleBuilder.tsx`** — Rule configuration UI:

- Dropdown for rule type
- Number input for percentage/amount
- Floor price input
- Category scope selector
- Enable/disable toggle

**6. `src/pages/DashboardPage.tsx`** — Add "Optimize" quick-action button to each listing row:

- Opens `OptimizationPage` filtered to that specific listing

**7. `src/App.tsx`** — Add `/optimize` route (ProtectedRoute, ownerOnly)

**8. `src/components/BottomNav.tsx`** — Add "Optimize" tab with `Zap` icon (Shop only, ownerOnly)

### AI Integration

Title optimizer and image scorer use OpenAI GPT-4o (`gpt-4o`) — the same model already used in `analyze-item`. Credit cost: 1 credit per title optimization, 1 credit per image score. Edge functions gate on subscription tier.

### Plan Gating

- View suggestions only: **Pro**
- Apply price suggestions + smart relist: **Pro + Shop**
- Title optimizer + image scorer + reprice rules: **Shop only**
- Auto-relist cron (fully automatic, no manual trigger): **Shop only**

---

---

# Feature #10 — Bulk Listing Generator

## Overview

Allow sellers to upload a CSV or fill a template to create 10–1,000 listings at once, with AI description generation per row, real-time validation, and batch publishing to eBay. This is the highest-leverage time-saver: instead of spending 30 minutes per item, a seller spends 30 minutes on 100 items.

## Goals

- CSV upload with drag-and-drop; template download
- Column mapping UI (map your CSV columns to our fields)
- AI description auto-generation per row (with batch queue, rate-limited)
- Inline validation table: red cells for errors, yellow for warnings
- Preview mode before committing
- Progress tracker: shows publishing status per row in real time
- Error report download (rows that failed to publish)
- Template system: 5 built-in category templates (Coins, Electronics, Clothing, Books, Other)

## Technical Architecture

### CSV Format Specification

**Minimum required columns:**

```
Title, Condition, Price, Category_ID
```

**Full supported columns:**

```
Title, Description, Condition, Price, Quantity, Category_ID,
Format (FIXED_PRICE|AUCTION), Auction_Start_Price, Buy_It_Now_Price,
Image_URL_1..Image_URL_8, Fulfillment_Policy_ID, Payment_Policy_ID,
Return_Policy_ID, Item_Specific_[Key], COGS, Consignor
```

**Item-specific columns** use prefix notation: `Item_Specific_Brand`, `Item_Specific_Year`, etc.

### New Edge Functions

**1. `supabase/functions/bulk-generate-descriptions/index.ts`**

- Input: `{ rows: [{ title, condition, itemSpecifics, imageUrl? }], tier }`
- Loops through rows, calls GPT-4o per row (same prompt as `analyze-item`)
- Returns array of `{ rowIndex, description, error? }`
- Rate-limited: 5 rows/second, max 200 rows per call for Pro, 1000 for Shop
- Streams progress updates via Server-Sent Events or chunked response

**2. `supabase/functions/bulk-publish/index.ts`**

- Input: `{ userToken, rows: BulkRow[], dryRun?: boolean }`
- Loops through validated rows and calls eBay Inventory API for each
- Returns: `{ published: number, failed: number, results: [{ rowIndex, success, listingId?, error? }] }`
- Saves successful publishes to `drafts` table with `publish_status = "published"`
- Saves failed rows with error details
- Max 100 rows per call; caller should paginate for larger batches

### New Types

**`src/types/bulk-listing.ts`:**

```typescript
export interface BulkRow {
  rowIndex: number;
  title: string;
  description?: string;
  condition: string;
  price: number;
  quantity: number;
  categoryId: string;
  format: "FIXED_PRICE" | "AUCTION";
  auctionStartPrice?: number;
  buyItNowPrice?: number;
  imageUrls: string[];
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  itemSpecifics?: Record<string, string>;
  cogs?: number;
  consignor?: string;
}

export type BulkRowStatus =
  "pending" | "generating" | "ready" | "publishing" | "published" | "error";

export interface BulkRowValidation {
  rowIndex: number;
  errors: BulkValidationIssue[];
  warnings: BulkValidationIssue[];
  status: BulkRowStatus;
  listingId?: string;
  errorMessage?: string;
}

export interface BulkValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export type BulkTemplate =
  "coins" | "electronics" | "clothing" | "books" | "generic";
```

### Frontend Changes

**1. New `src/pages/BulkListingPage.tsx`** — Main bulk listing page, 4-step wizard:

**Step 1 — Upload/Template:**

- Drag-and-drop CSV upload zone with `react-dropzone`-style handling (native file input)
- "Or start from template" section with 5 template cards (Coins, Electronics, Clothing, Books, Generic)
- Template download button: generates and downloads a pre-filled CSV example
- Manual entry option: "Add rows one by one" link to step 2 with empty table

**Step 2 — Column Mapping:**

- Shows first 3 rows of uploaded CSV as preview
- Dropdown selector per CSV column: maps to our internal field names
- Auto-detection: if CSV column headers match our names, auto-map
- "Required fields" checklist (Title, Condition, Price, Category_ID must be mapped)
- "Skip column" option for unrecognized columns

**Step 3 — Review & Generate:**

- Editable data table using a custom `BulkDataTable` component
  - Each row shows all mapped fields in compact cells
  - Inline editing: click any cell to edit
  - Red highlight on invalid cells; yellow on warnings
  - "Description" column shows placeholder until AI generates
- "Generate All Descriptions (AI)" button — triggers `bulk-generate-descriptions`
  - Progress bar showing X/N descriptions generated
  - Each row shows spinner → checkmark as description is generated
- Row-level actions: duplicate row, delete row, add row
- Add more images: each row has "Add images" button (up to 8 URLs)
- Category lookup: click category ID to open eBay category tree search
- Policies section: set fulfillment/payment/return policy for all rows at once (or per-row override)

**Step 4 — Publish:**

- Summary: "N rows ready, M rows have errors"
- Error rows list with specific fixes needed
- "Publish X Ready Listings" button — triggers `bulk-publish`
- Real-time progress: animated row table where each row shows:
  - ⏳ pending → 🔄 publishing → ✅ published (with listing link) / ❌ failed (with error)
- Final summary: "Published: 48 / 50. 2 failed. Download error report."
- "Download Error Report" button: CSV of failed rows with error messages

**2. New `src/components/BulkDataTable.tsx`** — High-performance editable table:

- Uses `<table>` with virtualization for large row counts (100+)
- Keyboard navigation: Tab, Enter, Arrow keys
- Batch column fill: select multiple rows + shift-click to fill same value

**3. New `src/components/BulkUploadZone.tsx`** — CSV upload widget:

- Accepts `.csv`, `.xlsx` files
- Shows file name, row count, detected columns after upload
- Uses `papaparse` for CSV parsing, `xlsx` library (already in package.json) for Excel

**4. New `src/components/BulkTemplateCard.tsx`** — Template selection card:

- Icon, category name, "best for X items" description
- Pre-configured columns for that category type
- Click to load empty template table

**5. New `src/components/BulkProgressBar.tsx`** — Real-time publish progress:

- Overall progress bar (% of rows published)
- Row-level status indicators
- "Pause" and "Resume" controls (stops queue between rows)
- "View Published" link appearing as each row succeeds

**6. `src/App.tsx`** — Add `/bulk` route (ProtectedRoute)

**7. `src/components/BottomNav.tsx`** — Add "Bulk" tab with `Layers` icon (visible to isOwner or isLister)

**8. `src/pages/HomePage.tsx`** — Add "Bulk List" quick action card alongside existing "Capture" card

### CSV Parser Implementation

```typescript
// src/lib/bulkCsvParser.ts
import Papa from "papaparse"; // add to package.json as "papaparse" + "@types/papaparse"

export function parseBulkCSV(file: File): Promise<{
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) =>
        resolve({
          headers: results.meta.fields || [],
          rows: results.data as Record<string, string>[],
          rowCount: results.data.length,
        }),
      error: reject,
    });
  });
}
```

### Template Definitions

```typescript
// src/lib/bulkTemplates.ts
export const BULK_TEMPLATES = {
  coins: {
    label: "Coins & Currency",
    icon: "🪙",
    defaultCategoryId: "11116",
    columns: [
      "Title",
      "Year",
      "Mint_Location",
      "Grade",
      "Condition",
      "Price",
      "Description",
    ],
    sampleRows: [
      {
        Title: "1921 Morgan Silver Dollar MS-63",
        Year: "1921",
        Mint_Location: "Philadelphia",
        Grade: "MS-63",
        Condition: "PRE_OWNED_GOOD",
        Price: "89.99",
      },
    ],
  },
  electronics: {/* ... */},
  clothing: {/* ... */},
  books: {/* ... */},
  generic: {/* ... */},
};
```

### Validation Rules

```typescript
// src/lib/bulkValidation.ts
const VALIDATION_RULES = [
  { field: "title", maxLen: 80, required: true },
  { field: "price", min: 0.01, required: true, numeric: true },
  { field: "categoryId", required: true, pattern: /^\d+$/ },
  {
    field: "condition",
    required: true,
    enum: Object.keys(EBAY_CONDITION_ID_MAP),
  },
  { field: "imageUrls", maxCount: 8 },
  // ...
];
```

### Plan Gating

- Upload CSV + preview (no publish): **All paid plans**
- AI description generation (up to 25 rows): **Pro**
- AI description generation (up to 1000 rows): **Shop**
- Bulk publish (up to 50 listings): **Pro**
- Bulk publish (up to 1000 listings): **Shop**

---

---

# Master Todo Checklist

## 🗃️ Feature #1 — True Profit with COGS

### Database

- [ ] Write migration: add `cogs`, `cogs_source`, `cogs_acquired_at` columns to `drafts` table
- [ ] Write migration: create `listing_cogs` table with indexes
- [ ] Apply migrations via `supabase db push`

### Types & Hooks

- [ ] Add `cogs`, `cogsSource`, `cogsAcquiredAt` fields to `ListingDraft` in `src/types/listing.ts`
- [ ] Update `useDrafts.ts` — map new columns in `fetchDrafts`, `addDraft`, `updateDraft`

### Components

- [ ] Create `src/components/CogsInput.tsx` — reusable COGS entry widget
- [ ] Create `src/components/ProfitBadge.tsx` — color-coded margin badge
- [ ] Create `src/components/ProfitReportCard.tsx` — summary card

### Page Updates

- [ ] Update `src/pages/AnalyzePage.tsx` — add optional COGS field below Consignor
- [ ] Update `src/components/EditDraftModal.tsx` — add COGS section with profit preview
- [ ] Update `src/pages/DashboardPage.tsx` — add `cogsTotal` to `FinancialWindow`, update `netProfit` calc
- [ ] Update `src/pages/DashboardPage.tsx` — add "Est. Profit" column to listings table
- [ ] Update `src/pages/DashboardPage.tsx` — add COGS row + True Margin % to Sales & Profit card

### New Pages & Edge Functions

- [ ] Create `src/pages/ProfitReportPage.tsx` — per-item P&L report
- [ ] Create `supabase/functions/cogs-report/index.ts` — edge function joining orders + COGS data
- [ ] Add `/profit-report` route in `src/App.tsx`
- [ ] Gate P&L report page behind Pro/Shop plan check

### Testing & Deploy

- [ ] Verify TypeScript compiles cleanly (`npm run build`)
- [ ] Test COGS entry in AnalyzePage → save draft → verify DB values
- [ ] Test profit calculation on Dashboard with real order data
- [ ] Create PR on feature branch `feature/cogs-true-profit`
- [ ] Merge and verify GitHub Actions deploy succeeds

---

## 📊 Feature #4 — Smart Listing Insights

### Core Algorithm

- [ ] Create `src/lib/listingHealthScore.ts` — full `computeHealthScore` function
- [ ] Create `src/lib/duplicateDetection.ts` — `findDuplicates` with Jaccard similarity

### Components

- [ ] Create `src/components/ListingInsightsSheet.tsx` — shadcn Sheet side panel
- [ ] Create `src/components/InsightsBanner.tsx` — top-of-listings summary banner
- [ ] Create `src/components/DuplicateDetector.tsx` — inline duplicate badge
- [ ] Create `src/components/HealthScoreBadge.tsx` — circular score badge with grade letter

### Dashboard Updates

- [ ] Update `src/pages/DashboardPage.tsx` — add "Health" column to listings table
- [ ] Update `src/pages/DashboardPage.tsx` — add `health` sort option
- [ ] Update `src/pages/DashboardPage.tsx` — add InsightsBanner above listings table
- [ ] Update `src/pages/DashboardPage.tsx` — add "Issues only" filter toggle
- [ ] Wire "Health" badge click to open `ListingInsightsSheet`

### Plan Gating

- [ ] Gate health score computation behind Pro/Shop check in `useAuth`
- [ ] Show upgrade prompt for Starter users in badge area

### Testing & Deploy

- [ ] Test health score algorithm with edge cases (new listing, 0 views, high CTR)
- [ ] Test duplicate detection with known-similar titles
- [ ] Verify TypeScript compiles cleanly
- [ ] Create PR on feature branch `feature/smart-listing-insights`
- [ ] Merge and verify GitHub Actions deploy succeeds

---

## 🔍 Feature #5 — Market Research Tools

### Database

- [ ] Write migration: create `market_watches` table with indexes
- [ ] Write migration: create `market_price_history` table with indexes
- [ ] Apply migrations via `supabase db push`

### Edge Functions

- [ ] Create `supabase/functions/market-watch-refresh/index.ts`
  - [ ] Integrate eBay Finding API `findCompletedItems` (sold prices)
  - [ ] Integrate eBay Finding API `findItemsAdvanced` (active listings)
  - [ ] Compute sell-through rate and update `market_watches` row
  - [ ] Insert row into `market_price_history`
- [ ] Create `supabase/functions/market-watch-cron/index.ts`
  - [ ] Query all watches not refreshed in 24h
  - [ ] Rate-limit to 50 watches per run
  - [ ] Register cron schedule in `supabase/config.toml`
- [ ] Create `supabase/functions/keyword-research/index.ts`
  - [ ] Call eBay APIs with 4-hour cache
  - [ ] Return full market snapshot

### Components

- [ ] Create `src/components/MarketWatchCard.tsx`
- [ ] Create `src/components/PriceTrendChart.tsx` — Recharts LineChart
- [ ] Create `src/components/SellThroughMeter.tsx` — circular progress gauge
- [ ] Create `src/components/CategoryHeatMap.tsx` — category grid for Dashboard

### New Page

- [ ] Create `src/pages/MarketResearchPage.tsx` — full research hub
  - [ ] Keyword search bar
  - [ ] Saved watches panel
  - [ ] Price trend chart section
  - [ ] Competitor spotlight panel
- [ ] Add `/market` route in `src/App.tsx` (ProtectedRoute, ownerOnly)

### Navigation

- [ ] Update `src/components/BottomNav.tsx` — add "Market" tab with `TrendingUp` icon (Pro/Shop)

### Dashboard Integration

- [ ] Update `src/pages/DashboardPage.tsx` — add CategoryHeatMap widget below listings table

### Plan Gating

- [ ] Gate keyword research behind paid plan check
- [ ] Gate saved watches (> 5) behind Shop plan
- [ ] Gate price history charts behind Pro/Shop

### Testing & Deploy

- [ ] Test `market-watch-refresh` with real eBay token and query
- [ ] Test cron logic with mock data
- [ ] Verify PriceTrendChart renders with empty and populated data
- [ ] Verify TypeScript compiles cleanly
- [ ] Create PR on feature branch `feature/market-research-tools`
- [ ] Merge and verify GitHub Actions deploy succeeds

---

## ⚡ Feature #6 — Auto-Optimization

### Database

- [ ] Write migration: create `relist_history` table
- [ ] Write migration: create `reprice_rules` table
- [ ] Write migration: create `optimization_suggestions` table
- [ ] Apply migrations via `supabase db push`

### Edge Functions

- [ ] Create `supabase/functions/ebay-relist/index.ts`
  - [ ] Accept `{ userToken, listingId, newPrice?, reason }`
  - [ ] Call eBay Inventory API to end + recreate listing
  - [ ] Insert row into `relist_history`
- [ ] Create `supabase/functions/bulk-reprice/index.ts` (extends existing `ebay-reprice`)
  - [ ] Accept array of `{ sku, newPrice }` items
  - [ ] Batch update via eBay `updateOffer`
  - [ ] Return per-item results
- [ ] Create `supabase/functions/title-optimizer/index.ts`
  - [ ] Accept `{ title, categoryId, competitorTitles }`
  - [ ] Call GPT-4o with keyword-extraction prompt
  - [ ] Cache results by hash for 24h
- [ ] Create `supabase/functions/image-scorer/index.ts`
  - [ ] Accept `{ imageUrl }`
  - [ ] Call GPT-4o Vision with scoring rubric prompt
  - [ ] Return structured scores + suggestions

### Components

- [ ] Create `src/components/ActionQueueCard.tsx`
- [ ] Create `src/components/TitleOptimizerModal.tsx`
- [ ] Create `src/components/ImageScoreCard.tsx`
- [ ] Create `src/components/RepriceRuleBuilder.tsx`

### New Page

- [ ] Create `src/pages/OptimizationPage.tsx` — action queue hub
  - [ ] Summary stats cards
  - [ ] Priority-sorted suggestion table
  - [ ] Bulk apply / dismiss controls
  - [ ] Reprice rules configuration section
  - [ ] Auto-relist settings
- [ ] Add `/optimize` route in `src/App.tsx` (ProtectedRoute, ownerOnly)

### Navigation

- [ ] Update `src/components/BottomNav.tsx` — add "Optimize" tab with `Zap` icon (Shop only)

### Dashboard Integration

- [ ] Update `src/pages/DashboardPage.tsx` — add "Optimize" quick-action button per listing row

### Plan Gating

- [ ] Gate action queue view behind Pro/Shop
- [ ] Gate reprice + relist actions behind Pro/Shop
- [ ] Gate title optimizer + image scorer behind Shop only

### Testing & Deploy

- [ ] Test `ebay-relist` with a real ended listing
- [ ] Test `title-optimizer` with sample coin titles
- [ ] Test `image-scorer` with listing photo URL
- [ ] Verify suggestion queue populates from health score data
- [ ] Verify TypeScript compiles cleanly
- [ ] Create PR on feature branch `feature/auto-optimization`
- [ ] Merge and verify GitHub Actions deploy succeeds

---

## 📋 Feature #10 — Bulk Listing Generator

### Dependencies

- [ ] Add `papaparse` + `@types/papaparse` to `package.json`
- [ ] Run `npm install` to install new deps

### Types & Libraries

- [ ] Create `src/types/bulk-listing.ts` — `BulkRow`, `BulkRowStatus`, `BulkRowValidation`, `BulkValidationIssue`, `BulkTemplate` types
- [ ] Create `src/lib/bulkCsvParser.ts` — CSV/Excel parser using `papaparse` + `xlsx`
- [ ] Create `src/lib/bulkTemplates.ts` — 5 template definitions (coins, electronics, clothing, books, generic)
- [ ] Create `src/lib/bulkValidation.ts` — per-row validation rules using existing condition/category maps

### Edge Functions

- [ ] Create `supabase/functions/bulk-generate-descriptions/index.ts`
  - [ ] Accept `{ rows, tier }` array
  - [ ] Loop through rows calling GPT-4o description generation
  - [ ] Rate-limit: 5 rows/second
  - [ ] Return `{ rowIndex, description, error? }[]`
- [ ] Create `supabase/functions/bulk-publish/index.ts`
  - [ ] Accept `{ userToken, rows: BulkRow[] }`
  - [ ] Loop through rows calling eBay Inventory API `createOrReplaceInventoryItem` + `createOffer` + `publishOffer`
  - [ ] Save successes to `drafts` table
  - [ ] Return per-row results array

### Components

- [ ] Create `src/components/BulkUploadZone.tsx` — drag-and-drop CSV/Excel upload
- [ ] Create `src/components/BulkDataTable.tsx` — virtualized editable table
  - [ ] Inline cell editing
  - [ ] Keyboard navigation (Tab, Enter, Arrow)
  - [ ] Error/warning cell highlighting
  - [ ] Row add/delete/duplicate actions
- [ ] Create `src/components/BulkTemplateCard.tsx` — template selection card
- [ ] Create `src/components/BulkProgressBar.tsx` — real-time publish progress tracker
- [ ] Create `src/components/BulkColumnMapper.tsx` — CSV column → internal field mapping UI

### New Page

- [ ] Create `src/pages/BulkListingPage.tsx` — 4-step wizard
  - [ ] Step 1: Upload CSV or choose template
  - [ ] Step 2: Column mapping
  - [ ] Step 3: Review table + AI description generation
  - [ ] Step 4: Publish with real-time progress
- [ ] Add `/bulk` route in `src/App.tsx` (ProtectedRoute)

### Navigation & Discovery

- [ ] Update `src/components/BottomNav.tsx` — add "Bulk" tab with `Layers` icon
- [ ] Update `src/pages/HomePage.tsx` — add "Bulk List" card to quick actions

### Plan Gating

- [ ] Gate AI description generation (> 25 rows) behind Shop plan
- [ ] Gate bulk publish (> 50 rows) behind Shop plan
- [ ] Show upgrade prompt for Free/Starter users

### Testing & Deploy

- [ ] Test CSV parser with real file (coins template)
- [ ] Test Excel parser with .xlsx file
- [ ] Test `bulk-generate-descriptions` with 10-row batch
- [ ] Test `bulk-publish` in dry-run mode first
- [ ] Test `bulk-publish` live with 3-5 real listings
- [ ] Test column mapper with mismatched headers
- [ ] Test validation with intentional errors (missing title, bad price)
- [ ] Verify progress tracker shows real-time updates
- [ ] Verify TypeScript compiles cleanly
- [ ] Create PR on feature branch `feature/bulk-listing-generator`
- [ ] Merge and verify GitHub Actions deploy succeeds

---

## 🏁 Cross-Feature Tasks

- [ ] Update `README.md` with new features and routes
- [ ] Update `CURRENT_STATE_SUMMARY.md` after each feature ships
- [ ] Review plan gating across all features for consistency with `PLANS` in `AuthContext.tsx`
- [ ] Smoke-test all 5 features end-to-end on production after each deploy
- [ ] Update `BillingPage.tsx` feature comparison table to list new features per plan
- [ ] Update `LandingPage.tsx` to highlight new features as selling points
