# Listing Management & Analytics Architecture
**Last Updated:** March 29, 2026

## Overview
This document maps the listing management and analytics functions and how they integrate with the core app. These functions handle post-publishing operations: tracking performance, optimizing prices, managing inventory, and providing business intelligence.

---

## Part 1: Core Management Functions

### 1. **ebay-listings** (Edge Function)
**Purpose:** Fetch all active eBay listings with multi-window analytics  
**Invoked By:** Dashboard, Analytics pages, Cron jobs, Other functions  
**Type:** Lightweight HTTP GET  

#### Inputs
```typescript
// Query params or Bearer token (user's eBay token via x-supabase-auth-token)
// No body needed - fetches all active listings for authenticated user
```

#### Outputs
```typescript
{
  listings: [
    {
      listingId: string;
      offerId: string | null;      // null for legacy Trading API listings
      sku: string;
      title: string;
      price: number;
      categoryId?: string;
      
      // Multi-window analytics (7d / 30d / 90d)
      analytics: {
        "7d": { views, impressions, ctr, conversionRate, transactions };
        "30d": { ... };
        "90d": { ... };
      }
      
      // Derived metrics
      trend: "hot" | "stable" | "stale";
      lastUpdated: timestamp;
    }
  ]
}
```

#### How It Works
1. Calls eBay Inventory API → `GET /listing` for active offers (Inventory listings)
2. Calls eBay Analytics API → `GET /sell/analytics/v1/traffic_report` for each window (7d, 30d, 90d)
3. Calculates trend based on view velocity
4. Returns deduplicated, enriched listing objects
5. **Caching:** eBay responses cached 15-30 min per user to reduce API calls

#### Key Dependencies
- eBay user access token
- Inventory API (for active listings)
- Analytics API (for performance metrics)

---

### 2. **ebay-reprice** (Edge Function)
**Purpose:** Update prices on eBay listings (single or bulk)  
**Invoked By:** UI, auto-reprice-cron, optimize-listing  
**Type:** HTTP POST  

#### Inputs
```typescript
// Action 1: Single Update
{
  action: "single_update";
  offerId?: string;           // Inventory API offer ID
  sku: string;                // Required for Inventory API
  listingId?: string;         // Required for Trading API (legacy)
  newPrice: number;
  currency?: string;          // default: "USD"
}

// Action 2: Bulk Update
{
  action: "bulk_update";
  updates: [
    { offerId?, sku, listingId?, newPrice, currency? }
  ]
}
```

#### Outputs
```typescript
// Single Update Response
{
  success: boolean;
  offerId?: string;
  error?: string;
}

// Bulk Update Response
{
  success: boolean;
  results: [
    { sku, offerId?, success, statusCode?, error? }
  ]
}
```

#### How It Works
1. **Inventory API Listings** (with offerId + sku):
   - Calls eBay `POST /inventory/v1/offer/{offerId}/update_price_quantity`
   - Batches up to 25 items per call
   - Returns per-item status codes (200 = success)

2. **Legacy Trading API Listings** (with listingId, no offerId):
   - Calls eBay `ReviseFixedPriceItem` XML-based Trading API
   - Updates single listing at a time
   - Returns success/failure flag

3. **Error Handling:**
   - Validates price > 0
   - Handles rate limits with exponential backoff
   - Logs all updates to `ebay_reprice_log` table

#### Key Dependencies
- eBay user access token
- Inventory API **OR** Trading API (auto-detect via offerId)
- SKU or ListingId present

---

### 3. **auto-reprice-cron** (Edge Function - Scheduled)
**Purpose:** Automatically apply reprice rules to user listings  
**Scheduled:** Daily (configurable)  
**Invoked By:** Supabase Cron  
**Type:** Background job  

#### Inputs (if manual trigger)
```typescript
{
  userId?: string;          // If provided, process only this user
  dryRun?: boolean;         // If true, don't apply changes
  listingIds?: string[];    // If provided, only process these listings
}
```

#### Outputs
```typescript
{
  success: boolean;
  dryRun: boolean;
  processed: number;        // count of listings processed
  results: [
    {
      listingId: string | null;
      title: string;
      oldPrice: number;
      newPrice: number;
      ruleApplied: string;  // rule name
      ruleType: "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";
      applied: boolean;
      error?: string;
    }
  ]
}
```

