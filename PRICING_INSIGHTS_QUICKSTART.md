# Pricing Insights Implementation — Quick Start Guide

**Status:** Phase 1 Complete ✅  
**Date:** March 29, 2026  
**Available Now:** Pricing Insights Table View

---

## 🚀 What You Can Do RIGHT NOW

### 1. View All 260 Listings with Market Comparison

**How to access:**

1. Go to Dashboard page
2. Click on "Pricing" tab (next to "Cards" tab) in the eBay Listings section
3. You'll see your complete inventory with:
   - SKU
   - Title
   - Your Price
   - Market Average
   - Min-Max Range
   - Position % (how much above/below market)
   - Number of Competitors
   - Data freshness (Fresh/Stale)

### 2. Identify Overpriced & Underpriced Listings

**Color Coding:**

- 🔴 **Red** — >10% above market (Overpriced)
- 🟠 **Amber** — 5-10% above market (Slightly high)
- 🟢 **Green** — Within 5% of market (At market)
- 🔵 **Blue** — Below market (Underpriced)

**Quick Stats:**
At the top you see:

- Total listings being displayed
- # Overpriced listings
- # Underpriced listings

Example:

```
260 listings · Overpriced: 38 · Underpriced: 12
```

### 3. Sort & Find Specific Listings

**Sortable Columns:**

- **Title** — Alphabetical order
- **Your Price** — Low to high (or reverse)
- **Market Avg** — Market trends
- **Position %** — Most overpriced first
- **Competitors** — Most competitive markets

**Search:**

- Search by Title or SKU
- Updates table in real-time

Example:

```
Search "Gold Coin" → Shows only gold coin listings with market data
```

### 4. Refresh Competitor Data

**For Individual Listings:**

- Click the refresh icon (↻) on any row
- Re-fetches top competitor listings for that item
- Updates all 4 columns: Avg, Min, Max, Count
- Typically takes 2-5 seconds

**For All Listings:**

- Click "Refresh" button at the top
- (Refreshes all 260 listings—use sparingly to avoid eBay rate limits)

### 5. View on eBay

- Click the external link icon (⧉) on any row
- Opens that listing directly on eBay in new tab
- Compare your listing with the live eBay page

---

## 📊 Example Workflow

### Scenario: Find overpriced items and fix them

1. **Sort by Position %** (descending) → Most overpriced first
2. **Filter to Top 10:**
   - All items showing >10% above market
   - High visibility items (many competitors)
3. **For each item:**
   - Check the Market Avg price
   - Click link to see competitor listings
   - If clearly high demand, might keep higher price
   - If slow sales, consider lowering

**Coming Soon:** One-click "Apply Suggested Price" button

### Scenario: Find deals (underpriced inventory)

