# Views Tracking & Display Analysis

## Overview
Views tracking in this application is **real-time and not persisted** to the database. Views data is fetched directly from eBay APIs on-demand when the dashboard loads, rather than being stored in a local database table.

---

## 1. How Views Are Tracked/Stored

### Database Tables
**Views are NOT stored in any database table.** The system fetches live data from eBay APIs instead.

### Related Database Tables
- **`drafts`** table: Stores draft listings but NOT analytics data
  - Contains: `ebay_listing_id`, `published_at`, `publish_status`, etc.
  - Does NOT have columns for views, impressions, or other analytics
  
- **`competitor_prices`** table: Stores competitor pricing data (separate feature)
  - Contains pricing aggregates but NOT views data

### Data Flow
```
eBay Analytics API (real-time)
         ↓
    ebay-listings Edge Function
         ↓
    DashboardPage.tsx (state)
         ↓
    Components (filtered/sorted/displayed)
```

---

## 2. Where Views Are Displayed

### Primary Display Location: DashboardPage.tsx
**Path:** [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx)

#### Component: **ViewsTrendRow**
- **Lines:** [189-241](src/pages/DashboardPage.tsx#L189)
- **Purpose:** Displays 7d, 30d, 90d views breakdown for each listing
- **Shows:**
  - 7-day views
  - 30-day views  
  - 90-day views
  - Trend arrow (up/down/stable based on daily pace)

#### Main Dashboard Stats Section
- **Lines:** [792-839](src/pages/DashboardPage.tsx#L792-839)
- **Shows:** Aggregated totals
  - `totalViews30d` - main display (large font, prominent)
  - `totalViews7d` - secondary breakdown
  - `totalViews90d` - tertiary breakdown
- **Access:** Pro/Shop tier only (`planFeatures.hasListingAnalytics`)

#### Listing Row Stats
- **Lines:** [1144-1160](src/pages/DashboardPage.tsx#L1144-1160)
- **Shows:** ViewsTrendRow appears inline for each listing (Pro/Shop only)

#### Filtering Section
- **Lines:** [1023-1037](src/pages/DashboardPage.tsx#L1023-1037)
- **Features:**
  - Filter by "Zero views" (max views = 0)
  - Filter by "Has views" (min views = 1)
  - Min/max views range input fields

---

## 3. How Views Are Fetched & Displayed

### Fetch Process

#### Step 1: DashboardPage Initialization
**Location:** [src/pages/DashboardPage.tsx, lines 550-620](src/pages/DashboardPage.tsx#L550-620)

```tsx
const fetchListings = useCallback(async () => {
  // 1. Get eBay token from function or localStorage
  const token = await getStoredEbayToken();
  
  // 2. Call ebay-listings edge function
  const { data } = await supabase.functions.invoke("ebay-listings", {
    body: { userToken: token },
  });
  
  // 3. Set listings with analytics data
  setListings(data.listings);
}, []);

// Called on component mount
useEffect(() => { fetchListings(); }, []);
```

**When:** Called on component mount and via refresh button

#### Step 2: Edge Function: `ebay-listings`
**Path:** [supabase/functions/ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts)

**Responsibilities:**
1. Fetch inventory items from eBay Inventory API or Trading API
2. Fetch analytics for 7d, 30d, 90d windows **in parallel**
3. Merge analytics data with listing metadata
4. Return combined response

### Data Fetch Flow

#### Flow 1: Main Path (eBay Inventory API + Analytics)
```
1. Fetch offers from /sell/inventory/v1/offer?limit=100
   ↓
2. Fetch inventory details for each offer
   ↓
3. Fetch watch/question counts via Trading API GetItem
   ↓
4. Fetch Analytics (parallel):
   - fetchAnalyticsForWindow(7 days)
   - fetchAnalyticsForWindow(30 days)
   - fetchAnalyticsForWindow(90 days)
   ↓
5. Merge analytics onto listings
   ↓
6. Return combined response
```

#### Flow 2: Fallback Path (Trading API only)
- Used if Inventory API returns 400 with SKU error
- Still fetches all three analytics windows

### Analytics Fetching Details

**Functions:** [Lines 54-94 in ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts#L54-94)

```typescript
async function fetchAnalyticsForWindow(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  days: number
): Promise<AnalyticsMap>
```

**eBay Analytics API Call:**
```
GET {apiBase}/sell/analytics/v1/traffic_report?
  dimension=LISTING&
  filter=date_range:[{startDate}..{today}]&
  metric=LISTING_VIEWS_TOTAL,LISTING_IMPRESSION_TOTAL,CLICK_THROUGH_RATE,SALES_CONVERSION_RATE,TRANSACTION
```

**Extracted Metrics:**
- `LISTING_VIEWS_TOTAL` → `views`
- `LISTING_IMPRESSION_TOTAL` → `impressions`
- `CLICK_THROUGH_RATE` → `clickThroughRate`
- `SALES_CONVERSION_RATE` → `salesConversionRate`
- `TRANSACTION` → `transactions`

**Returns:** Separate AnalyticsMap for each window (7d, 30d, 90d)

### Merging Analytics Data

**Function:** [Lines 123-153 in ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts#L123-153)

```typescript
function mergeAnalytics(
  listingId: string | null,
  sku: string,
  a7: AnalyticsMap,    // 7-day analytics
  a30: AnalyticsMap,   // 30-day analytics
  a90: AnalyticsMap    // 90-day analytics
)
```

**Result Structure:**
```typescript
{
  // 30d is primary for backward compat
  views: 100,
  impressions: 500,
  clickThroughRate: 0.20,
  salesConversionRate: 0.05,
  transactions: 5,
  
  // Per-window breakdowns
  views7d: 50,
  views30d: 100,
  views90d: 250,
  impressions7d: 200,
  impressions30d: 500,
  impressions90d: 1500,
  // ... etc for all metrics
}
```

---

## 4. EbayListing Type Definition

**Location:** [src/pages/DashboardPage.tsx, lines 37-62](src/pages/DashboardPage.tsx#L37-62)

```typescript
interface EbayListing {
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  
  // Primary (30d) analytics — backward compat
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
  
  // Multi-window breakdowns
  views7d: number;
  views30d: number;
  views90d: number;
  impressions7d: number;
  impressions30d: number;
  impressions90d: number;
  transactions7d: number;
  transactions30d: number;
  transactions90d: number;
  
  // Trading API stats
  watchCount: number;
  questionCount: number;
  
  // Metadata
  listingId: string | null;
  ebayUrl: string | null;
  categoryId?: string;
  quantity?: number;
  format?: string;
  condition?: string;
  listingDate?: string | null;
  competitor?: CompetitorPriceSnapshot | null;
}
```

---

## 5. Hooks & API Functions Handling Views Data

### useDrafts Hook
**Path:** [src/hooks/useDrafts.ts](src/hooks/useDrafts.ts)

**Note:** This hook fetches DRAFTS from database, NOT views/analytics data. Views are separate.

### Supabase Edge Function: `ebay-listings`
**Path:** [supabase/functions/ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts)

**Function Signature:**
```typescript
serve(async (req) => {
  // Input: { userToken: string }
  // Output: { listings: EbayListing[], needsAuth?: boolean, error?: string }
})
```

**Exports Views Data:**
- All listings include the complete analytics breakdown
- Called from DashboardPage every time dashboard loads or refresh is clicked
- Handles OAuth expiration and auth errors

### Supabase Edge Function: `ebay-user`
**Called alongside ebay-listings** to fetch account info (username, business name)

---

## 6. Views Data Processing on Dashboard

### Aggregation
**Location:** [Lines 711-713](src/pages/DashboardPage.tsx#L711-713)

```typescript
const totalViews30d = listings.reduce((sum, l) => sum + (l.views30d || 0), 0);
const totalViews7d = listings.reduce((sum, l) => sum + (l.views7d || 0), 0);
const totalViews90d = listings.reduce((sum, l) => sum + (l.views90d || 0), 0);
```

### Filtering
**Location:** [Lines 645-647](src/pages/DashboardPage.tsx#L645-647)

```typescript
const minV = parseFloat(filterMinViews);
const maxV = parseFloat(filterMaxViews);
if (!isNaN(minV)) list = list.filter((l) => l.views30d >= minV);
if (!isNaN(maxV)) list = list.filter((l) => l.views30d <= maxV);
```

### Sorting
**Location:** [Line 661](src/pages/DashboardPage.tsx#L661)

```typescript
else if (sortField === "views") cmp = a.views30d - b.views30d;
```

### Trend Analysis
**Location:** [Lines 86-120](src/pages/DashboardPage.tsx#L86-120)

**Trend Score Function:**
```typescript
function trendScore(l: EbayListing): number {
  const p7 = l.views7d / 7;    // Daily pace for 7d
  const p30 = l.views30d / 30;  // Daily pace for 30d
  const p90 = l.views90d / 90;  // Daily pace for 90d
  // Weighted score: recent pace matters most
  return p7 * 3 + p30 * 2 + p90;
}
```

**Trend Label Function:**
```typescript
function getTrend(l: EbayListing): "hot" | "stable" | "stale" | "new" {
  // "new": No analytics data
  // "hot": 7d pace 40%+ higher than 30d pace 🔥
  // "stale": 7d pace 40%+ lower than 30d pace 📉
  // "stable": Everything else
}
```

---

## 7. Permission & Feature Gate

### Views Display Restriction
**Location:** [Lines 800-812](src/pages/DashboardPage.tsx#L800-812)

Views are **only shown to Pro/Shop tier users:**

```typescript
{planFeatures.hasListingAnalytics ? (
  // Show views card with 7d/30d/90d breakdown
  <div className="bg-card border border-border rounded-xl p-4 space-y-1">
    {/* Views display */}
  </div>
) : (
  // Show upgrade prompt
  <p className="text-sm text-muted-foreground mt-1">
    Upgrade to Pro for listing analytics
  </p>
)}
```

### Per-Listing Views (ViewsTrendRow)
**Location:** [Line 1147](src/pages/DashboardPage.tsx#L1147)

```typescript
{planFeatures.hasListingAnalytics && <ViewsTrendRow listing={listing} />}
```

---

## 8. eBay API Endpoints Used

### eBay Analytics (Sell Analytics API)
```
GET /sell/analytics/v1/traffic_report?dimension=LISTING&filter=date_range:[{start}..{end}]&metric={metrics}
```
**Returns:** Traffic metrics for each listing in the date range

### eBay Inventory (Sell Inventory API)  
```
GET /sell/inventory/v1/offer?limit=100
GET /sell/inventory/v1/inventory_item/{sku}
```
**Returns:** Offers and inventory details

### eBay Trading (Trading API)
```
GetMyeBaySelling (XML) - Fallback if Inventory fails
GetItem (XML) - Get watch count & question count
```

---

## 9. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       DashboardPage.tsx                          │
│                       (React Component)                          │
└────────────────────┬────────────────────────────────────────────┘
                     │ useEffect + fetchListings()
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│           supabase.functions.invoke("ebay-listings")            │
│                   (Deno Edge Function)                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch user token (stored in Supabase)                        │
│ 2. Fetch eBay Offers via /sell/inventory/v1/offer              │
│ 3. Fetch Inventory details for each offer                       │
│ 4. Parallel analytics fetch:                                    │
│    - 7-day: /sell/analytics/v1/traffic_report (7d window)      │
│    - 30-day: /sell/analytics/v1/traffic_report (30d window)    │
│    - 90-day: /sell/analytics/v1/traffic_report (90d window)    │
│ 5. GetItem API calls for watchCount & questionCount            │
│ 6. Merge analytics onto offers                                 │
│ 7. Return combined listing array with views7d/30d/90d          │
└────────────────────┬────────────────────────────────────────────┘
                     │ Return EbayListing[] with analytics
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                   DashboardPage State                            │
│               state.listings: EbayListing[]                     │
├─────────────────────────────────────────────────────────────────┤
│ Each listing now has:                                           │
│  - views7d, views30d, views90d (main fields used)              │
│  - impressions7d/30d/90d                                       │
│  - transactions7d/30d/90d                                      │
│  - watchCount, questionCount                                   │
│  - clickThroughRate, salesConversionRate                       │
└────────────────────┬────────────────────────────────────────────┘
                     │ Filter, Sort, Aggregate
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Dashboard Rendering                           │
│                                                                 │
│ • Top Stats Section (totalViews7d/30d/90d)                     │
│ • Listings Table with ViewsTrendRow per listing                │
│ • Trend badges (🔥 Hot, 📉 Stale, — Stable)                   │
│ • Filterable by views range                                     │
│ • Sortable by views7d/30d/90d                                  │
│ • Click-through rate, sales conversion rate display            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Key Findings Summary

| Aspect | Details |
|--------|---------|
| **Storage** | NOT stored in DB; fetched live from eBay APIs on-demand |
| **Update Frequency** | On dashboard load / manual refresh button click |
| **Data Retention** | Only in browser memory (state); cleared on page reload |
| **Time Windows** | 7-day, 30-day, 90-day (all fetched in parallel) |
| **Primary Display** | DashboardPage.tsx |
| **Permission** | Pro/Shop tier only (`planFeatures.hasListingAnalytics`) |
| **Metrics** | Views, Impressions, Click-Through Rate, Sales Conversion Rate, Transactions, Watch Count, Question Count |
| **Backend** | `supabase/functions/ebay-listings/index.ts` (Deno-based edge function) |
| **Frontend Hook** | DashboardPage directly (not a separate hook) |
| **API Used** | eBay Sell Analytics API + Trading API GetItem |
| **Fallback** | Trading API if Inventory API fails |

---

## 11. Code Locations Quick Reference

| Function/Component | Path | Lines |
|------------------|------|-------|
| EbayListing Type | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L37-62) | 37-62 |
| ViewsTrendRow Component | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L189-241) | 189-241 |
| Views Stats Section | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L800-812) | 800-812 |
| fetchListings Function | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L550-620) | 550-620 |
| Trend Score & Label | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L86-120) | 86-120 |
| Filtering Logic | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L645-647) | 645-647 |
| Sorting Logic | [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L661) | 661 |
| Analytics Fetch | [supabase/functions/ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts#L54-94) | 54-94 |
| Analytics Merge | [supabase/functions/ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts#L123-153) | 123-153 |
| Edge Function Entry | [supabase/functions/ebay-listings/index.ts](supabase/functions/ebay-listings/index.ts#L350-400) | 350-400 |