#### How It Works
**CRON Flow:**
1. Queries `reprice_rules` table for all users with `is_enabled=true`
2. For each user:
   - Fetches active listings via **ebay-listings**
   - Gets reprice rules from DB (filtered by user + enabled)
   - For each listing:
     - Fetches market data via **keyword-research** (active/sold prices)
     - Applies matching rule logic:
       - `match_lowest`: Set to lowest competitor price (with floor/ceiling)
       - `beat_lowest`: Set 5% below lowest (apply adjustment_pct)
       - `match_avg`: Set to average competitor price
       - `match_sold_avg`: Set to average sold price
     - Calls **ebay-reprice** to update eBay
     - Logs to `optimization_history` table

**Rule Matching Logic:**
```
FOR each rule in enabled_rules:
  IF rule.category_filter AND listing.categoryId != rule.category_filter:
    SKIP
  
  market_data = fetch_keyword_research(listing.title);
  
  IF rule.rule_type == "match_lowest":
    new_price = market_data.minActivePrice ?? market_data.avgActivePrice
  ELSE IF rule.rule_type == "beat_lowest":
    new_price = (market_data.minActivePrice * (1 - rule.adjustment_pct / 100)) ?? original_price
  ELSE IF rule.rule_type == "match_avg":
    new_price = market_data.avgActivePrice ?? market_data.avgSoldPrice
  ELSE IF rule.rule_type == "match_sold_avg":
    new_price = market_data.avgSoldPrice ?? market_data.avgActivePrice
  
  // Apply floor/ceiling
  new_price = clamp(new_price, rule.floor_price, rule.ceiling_price)
  
  IF new_price != listing.price:
    apply_reprice_update(listing, new_price)
```

**DB Schema - reprice_rules:**
```sql
CREATE TABLE reprice_rules (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  rule_name text,
  rule_type text, -- 'match_lowest', 'beat_lowest', 'match_avg', 'match_sold_avg'
  adjustment_pct numeric, -- for beat_lowest: 5 = 5% below
  floor_price numeric,    -- minimum allowed price
  ceiling_price numeric,  -- maximum allowed price
  category_filter text,   -- optional: only apply to this eBay category
  is_enabled boolean DEFAULT true,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE optimization_history (
  id uuid PRIMARY KEY,
  user_id uuid,
  listing_id text,
  listing_title text,
  optimization_type text, -- 'reprice_rule', 'title_suggestion', etc.
  old_value text,
  new_value text,
  reasoning text,
  applied_by text, -- 'auto', 'manual', 'user'
  result text,     -- 'accepted', 'pending', 'rejected'
  created_at timestamp
);
```

#### Rate Limits & Safety
- Processes max 20 listings per user per run (to avoid API throttling)
- Throttles market data fetches (keyword-research has 4h cache)
- Dry run mode available for testing
- All changes logged to `optimization_history`

#### Key Dependencies
- **ebay-listings** (fetch active listings)
- **keyword-research** (fetch market data)
- **ebay-reprice** (apply price updates)
- `reprice_rules` table
- User eBay token

---

### 4. **optimize-listing** (Edge Function)
**Purpose:** On-demand analysis & optimization suggestions for single listing  
**Invoked By:** UI (Optimize button), Manual trigger  
**Type:** HTTP POST  

#### Inputs
```typescript
{
  listingId: string;
  title: string;
  currentPrice: number;
  categoryId?: string;
  description?: string;
  condition?: string;
}
```

#### Outputs
```typescript
{
  listingId: string;
  opportunityScore: number;  // 0-100
  flags: [
    {
      type: "price" | "title" | "description" | "images" | "category";
      severity: "low" | "medium" | "high";
      message: string;
    }
  ];
  
  priceSuggestion: {
    suggestedPrice: number | null;
    reasoning: string;
    direction: "raise" | "lower" | "keep";
    confidence: "high" | "medium" | "low";
    estimatedImpact: "High sales lift" | "10-15% boost" | "unknown";
  };
  
  titleSuggestion?: {
    suggestedTitle: string;
    reasoning: string;
    keywordsCovered: string[];
  };
  
  relatedCompetitors?: [
    { title, price, url, condition }
  ];
  
  nextSteps: string[];
}
```

#### How It Works
1. **Fetch Market Data:**
   - Calls **keyword-research** with listing title
   - Gets active prices, sold prices, competitor analysis

2. **Price Analysis:**
   - Compares current price vs market avg/min/max
   - Flags if price is outlier (too high/low)
   - Suggests adjustment with confidence level