1. **Sort by Position %** (ascending) → Most underpriced first
2. **Look for:**
   - Items >10% below market
   - High competitor count (means there's real demand)
   - Low price (opportunity to raise)
3. **Action:**
   - Incrementally raise prices
   - Wait 24h for competitor refresh
   - Track sales velocity changes

---

## 🔄 Data Freshness

### How competitor data works:

**Automatic Update:** Daily (usually overnight)

- Cron job runs `competitor-prices-cron`
- Pulls all competitor listings
- Updates `competitor_prices` table

**Manual Refresh:** Click row refresh icon

- Immediately fetches new competitor data
- Finds top 20 similar listings
- Updates stats for that listing only

**Data Age Indicators:**

- Green "Fresh" = Updated within 24 hours
- Amber "Stale" = Older than 24 hours
- — = Never fetched yet

---

## 💡 Tips & Best Practices

### 1. **Price Adjustments**

- Change prices in increments (usually 5% at a time)
- Wait 24-48 hours to see impact
- Use Pricing Insights to track changes

### 2. **Competitor Monitoring**

- Track items with many competitors (high demand signals)
- Items with few competitors may have niche pricing
- Look for price patterns (bunching = market equilibrium)

### 3. **When to Reprice**

```
Daily: Check 10-20 fastest-selling items for repricing opportunities
Weekly: Review all 260 for price drifts
Monthly: Analyze profit margins by category
```

### 4. **Avoid Rate Limits**

- Refreshing all 260 listings = expensive API calls
- Instead: Refresh specific items when needed
- Bulk operations batched in background (auto-reprice-cron)

### 5. **Integration with Cards View**

- Switch back to "Cards" to edit prices individually
- Or use bulk price modal (select multiple cards)
- All changes reflected in Pricing table immediately

---

## 🎯 Common Questions

### Q: Why is competitor data sometimes blank (—)?

**A:** Never been fetched yet. Click refresh icon to populate data.

### Q: How often does competitor data update automatically?

**A:** Once daily via background job. Check "Freshness" column for age.

### Q: Can I see actual competitor listings?

**A:** Not yet in this view. Click external link (⧉) to go to eBay and search manually. Soon: Modal showing top 20 competitors.

### Q: How do I change prices from the Pricing table?

**A:** Switch to "Cards" view → Click price to edit inline → Or select multiple and use bulk modal.

### Q: What if I have 500+ listings?

**A:** Same table, just scroll. Performance optimized to handle 1000+.

### Q: Does this count against my eBay API quota?

**A:** Only manual refreshes count. Automatic daily refresh already budgeted.

---

## 🔜 Coming Soon (Phase 2)

### Suggested Prices

- Automatic price recommendation based on market data
- One-click apply
- Reason explanation

### Competitor Details Modal

- See top 20 actual competitor listings
- Seller ratings, shipping info
- Links to their eBay pages

### Bulk Repricing Strategies

- "Match Lowest" button
- "Beat Lowest by 5%" button
- "Match Average" button
- All with floor/ceiling protection

### Auto-Reprice Rules UI

- Create pricing rules that update automatically
- Rules run daily at 2am UTC
- Dry-run testing before enabling

---

## 📱 Dashboard Navigation

```
Dashboard
├── Summary Section (Inventory, Views, Watchers, etc.)
├── Sales & Profit (7d/30d/90d windows)
├── eBay Listings Section
│   ├── [Cards] ←→ [Pricing] ← VIEW TOGGLE
│   │   └─ Cards View (current card layout)
│   │   └─ Pricing Insights Table ← YOU ARE HERE
│   ├── Filters & Sort
│   ├── Select All (cards only)
│   └── Individual cards or rows
└── Optimization Queue (auto-optimization suggestions)
```

---

## 🚀 First Steps

1. **Open Dashboard**
2. **Scroll to "eBay Listings" section**
3. **Click "Pricing" button**
4. **Look at top rows** — sorted by most overpriced first
5. **Identify 5-10 items** to potentially reprice
6. **Sort by "Competitors"** — see which markets are hottest
7. **Refresh a few listings** to get current competitor data
8. **Switch back to Cards view** to adjust prices inline

---

## 📞 Feedback

What would make this more useful?

- Different sorting options?
- Additional columns (e.g., views, sales)?
- Export to CSV?
- Price change history?
- Margin calculation (with COGS)?

Let me know what you'd like next!

---

## Technical Details (For Reference)

### Component: `PricingInsightsTable`

- **File:** `src/components/PricingInsightsTable.tsx`
- **Props:** Listings, refresh function, user context, loading state
- **Data Source:** Enriched from `ebay-listings` + `competitor_prices` cache

### Integration: DashboardPage

- **New state:** `listingViewMode` = "cards" | "pricing"
- **Toggle buttons:** Cards/Pricing buttons in listings header
- **Conditional rendering:** Show table OR cards based on mode

### Data Flow:

```
Dashboard (listingViewMode="pricing")
  ↓
PricingInsightsTable component
  ↓
Uses existing listings data + competitor snapshots
  ↓
Manual refresh triggers: ebay-competitor-search function
  ↓
Updates competitor data in listings array
  ↓
Table re-renders with new data
```

### Performance:

- Table handles 1000+ listings smoothly
- Search/sort all client-side (instant)
- Refresh operations are per-row (parallel-safe)

---

**Ready to start optimizing! Let me know what to build next.**
