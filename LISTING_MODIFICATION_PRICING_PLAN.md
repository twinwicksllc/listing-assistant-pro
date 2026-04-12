# Listing Modification & Pricing Management Plan
**Status:** Ready for Implementation  
**Date:** March 29, 2026  
**Target:** 260 Active Listings

---

## Current State Assessment

### ✅ What You Have
1. **Price Editing:**
   - Inline price editor (click to edit, save with checkmark)
   - Bulk price modal (fixed price / % adjustment / $ adjustment)
   - Single & bulk update to eBay via `ebay-reprice` function

2. **Competitor Visibility:**
   - CompetitorPriceCard on each listing showing:
     - Avg competitor price
     - Min/Max prices
     - Your position (% above/below market)
     - "Above market" / "At market" / "Below market" positioning
   - Manual refresh button to refetch competitor data

3. **Listing Display:**
   - Cards showing title, SKU, condition, listing date, category
   - Price badges, status, trend indicators
   - Analytics (views, watchers, sales, CTR) for Pro users
   - Selection checkboxes for bulk operations

4. **Filtering & Sorting:**
   - 11 sort options (date, price, trend, views, impressions, watchers, sales, CTR, title, status)
   - 8 filter types (search, status, price range, views range, watchers, impressions, has sales, trend)

### ⚠️ Gaps to Address

**For Your Current Use Case:**
1. **No table view** - Can't see all 260 listings with pricing comparison at once
2. **No quick suggestions** - No "recommended price" based on market data
3. **No competitor listings links** - Can see competitor data but no way to browse actual competitor listings
4. **No bulk repricing by strategy** - Can only set all listings to same price or adjust %
5. **No reprice rules UI** - Auto-reprice infrastructure exists but no way to create/manage rules
6. **No historical pricing data** - Can't see price change history
7. **Limited listing modification** - Only price editing; can't change title, condition, etc.

---

## Phase 1: Quick Wins (What to Build First)

### 1.1 Pricing Insights Dashboard Tab
**Purpose:** See all 260 listings with pricing comparison at a glance

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Pricing Insights                              [Refresh Data]│
├─────────────────────────────────────────────────────────────┤
│ Columns: SKU | Title | Price | Market Avg | Min | Max | Δ% │
│ [Checkbox] ABC123 │ Item Title │ $49.99 │ $45.00 │ $40│$52 │+11% │
│ [Checkbox] ABC124 │ Item Title │ $99.99 │ $95.00 │ $80│$110│+5%  │
│ [Checkbox] ABC125 │ Item Title │ $25.00 │ $35.00 │ $30│$45 │-29% │ ⚠️ LOW
│                                                              │
│ Bulk Actions: [Reprice Selected] [Apply Suggestions]       │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Sortable columns
- Color coding: 
  - Red: >10% above market (overpriced)
  - Amber: 5-10% above market
  - Green: Within 5% of market
  - Blue: Below market (good deal)
- Rows show if data is stale (>24h old)
- Refresh button to repull competitor data
- Select multiple + bulk actions

**Implementation:**
1. Create new tab "Pricing Insights" in dashboard
2. Query competitor_prices table for all listings
3. Show market data alongside your prices
4. Add sorting/filtering
5. Implement bulk selection & repricing

**Time:** 2-3 days

---

### 1.2 Suggested Prices Feature
**Purpose:** Highlight listings that should be repriced

**Logic:**
```
FOR each listing WITH competitor data:
  market_avg = competitor.avgPrice
  your_price = listing.price
  delta_pct = (your_price - market_avg) / market_avg * 100
  
  IF delta_pct > 10:
    suggestion = "Lower to $" + (market_avg * 0.95)
    reason = "11% above market avg"
  ELSE IF delta_pct > 5:
    suggestion = "Consider lowering to $" + (market_avg * 0.98)
    reason = "6% above market avg"
  ELSE IF delta_pct < -10:
    suggestion = "Raise to $" + (market_avg * 0.92)
    reason = "11% below market avg - opportunity!"
  ELSE:
    suggestion = "Keep current price"
    reason = "At market"
```

**UI:**
```
Listing Card (updated):
┌────────────────────────────────┐
│Title  [$49.99]  [View on eBay] │
│                                │
│Market: Avg $45 │Min $40│Max $52│
│                                │
│⚠️ Above Market (11%)           │
│💡 Suggestion: Lower to $42.75  │
│   [Apply Price] [Dismiss]      │
└────────────────────────────────┘
```

**Implementation:**
1. Add `priceSuggestion` calculation to listing enrichment
2. Show suggestion card if significant deviation
3. One-click apply button
4. Log to optimization_history

**Time:** 1 day

---