3. **Title Analysis:**
   - Extracts keywords from title
   - Compares vs competitor titles
   - Identifies missing high-volume keywords
   - Can suggest improved title (if AI enhancement enabled)

4. **Opportunity Scoring:**
   ```
   score = 0
   IF price_outlier: score += 25
   IF missing_keywords: score += 20
   IF poor_condition_text: score += 15
   IF images_missing: score += 15
   IF category_mismatch: score += 10
   ```

5. **Logs to optimization_history** with `optimization_type='optimization_suggestion'`

#### Key Dependencies
- **keyword-research** (market data)
- **ebay-competitor-search** (optional: competitor details)
- Gemini AI (optional: title/description enhancement)

---

### 5. **keyword-research** (Edge Function)
**Purpose:** Analyze market demand & competition for a keyword/title  
**Invoked By:** optimize-listing, auto-reprice-cron, market-watch-refresh, UI  
**Type:** HTTP POST  
**Cache:** 4h per query  

#### Inputs
```typescript
{
  query: string;          // search keyword or listing title
  categoryId?: string;    // optional: narrow to eBay category
}
```

#### Outputs
```typescript
{
  query: string;
  prices: {
    minActivePrice: number | null;
    maxActivePrice: number | null;
    avgActivePrice: number | null;
    medianActivePrice: number | null;
  };
  sold: {
    avgSoldPrice: number | null;
    minSoldPrice: number | null;
    maxSoldPrice: number | null;
    medianSoldPrice: number | null;
    soldCount: number;
  };
  competition: {
    activeCount: number;        // # listings with query
    soldVolume: number;         // # sold in last 90d
    demandRatio: number;        // sold / active
    turnover: number;           // avg days to sell
  };
  topItems: [
    {
      title: string;
      price: number;
      condition: string;
      seller: string;
    }
  ];
  cached: boolean;              // true if from 4h cache
  cachedAt?: timestamp;
}
```

#### How It Works
1. Check Redis cache for this query (4h TTL)
   - If hit, return cached result
   
2. Call eBay Browse API:
   - `GET /buy/browse/v1/item_summary/search`
   - Filters: active listings only
   - Returns top 50 items with prices

3. Call eBay Find API (or Analytics):
   - `findCompletedItems` → sold listings
   - Extracts sold prices + timestamps

4. Calculate metrics:
   - Count active listings
   - Average/median prices
   - Sold volume (last 90d)
   - Demand ratio

5. **Cache in Redis** with 4h TTL

**DB Schema - keyword_cache:**
```sql
CREATE TABLE keyword_cache (
  id uuid PRIMARY KEY,
  query text,
  category_id text,
  min_active_price numeric,
  avg_active_price numeric,
  sold_count integer,
  avg_sold_price numeric,
  external_id text, -- hash of query+category for dedup
  cached_at timestamp,
  expires_at timestamp
);
```

#### eBay API Limits
- Browse API: ~5,000 calls/day per app
- Each keyword-research call = 2 Browse API calls (active + sold)
- **Mitigation:** 4h cache prevents duplicate queries

#### Key Dependencies
- eBay Browse API
- eBay Finding API (or Analytics API)
- eBay app token (client credentials flow)

---

## Part 2: Analytics & Reporting Functions

### 6. **cogs-report** (Edge Function)
**Purpose:** Generate Cost of Goods Sold report for sold items  
**Invoked By:** Analytics page, Profit Report page  
**Type:** HTTP POST  

#### Inputs
```typescript
{
  userToken: string;  // eBay user token
  startDate?: string; // ISO 8601
  endDate?: string;   // ISO 8601
}
```

#### Outputs
```typescript
{
  period: { start, end };
  summary: {
    totalOrders: number;
    totalRevenue: number;
    totalCOGS: number;
    grossProfit: number;
    profitMargin: number;
  };
  byListing: [
    {
      sku: string;
      title: string;
      sold: number;
      revenue: number;
      cogs: number;
      profitPerUnit: number;
    }
  ];
  topProfitable: [ ... ];  // top 10 by profit
  lowestMargin: [ ... ];   // listings with margin < 10%
}
```

#### How It Works
1. Authenticates user and determines user ID
2. Queries eBay Fulfillment API → `GET /order/v2/orders` for sold orders
   - Filters by date range (startDate..endDate)
   - Extracts: order total, item title, quantity, SKU

