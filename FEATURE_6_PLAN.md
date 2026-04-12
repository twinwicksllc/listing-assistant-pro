# Feature #6: Auto-Optimization Plan

## Overview
Auto-Optimization automatically analyzes a seller's active eBay listings and suggests (or applies) improvements to pricing, titles, and listing quality to maximize sell-through rate and revenue. It combines the user's own listing data with market research data (from Feature #5) to generate actionable insights.

---

## Core Value Proposition
- **Save time**: Instead of manually checking each listing against market data, the system surfaces the most impactful changes automatically
- **Data-driven pricing**: Reprice based on real sold data (STR, avg sold price) not just gut feel
- **Title optimization**: Improve search visibility with better keywords
- **Stale listing detection**: Flag listings that have been active too long without selling

---

## Feature Components

### 6A: Optimization Queue (Dashboard Widget)
A new dashboard widget showing listings ranked by "optimization opportunity score."

**Data inputs:**
- User's active listings (from existing `ebay-listings` function)
- Market data per listing (from `keyword-research` function, run on listing title)
- Days active (from listing start date)
- Current price vs avg sold price

**Opportunity Score formula:**
```
score = (price_gap_pct * 0.4) + (days_stale_pct * 0.3) + (str_gap_pct * 0.3)

where:
  price_gap_pct = |current_price - avg_sold_price| / avg_sold_price
  days_stale_pct = min(days_active / 90, 1.0)   // 90 days = fully stale
  str_gap_pct = 1 - sell_through_rate            // low STR = high opportunity
```

**UI:**
- Card showing top 5 listings needing attention
- Each card shows: thumbnail, title, current price, suggested price, days active, STR
- "Optimize" button per listing → opens Optimization Modal
- "Run All" button → batch processes top N listings

---

### 6B: Optimization Modal (Per-Listing)
Opens when user clicks "Optimize" on any listing. Shows a side-by-side comparison.

**Tabs:**
1. **Pricing** - Current vs suggested price with market context
2. **Title** - Current title vs AI-suggested title with keyword improvements
3. **Description** - Current description quality score + suggestions

**Pricing Tab:**
- Shows: current price, avg sold price (from Jina), competition level, STR
- Recommends: price adjustment with reasoning
  - "Price is 23% above market average — reduce to $XX to improve sell speed"
  - "Price is below P25 — you may be leaving money on the table"
- User can accept, edit, or dismiss

**Title Tab:**
- Analyzes current title for missing keywords
- Uses `analyze-item` function output + market search terms
- Suggests improved title respecting eBay's 80-char limit
- Shows character count

**One-Click Apply:**
- Calls `ebay-reprice` function (already exists!) for price changes
- For title/description changes: calls eBay Inventory API `PUT /sell/inventory/v1/inventory_item/{sku}`

---

### 6C: Auto-Reprice Rules Engine
A rules-based auto-repricing system the user can configure.

**Rule types:**
1. **Match lowest** - Price at the lowest active competitor price
2. **Beat lowest by X%** - Price X% below lowest competitor
3. **Match average** - Price at the average sold price
4. **Floor protection** - Never go below $X (to protect margin)
5. **Ceiling protection** - Never go above $X

**Rule configuration UI:**
- Per-category rules (e.g., silver coins: match avg sold)
- Global fallback rule
- Enable/disable toggle
- Dry-run mode: "Show what would change without applying"

**Execution:**
- Manually triggered ("Run Reprice Rules")
- Or scheduled via cron (new `auto-reprice-cron` edge function)
- Results in an "Optimization History" log

---

### 6D: Stale Listing Detector
Flags listings that have been active too long and suggests actions.

**Thresholds (configurable):**
- Warning: 30+ days active, no views increase
- Critical: 60+ days active

**Suggested actions per stale listing:**
1. Reduce price by 10-15%
2. Add to Promoted Listings
3. Relist with new photos/title
4. End and relist (resets Best Match ranking)

**UI:** Separate "Stale Listings" tab or badge on optimization queue

---

### 6E: Optimization History Log
Tracks all changes made through Auto-Optimization.

**Database table: `optimization_history`**
```sql
id uuid
user_id uuid
listing_id text (eBay item ID)
listing_title text
optimization_type text ('price' | 'title' | 'description' | 'reprice_rule')
old_value text
new_value text
applied_at timestamptz
applied_by text ('user' | 'auto')
result text ('accepted' | 'dismissed' | 'pending')
```

**UI:** Simple table with filters by type/date

---

## Database Changes Needed

### New table: `optimization_history`
```sql
CREATE TABLE optimization_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id text NOT NULL,
  listing_title text,
  optimization_type text NOT NULL CHECK (optimization_type IN ('price', 'title', 'description', 'reprice_rule')),
  old_value text,
  new_value text,
  reasoning text,
  applied_at timestamptz DEFAULT now(),
  applied_by text DEFAULT 'user' CHECK (applied_by IN ('user', 'auto')),
  result text DEFAULT 'pending' CHECK (result IN ('accepted', 'dismissed', 'pending')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX optimization_history_user_id_idx ON optimization_history(user_id);
CREATE INDEX optimization_history_listing_id_idx ON optimization_history(listing_id);
ALTER TABLE optimization_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own optimization history"
  ON optimization_history FOR ALL USING (auth.uid() = user_id);
```

### New table: `reprice_rules`
```sql
CREATE TABLE reprice_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('match_lowest', 'beat_lowest', 'match_avg', 'match_sold_avg')),
  adjustment_pct numeric DEFAULT 0,  -- for beat_lowest: -5 means 5% below
  floor_price numeric,               -- never go below this
  ceiling_price numeric,             -- never go above this
  category_filter text,              -- null = apply to all
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE reprice_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own reprice rules"
  ON reprice_rules FOR ALL USING (auth.uid() = user_id);
```

---

## New Edge Functions

### `auto-reprice-cron/index.ts`
Scheduled function that applies reprice rules automatically.
- Fetches user's active listings
- For each listing, fetches market data (keyword-research)
- Applies matching reprice rules
- Calls `ebay-reprice` to update prices
- Logs results to `optimization_history`

### `optimize-listing/index.ts`
On-demand optimization analysis for a single listing.
- Input: `{ listingId, userId }`
- Fetches listing details from eBay
- Runs keyword-research for market data
- Uses AI (existing `analyze-item` / `transcribe-voice` pattern) to suggest title improvements
- Returns: `{ priceSuggestion, titleSuggestion, opportunityScore, reasoning }`

---

## New Frontend Components

### `OptimizationQueueWidget.tsx`
- Dashboard widget showing top optimization opportunities
- Sorted by opportunity score (highest first)
- Quick-action buttons

### `OptimizationModal.tsx`
- Full-screen modal for per-listing optimization
- Tabbed interface: Pricing | Title | Description
- Accept/Dismiss per suggestion
- "Apply All" button

### `RepriceRulesPage.tsx`
- Configure auto-reprice rules
- Per-category settings
- Dry-run mode toggle
- Run history

### `OptimizationHistoryTable.tsx`
- Paginated history of all optimizations
- Filter by type/date/listing
- Undo capability (within 24h, via eBay API revert)

---

## New Hook: `useOptimization.ts`
```typescript
// Fetches optimization queue for current user's listings
useOptimizationQueue() → { items: OptimizationItem[], isLoading, refetch }

// Runs optimization analysis for a single listing
useOptimizeListing(listingId) → { analyze, applying, result }

// Reprice rules CRUD
useRepriceRules() → { rules, addRule, updateRule, deleteRule, runDryRun, runRules }
```

---

## New Types: `optimization.ts`
```typescript
interface OptimizationItem {
  listingId: string;
  title: string;
  currentPrice: number;
  suggestedPrice: number | null;
  avgSoldPrice: number | null;
  sellThroughRate: number;
  competitionLevel: "low" | "medium" | "high";
  daysActive: number;
  opportunityScore: number;  // 0-100
  flags: ("stale" | "overpriced" | "underpriced" | "poor_title")[];
}

interface OptimizationSuggestion {
  type: "price" | "title" | "description";
  currentValue: string;
  suggestedValue: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  estimatedImpact: string;  // e.g. "+15% sell-through"
}

interface RepriceRule {
  id: string;
  ruleName: string;
  ruleType: "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";
  adjustmentPct: number;
  floorPrice: number | null;
  ceilingPrice: number | null;
  categoryFilter: string | null;
  isEnabled: boolean;
}
```

---

## Implementation Order (Recommended)

1. **Week 1: Foundation**
   - Create DB migration for `optimization_history` + `reprice_rules`
   - Build `optimize-listing` edge function (analysis only, no apply)
   - Add `OptimizationQueueWidget` to dashboard

2. **Week 2: Core UI**
   - Build `OptimizationModal` with Pricing and Title tabs
   - Wire up apply actions (price via existing `ebay-reprice`, title via Inventory API)
   - Add `optimization_history` tracking

3. **Week 3: Rules Engine**
   - Build `RepriceRulesPage` with rule CRUD
   - Build `auto-reprice-cron` edge function
   - Add dry-run mode

4. **Week 4: Polish**
   - Stale listing detection with age badges
   - Optimization history log UI
   - Email/notification when auto-reprice runs

---

## Estimated Complexity: Medium-High
- ~8-10 new components/pages
- ~2 new edge functions
- ~2 new DB tables
- Leverages existing: `ebay-reprice`, `analyze-item`, `keyword-research`, `ebay-listings`

## Key Risk: eBay API Rate Limits
- Running keyword-research (Jina scrape) for every listing could be slow/rate-limited
- Mitigation: Only analyze top 20 listings by opportunity score at a time, cache results 4h