### 1.3 Competitor Details Modal Enhancement
**Purpose:** See actual competitor listings instead of just summary

**UI:**
```
┌─────────────────────────────────────┐
│ Competitor Listings for "Item Name" │
├─────────────────────────────────────┤
│                                     │
│ Your listing: $49.99                │
│ Seller: TrustXX (98.5% pos)         │
│                                     │
│ ─── Similar Listings (15 found) ──  │
│                                     │
│ 1. [Thumb] ItemTitle    $47.99      │
│    Seller: GreatDeals   ★★★★★      │
│    Ships Fast / Free Shipping       │
│    [View on eBay →]                 │
│                                     │
│ 2. [Thumb] ItemTitle    $52.50      │
│    Seller: Collector99  ★★★★       │
│    [View on eBay →]                 │
│                                     │
│ [Next Page]  [←] [→]  [Prev Page]   │
└─────────────────────────────────────┘
```

**Data Source:**
- Use `ebay-competitor-search` function to fetch top 20 competitors
- Parse returned listings with title, price, seller, shipping info
- Show images if available

**Implementation:**
1. Enhance CompetitorDetailsModal component
2. Fetch top 20 competitors in modal
3. Display as carousel or paginated list
4. Add links to actual eBay listings
5. Show seller ratings

**Time:** 1.5 days

---

### 1.4 Quick Bulk Reprice Strategies
**Purpose:** Apply repricing strategy to multiple listings at once

**Strategy Options:**
```
┌─ Bulk Repricing Strategies ─────┐
│                                 │
│ (Strategy 1) Match Lowest       │
│ Set all selected to lowest      │
│ competitor price (with floor)   │
│ [Apply] Floor: [$___]          │
│                                 │
│ (Strategy 2) Beat Lowest by %   │
│ Price at (lowest price - %)     │
│ [Apply] % Below: [_5__]%        │
│ Example: If lowest=$50, new=$47.50
│                                 │
│ (Strategy 3) Match Market Avg   │
│ All listed = market average     │
│ [Apply]                         │
│                                 │
│ (Strategy 4) High-Volume Play   │
│ Price 10% below avg for volume  │
│ [Apply] Discount: [_10_]%       │
│                                 │
│ (Strategy 5) Premium Positioning│
│ Price 5% above avg for quality  │
│ [Apply] Premium: [_5__]%        │
│                                 │
└─────────────────────────────────┘
```

**Implementation:**
1. Add modal with strategy templates
2. Let user select strategy + parameters
3. Calculate new prices for all selected
4. Show preview (old → new for each)
5. Confirm & apply via ebay-reprice

**Time:** 2 days

---

## Phase 2: Core Features (Weeks 2-3)

### 2.1 Listing Edit Modal
**Purpose:** Modify listing details beyond just price

**Editable Fields:**
- Title (eBay format constraints)
- Price
- Quantity
- Condition
- Description (if allowed by eBay)
- Category
- Item specifics (material, era, grade, etc.)

**Workflow:**
1. User clicks "Edit" on listing
2. Modal opens with current details
3. eBay API constraints checked & displayed
4. User makes changes
5. Preview changes
6. Submit via `ebay-revise-listing` (needs to be created)
7. Log to optimization_history

**Implementation:**
1. Create ListingEditModal component
2. Fetch current listing from eBay
3. Create `ebay-revise-listing` Edge Function
4. Handle Trading API constraints
5. Add edit button to listing cards

**Time:** 3-4 days

---

### 2.2 Reprice Rules UI
**Purpose:** Manage auto-repricing rules (backend already exists)

**Pages:**
1. **Rules List:**
   ```
   Rule Name          Type           Floor  Ceiling  Status
   ─────────────────────────────────────────────────
   Budget Items   Beat Lowest    $5     $25    ✓ Enabled
   Mid-Range      Match Avg      $25    $100   ✓ Enabled
   Premium        Premium +5%    $100   $500   ✓ Enabled
   ```

2. **Create Rule:**
   ```
   Rule Name: [Shopping category focus]
   Type: [Dropdown: Match Lowest / Beat Lowest / Match Avg / Match Sold Avg]
   Apply to Category: [Dropdown or All]
   Adjustment %: [_5__]% (only for Beat Lowest)
   Floor Price: $[___]
   Ceiling Price: $[____]
   [Enabled] Checkbox
   [Save] [Cancel]
   ```

3. **Dry Run:**
   - Show which listings would update
   - Show old vs new prices
   - Let user review before enabling

**Implementation:**
1. Create RepriceRulesPage
2. Query reprice_rules table
3. Create/update/delete rules to DB
4. Manual trigger for testing (DRY RUN mode)
5. Show optimization_history results

**Time:** 3 days

---

### 2.3 Competitor Price Tracking
**Purpose:** Historical tracking to see price trends