3. For each order item:
   - Looks up `listing_cogs` DB table for COGS cost
   - If not found, uses default COGS (if set in profile)
   - Calculates profit = revenue - COGS

4. Aggregates by listing (SKU)

5. Returns summary + per-listing breakdown

**DB Schema - listing_cogs:**
```sql
CREATE TABLE listing_cogs (
  id uuid PRIMARY KEY,
  user_id uuid,
  sku text,
  listing_title text,
  cost_per_unit numeric,
  created_at timestamp,
  updated_at timestamp,
  UNIQUE(user_id, sku)
);

CREATE TABLE profiles (
  ...
  default_cogs numeric DEFAULT 0,
  ...
);
```

#### Key Dependencies
- eBay user token
- Fulfillment API
- `listing_cogs` table
- User profile (default COGS fallback)

---

### 7. **market-watch-refresh** (Edge Function)
**Purpose:** Update market watch snapshot for tracked keywords/categories  
**Invoked By:** User manual trigger, market-watch-cron  
**Type:** HTTP POST  

#### Inputs
```typescript
{
  watchId: string;   // ID from market_watches table
  userId: string;
}
```

#### Outputs
```typescript
{
  watchId: string;
  query: string;
  refreshedAt: timestamp;
  snapshot: {
    activeCount: number;
    avgPrice: number;
    prices: { min, max, avg };
    sold: { count, avgPrice };
  };
  history: [
    { date, avgPrice, activeCount, trend }
  ];
}
```

#### How It Works
1. Fetches watch config from `market_watches` table
   - Contains: user's saved search query, category filter, alert thresholds

2. Calls **keyword-research** with query + categoryId

3. Updates `market_watches` row with new snapshot

4. Inserts row into `market_price_history` table for trend tracking

5. Checks if price dropped below user's alert threshold:
   - If yes, creates notification
   - Sends email/in-app alert

**DB Schema - market_watches:**
```sql
CREATE TABLE market_watches (
  id uuid PRIMARY KEY,
  user_id uuid,
  query text,
  category_id text,
  alert_price_threshold numeric,
  last_refreshed timestamp,
  latest_avg_price numeric,
  latest_active_count integer,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE market_price_history (
  id uuid PRIMARY KEY,
  watch_id uuid,
  avg_price numeric,
  median_price numeric,
  min_price numeric,
  max_price numeric,
  active_count integer,
  sold_count integer,
  recorded_at timestamp
);

CREATE TABLE market_notifications (
  id uuid PRIMARY KEY,
  user_id uuid,
  watch_id uuid,
  alert_type text, -- 'price_drop', 'price_rise', 'volume_change'
  threshold_value numeric,
  current_value numeric,
  message text,
  read boolean DEFAULT false,
  created_at timestamp
);
```

#### Key Dependencies
- **keyword-research** (fetch market data)
- `market_watches` table
- `market_price_history` table

---

### 8. **market-watch-cron** (Scheduled Cron Job)
**Purpose:** Refresh all user market watches daily  
**Scheduled:** Daily (~2am UTC)  
**Invoked By:** Supabase Cron  
**Type:** Background job  

#### How It Works
1. Reads all rows from `market_watches` where `last_refreshed < now() - 24h`
2. For each watch:
   - Calls **market-watch-refresh**
   - Throttles with 500ms delay (eBay rate limit compliance)
3. Batch size: max 50 watches per run to stay under API limits

---

## Part 3: Billing & Portal Functions

### 9. **customer-portal** (Edge Function)
**Purpose:** Create Stripe billing portal link  
**Invoked By:** Account settings, Billing page  
**Type:** HTTP POST  

#### Inputs
```typescript
{
  // Authenticated user via Bearer token
}
```

#### Outputs
```typescript
{
  portalUrl: string;  // Stripe-hosted billing portal URL
  expiresAt: timestamp;
}
```

#### How It Works
1. Authenticates user via JWT token
2. Looks up `stripe_customer_id` from profiles table
   - Falls back to email search in Stripe if not cached
3. Creates Stripe billing portal session:
   ```typescript
   const session = await stripe.billingPortal.sessions.create({
     customer: customerId,
     return_url: "https://app.listingassistantpro.com/dashboard",
   });
   ```
4. Returns portal URL

#### Key Dependencies
- Stripe API
- User authentication
- `profiles.stripe_customer_id` (cache)

---

## Part 4: Integration Map

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER DASHBOARD                              │
│  Shows: Listings | Analytics | Profit | Market Insights           │
└────────────────┬────────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
    ┌───▼────┐      ┌─────▼──────┐
    │ ebay-  │      │ cogs-      │
    │listings │      │ report     │
    └───┬────┘      └──────▲─────┘
        │                  │
        │          ┌───────┴─────────┐
        │          │                 │
        │      ┌──▼──────┐    ┌──────▼──┐
        │      │ ebay    │    │listing   │
        │      │Fulfillment API│ cogs  │
        │      └─────────┘    └────────┘
        │
    ┌───┴─────────────────────────────────┐
    │                                     │
┌───▼───────────┐  ┌────────────────┐  ┌─▼────────────┐
│ optimize-     │  │ auto-reprice-  │  │keyword-      │
│ listing       │  │ cron (daily)   │  │research      │
└───┬───────────┘  └─────┬──────────┘  └─▼────────────┘
    │                    │                │
    │          ┌─────────┴────┐          │
    │          │              │          │
┌───▼──────────▼───┐    ┌─────▼─────┐  ┌┴──────────────┐
│ ebay-reprice    │    │ ebay-      │  │ eBay Browse API
│(single/bulk)    │    │ listings   │  │ eBay Finding API
└────────┬────────┘    └──────┬─────┘  └────────┬──────┘
         │                   │                  │
         │                   │                  │
    ┌────▼──────────────────▼──────────────────▼────┐
    │           eBay Inventory / Trading API        │
    │   • updateOffer (Inventory API)              │
    │   • ReviseFixedPriceItem (Trading API)       │
    │   • Get Active Listings                      │
    │   • Get Analytics Data                       │
    │   • Get Sold Orders (Fulfillment)           │
    └────────────────────────────────────────────────┘
    
┌─────────────────────────────────────────────────────┐
│              BACKGROUND CRON JOBS                   │
│  • auto-reprice-cron (daily)                       │
│  • market-watch-cron (daily)                       │
│  • competitor-prices-cron (daily)                  │
│  • cost-alert-cron (optional)                      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│          MARKET INTELLIGENCE SUBSYSTEM              │
│                                                     │
│  market-watch-refresh → keyword-research           │
│         ↓                                           │
│  market_watches, market_price_history              │
│         ↓                                           │
│  market_notifications (user alerts)                │
└─────────────────────────────────────────────────────┘
```

---

## Part 5: Database Schema (Unified)

### Tables Referenced Across Functions

```sql
-- ========== CORE LISTINGS ==========

CREATE TABLE listings (
  id uuid PRIMARY KEY,
  user_id uuid,
  ebay_listing_id text,
  ebay_offer_id text,
  sku text,
  title text,
  price numeric,
  category_id text,
  status text,
  created_at timestamp,
  updated_at timestamp
);

-- ========== PRICING & REPRICING ==========