**Dashboard:**
```
Price Trend Chart (30-day)
┌──────────────────────────┐
│ Your Price          ─┐   │
│ Market Avg         ──┤   │
│ Market High    ─────┤   │
│ Market Low     ─────┤   │
└──────────────────────────┘
 7d ago  14d ago  Today
```

**Implementation:**
1. Store daily price snapshots in `listing_price_history`
2. Add trending chart component
3. Show price elasticity (how selling changes with price)
4. Recommend optimal price based on velocity

**Time:** 2-3 days

---

## Phase 3: Advanced Analytics (Weeks 4+)

- Price elasticity analysis
- Sales velocity optimization
- Seasonal repricing
- Category-specific strategies
- A/B testing (test different prices)

---

## Immediate Action Items (Next 2 Days)

### PRIORITY 1: Pricing Insights Table
1. Create new dashboard tab
2. Add table showing all 260 listings with:
   - SKU
   - Title
   - Your Price
   - Market Avg (from competitor_prices)
   - Min/Max range
   - Position % (above/below avg)
   - Last updated timestamp
   - Action buttons (refresh competitor data, apply suggestion, edit)

### PRIORITY 2: Suggest Prices
1. Calculate suggestion for each listing
2. Show on listing card with one-click apply
3. Log to optimization_history

### PRIORITY 3: Competitor Details
1. Enhance modal to show top 15-20 competitor listings
2. Add links to actual eBay pages
3. Show seller info, shipping, ratings

### PRIORITY 4: Bulk Strategies
1. Add modal with 5 repricing strategies
2. Let user select strategy + params
3. Preview & apply

---

## Supporting Infrastructure (Already Built)

✅ **ebay-listings** - Fetch all active listings with analytics  
✅ **keyword-research** - Get market data (avg prices, sold volume)  
✅ **ebay-competitor-search** - Find competitor listings  
✅ **ebay-reprice** - Update prices  
✅ **auto-reprice-cron** - Daily scheduled repricing (needs rules UI)  
✅ **optimize-listing** - AI price suggestions  
✅ **competitor_prices** table - Competitor data snapshots  
✅ **optimization_history** table - Audit log  

**Still Needed:**
- `ebay-revise-listing` (for title/description changes)
- Price tracking/history table
- Reprice rules CRUD UI

---

## Database Schema for Pricing Features

### New Table: listing_price_history
```sql
CREATE TABLE listing_price_history (
  id uuid PRIMARY KEY,
  user_id uuid,
  listing_id text,
  sku text,
  old_price numeric,
  new_price numeric,
  reason text, -- 'auto_reprice', 'manual_adjustment', 'competitor_response'
  changed_at timestamp,
  UNIQUE(listing_id, changed_at)
);

CREATE INDEX idx_listing_price_history_user_listing 
  ON listing_price_history(user_id, listing_id);
```

---

## Expected Outcomes

**After Phase 1 (2-3 days):**
- See all 260 listings with market pricing at a glance
- Identify which are overpriced/underpriced
- Quick-apply suggested prices
- View actual competitor listings
- Bulk repricing strategies

**After Phase 2 (weeks 2-3):**
- Automated repricing rules
- Edit listing details (title, condition, etc.)
- Reprice by category/tag
- Historical price tracking
- Dry-run testing before applying

**Result:**
- Time saved: 80% faster pricing decisions
- Better prices: Data-driven instead of manual guessing
- Scalable: Set rules once, auto-maintain pricing
- Visibility: Know exactly where you stand vs competitors

---

## Questions for You

Before I start building Priority 1-4, clarify:

1. **Price Refresh Frequency:**
   - Currently competitor data is fetched daily via cron
   - Do you want manual refresh button on Pricing Insights?
   - Or daily automatic updates?

2. **Repricing Aggressiveness:**
   - For "Beat Lowest" strategy, what % discount is comfortable?
   - Do you want floor prices to prevent race-to-bottom?
   - Example: Never go below $10? Or category-specific floors?

3. **COGS Integration (for Later):**
   - When you import COGS, should suggested prices factor in margins?
   - Example: If COGS=$30, min price = $30 + 30% markup?
   - Or always match market avg regardless of COGS?

4. **Auto-Reprice Preferences:**
   - Should it only reprice if > 5% above market?
   - Or more aggressive (> 2% above market)?
   - Day/time preference for cron job?

---

## Next Steps

1. **Confirm priorities** - Should I start with Pricing Insights table?
2. **Clarify design** - Rows vs table format? Columns order?
3. **API endpoints** - Do competitor_prices table have current data?
4. **Testing** - Can I test price updates in sandbox eBay first?

Ready to build! Just let me know which piece to start with.