CREATE TABLE reprice_rules (
  id uuid PRIMARY KEY,
  user_id uuid,
  rule_name text,
  rule_type text, -- 'match_lowest', 'beat_lowest', 'match_avg', 'match_sold_avg'
  adjustment_pct numeric,
  floor_price numeric,
  ceiling_price numeric,
  category_filter text,
  is_enabled boolean DEFAULT true,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE optimization_history (
  id uuid PRIMARY KEY,
  user_id uuid,
  listing_id text,
  listing_title text,
  optimization_type text, -- 'reprice_rule', 'title_suggestion', 'optimization_suggestion'
  old_value text,
  new_value text,
  reasoning text,
  applied_by text, -- 'auto', 'manual', 'user'
  result text,     -- 'accepted', 'pending', 'rejected'
  created_at timestamp
);

-- ========== COST & PROFIT ==========

CREATE TABLE listing_cogs (
  id uuid PRIMARY KEY,
  user_id uuid,
  sku text,
  listing_title text,
  cost_per_unit numeric,
  created_at timestamp,
  updated_at timestamp,
  UNIQUE(user_id, sku)
);

-- ========== MARKET INTELLIGENCE ==========

CREATE TABLE market_watches (
  id uuid PRIMARY KEY,
  user_id uuid,
  query text,
  category_id text,
  alert_price_threshold numeric,
  last_refreshed timestamp,
  latest_avg_price numeric,
  latest_active_count integer,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE market_price_history (
  id uuid PRIMARY KEY,
  watch_id uuid,
  avg_price numeric,
  median_price numeric,
  min_price numeric,
  max_price numeric,
  active_count integer,
  sold_count integer,
  recorded_at timestamp
);

CREATE TABLE market_notifications (
  id uuid PRIMARY KEY,
  user_id uuid,
  watch_id uuid,
  alert_type text, -- 'price_drop', 'price_rise', 'volume_change'
  threshold_value numeric,
  current_value numeric,
  message text,
  read boolean DEFAULT false,
  created_at timestamp
);

CREATE TABLE keyword_cache (
  id uuid PRIMARY KEY,
  query text,
  category_id text,
  min_active_price numeric,
  avg_active_price numeric,
  sold_count integer,
  avg_sold_price numeric,
  external_id text,
  cached_at timestamp,
  expires_at timestamp
);

-- ========== ANALYTICS SNAPSHOTS ==========

CREATE TABLE listing_analytics_snapshot (
  id uuid PRIMARY KEY,
  listing_id text,
  user_id uuid,
  window text, -- '7d', '30d', '90d'
  views integer,
  impressions integer,
  ctr numeric,
  conversion_rate numeric,
  transactions integer,
  recorded_at timestamp
);

-- ========== COMPETITOR DATA ==========

CREATE TABLE competitor_prices (
  id uuid PRIMARY KEY,
  user_listing_id text,
  competitor_title text,
  competitor_price numeric,
  competitor_condition text,
  seller_username text,
  ebay_item_url text,
  found_at timestamp,
  expires_at timestamp
);
```

---

## Part 6: Control Flow Examples

### Scenario 1: User Enables Auto-Reprice

1. **User Action:** Navigates to Repricing Rules page, creates rule:
   ```
   "Electronics" category
   Rule Type: "Beat Lowest" 
   Adjustment: 5%
   Floor: $10
   Ceiling: $500
   ```

2. **UI Action:** Calls `POST /functions/v1/auto-reprice-cron` with `dryRun=true`
   - User sees preview: "What would update?"

3. **Cron Flow (daily at 2am UTC):**
   - Load all rules where `is_enabled=true`
   - For each user:
     - `ebay-listings` → fetch 20 active listings
     - For each listing in "Electronics":
       - `keyword-research` → market data (avg/min prices)
       - Apply rule: `newPrice = minPrice * 0.95`
       - Clamp to floor/ceiling
       - `ebay-reprice` → update on eBay
       - Log to `optimization_history`

4. **Result:** Price updated on eBay, history logged, user sees in dashboard

---

### Scenario 2: User Requests Listing Optimization

1. **User Action:** Clicks "Optimize" button on a listing

2. **UI Action:** Calls `POST /functions/v1/optimize-listing`
   ```json
   {
     "listingId": "335577822",
     "title": "Samsung Galaxy S21 Ultra 256GB Black",
     "currentPrice": 599.99,
     "categoryId": "15687"
   }
   ```

3. **Function Flow:**
   - `keyword-research` → fetch market data
     - Returns: minPrice=$499, avgPrice=$549, avgSoldPrice=$545
   - Price analysis: Current price is 9% above avg → room to reduce
   - Title analysis: Missing keywords? Compare vs competitor titles
   - Calculate opportunity score: 65/100 (price outlier)
   - Return suggestions:
     ```json
     {
       "priceSuggestion": {
         "suggestedPrice": 549.99,
         "direction": "lower",
         "reasoning": "9% above market avg. Reducing can increase sell velocity.",
         "confidence": "high"
       },
       "flags": [
         { "type": "price", "severity": "high", "message": "Overpriced vs market" }
       ]
     }
     ```

4. **User Action:** Clicks "Apply Suggestion"
   - Calls `ebay-reprice` to update price to $549.99
   - Logs to `optimization_history` with `applied_by='manual'`

---

### Scenario 3: Daily Cron Jobs

**Schedule (Supabase Cron):**
```
auto-reprice-cron:       0 2 * * * (daily 2am UTC)
market-watch-cron:       0 3 * * * (daily 3am UTC)
competitor-prices-cron:  0 4 * * * (daily 4am UTC)
```

**Each job independently:**
- Fetches all active users/watches
- Calls leaf functions in parallel (with throttling)
- Logs results
- Sends alerts if thresholds exceeded

---

## Part 7: API Rate Limits & Optimization

### eBay API Rate Limits

| API | Limit | Usage |
|-----|-------|-------|
| Browse API | ~5,000/day | keyword-research (2 calls per query) |
| Analytics API | ~5,000/day | ebay-listings (1-3 calls per user) |
| Inventory API | ~500/day bulk ops | ebay-reprice (batches of 25) |
| Trading API | ~5,000/day | ReviseFixedPriceItem (legacy listings) |
| Fulfillment API | ~1,000/day | cogs-report (order fetches) |

### Optimization Strategies

1. **keyword-research**: 4h Redis cache
   - Prevents duplicate market data fetches
   - Serves cached results for same query

2. **ebay-listings**: 15-30min cache per user
   - Analytics API data expensive to fetch
   - Reuse within session

3. **Batch Operations**:
   - ebay-reprice: Group by SKU, batch 25/call
   - auto-reprice-cron: Process max 20 listings/user/run
   - market-watch-cron: Max 50 watches/run

4. **Throttling**:
   - 500ms delay between market-watch refreshes
   - 30s timeout on eBay API calls
   - Exponential backoff on 429 (rate limit) responses

---

## Part 8: Future Enhancements

### Planned Features (Future PRs)

1. **title-optimizer** - AI-powered title suggestions
2. **image-scorer** - Analyze image quality
3. **bulk-reprice** - Extend ebay-reprice for mass updates
4. **ebay-relist** - End and recreate listings with new pricing
5. **cost-alert-cron** - Alert when item COGS changes significantly
6. **health-scorer** - Listing quality/conversion potential scoring
7. **duplicate-detector** - Find duplicate listings by title + SKU

---

## Part 9: Testing & Debugging

### Manual Testing Endpoints

```bash
# Test ebay-listings
curl -X GET https://listing-assistant-pro.supabase.co/functions/v1/ebay-listings \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "x-supabase-auth-token: $EBAY_USER_TOKEN"

# Test keyword-research  
curl -X POST https://listing-assistant-pro.supabase.co/functions/v1/keyword-research \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "Samsung Galaxy S21", "categoryId": "15687"}'

# Test optimize-listing
curl -X POST https://listing-assistant-pro.supabase.co/functions/v1/optimize-listing \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"listingId": "335577822", "title": "Item", "currentPrice": 99.99}'

# Test auto-reprice-cron (dry run)
curl -X POST https://listing-assistant-pro.supabase.co/functions/v1/auto-reprice-cron \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-uuid", "dryRun": true}'

# Test ebay-reprice
curl -X POST https://listing-assistant-pro.supabase.co/functions/v1/ebay-reprice \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "x-supabase-auth-token: $EBAY_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "single_update", "sku": "ABC123", "offerId": "123456", "newPrice": 49.99}'
```

---

## Part 10: Summary

### Function Interdependencies

```
┌─ Market Intelligence Loop ─┐
│                            │
│  keyword-research ←────┐   │
│         ↑              │   │
│         │         market-watch-refresh
│  ┌──────┴────────────────┤
│  │                       │
│  │  auto-reprice-cron    │
│  │  optimize-listing     │
│  │                       │
│  └──────┬────────────────┤
│         │                │
│    ebay-reprice ────────┐│
│         │               ││
│    ebay-listings ←──────┘│
│                          │
└──────────────────────────┘

┌─ Reporting Loop ──────────┐
│                           │
│  ebay-listings            │
│         ↓                 │
│  cogs-report              │
│         ↓                 │
│  Profit Dashboard         │
│                           │
└───────────────────────────┘

┌─ Billing Loop ────────────┐
│                           │
│  customer-portal          │
│         ↓                 │
│  Stripe Portal            │
│                           │
└───────────────────────────┘
```

### Key Takeaways

1. **Decoupled Architecture**: Each function is independent, can be invoked separately or as part of larger flows

2. **Cron Jobs Drive Automation**: Daily background jobs handle repricing, market watches, competitor tracking

3. **Caching Everywhere**: keyword-research, ebay-listings cache results to stay under eBay API limits

4. **Rate Limit Safe**: Batching, throttling, and caching prevent API abuse

5. **Audit Trail**: All optimization decisions logged to `optimization_history` for transparency

6. **User Control**: Dry run mode, manual triggers, rule-based configuration give users full control

---

**Next Steps:**
- Implement UI pages for Reprice Rules management
- Build Optimization History dashboard
- Add Market Watch pages
- Create Profit Reporting views
- Set up daily cron job scheduling
