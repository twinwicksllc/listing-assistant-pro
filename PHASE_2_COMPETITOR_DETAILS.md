# Phase 2: AI-Powered Competitor Details — Implementation Complete ✅

## Overview

Your Competitor Details Modal now has **AI-powered intelligent filtering** that only shows truly comparable coins. No more comparing apples to oranges—an 1889-CC Morgan (Carson City, rare, expensive) won't appear alongside an 1889 Philly Morgan (common, cheap).

## What Changed

### For Free/Starter Tier Users

- **Price Stats Tab** (always available)
  - Aggregate market data: average, median, min, max prices
  - Price distribution chart showing where your price falls
  - "Updated X hours ago" indicator

### For Pro/Shop Tier Users (NEW 🎉)

- **Price Stats Tab** (same as above)
- **AI-Filtered Comparable Listings Tab** (NEW)
  - Up to 15 truly comparable coins from eBay
  - Each listing shows:
    - Title (clickable → opens eBay listing)
    - Price
    - Seller name + feedback rating
    - **Comparability Score** (75-100%, how similar to yours)
    - **Why it's comparable** (e.g., "Same 1889 Morgan, cert match")
    - Shipping info (free shipping badge if applicable)
  - Listings sorted by comparability score (best matches first)

## How AI Filtering Works

The system uses **Google Gemini AI** to be numismatically intelligent:

### Step 1: Analyze Your Listing

AI extracts key attributes from your listing title:

- **Year/Date** (e.g., 1889, 1921-S, 1949 Silver)
- **Country** (e.g., USA, Great Britain)
- **Denomination** (e.g., Morgan Dollar, Peace Dollar, Half Dollar)
- **Mint Mark** (e.g., S, D, CC, O, P → crucial for value!)
- **Grade** (e.g., MS-65, VF-20, circulated)
- **Certification** (e.g., PCGS, NGC, ANACS if present)
- **Special Features** (e.g., key date, rare variety, VAM number)

### Step 2: Fetch Raw Competitors

Searches eBay Finding API for ~20 generic "competitor" listings for the item type.

### Step 3: Score for True Comparability

For each competitor, Gemini scores 0-100:

**Examples:**

| Comparability        | Score | Your Coin                  | Competitor                 | Reason                        |
| -------------------- | ----- | -------------------------- | -------------------------- | ----------------------------- |
| Perfect Match        | 95    | 1889-CC Morgan, MS-65, NGC | 1889-CC Morgan, MS-65, NGC | Exact match                   |
| Highly Comparable    | 85    | 1889-CC Morgan, MS-65      | 1889-CC Morgan, MS-63      | Same date & mint, close grade |
| Not Really           | 40    | 1889-CC Morgan, MS-65      | 1889 Philly Morgan, XF-40  | Different mint + grade        |
| Completely Different | 5     | Peace Dollar, 1921         | Morgan Dollar, 1889        | Different coin type           |

**Key Decision Rules:**

- ❌ Different year/date = not comparable
- ❌ Different mint mark = not comparable (affects value significantly)
- ❌ Grade differs by more than 2-3 grades = not comparable
- ❌ Different coin type = not comparable
- ✅ Only scores 75+ are displayed (must be truly comparable)

### Step 4: Display Top 15

Shows the highest-scoring comparable listings, sorted best match first.

## Why This Matters for Collectibles

### Without AI Filtering (Bad ❌)

eBay's generic search returns: "Morgan Dollars"

- 1889 Philly Morgan, circulated, $25
- 1889-CC Morgan, MS-65, $800
- 1921-S Morgan, XF-40, $50
- Peace Dollar, 1921, AU-55, $60

Your 1889-CC MS-65 Morgan at $750 looks "above market" ($52 avg) → suggests lowering price ❌ WRONG!

### With AI Filtering (Smart ✅)

Only shows true 1889-CC Morgan comparables:

- 1889-CC Morgan, MS-65, PCGS, $795
- 1889-CC Morgan, MS-60, $650
- 1889-CC Morgan, MS-63, NGC, $720

Your price of $750 looks "at market" ($721 avg) → pricing is accurate ✅ CORRECT!

## Numismatic Nuances AI Understands

1. **Mint Marks Are Crucial**
   - 1941 Philadelphia = 137 million minted (common)
   - 1941-S San Francisco = 41 million minted (rarer)
   - 1941-D Denver = 33 million minted (rarest)
   - → Price can differ $50+ for identical grade

2. **Grade Matters Enormously**
   - MS-65 (Gem Mint) = near-perfect specimen
   - VF-20 (Very Fine) = worn but collectible
   - → Same coin might be $100 at MS-65, $15 at VF-20

3. **Key Dates Command Premiums**
   - 1955 Philadelphia Doubled Die penny = $1,000+
   - 1955 regular penny = $0.75
   - → Same date, same mint, huge price difference

4. **Certification Status Matters**
   - Certified (PCGS/NGC) = authenticated, slabbed
   - Raw/uncertified = buyer must verify
   - Certified often sells 20-30% higher

5. **Varieties & Errors**
   - 1804 Dollar (known as "The King of American Coins") = $7 million record
   - Varieties like VAM numbers (Morgan Dollar classification system)
   - AI can identify from listing titles

## Technical Details

### New Edge Function

**`filter-comparable-listings`** — Called when Pro/Shop user opens modal

```
Input: { title, categoryId, userId }
↓
Output: {
  comparable: [
    {
      itemId: "...",
      title: "...",
      price: 795,
      sellerInfo: { name, rating, ratingCount },
      url: "https://ebay.com/itm/...",
      comparabilityScore: 92,
      reason: "Same 1889-CC Morgan, MS-65, PCGS"
    },
    ...
  ],
  totalScored: 15,
  reason: "Analyzed 15 truly comparable listings..."
}
```

### Gemini Model

- **Model**: `gemini-flash-latest` (fast, cost-effective)
- **Temperature**: 0.1 for extraction, 0.2 for scoring (deterministic)
- **Cost**: ~0.5¢ per modal open (1-2 API calls)

### UI Components

- Tab switcher: "Price Stats" vs "Comparable Listings"
- Lock icon on comparable tab for Free/Starter tier
- Loading spinner while AI analyzes
- Interactive listing cards (click to view on eBay)

## Using the Feature

### As a Pro/Shop User

1. **Open Pricing Table** → Click "Pricing" tab in Dashboard
2. **Click Listing Details** → Opens CompetitorDetailsModal
3. **See Price Stats**
   - Market average shown
   - Your price positioning (below/at/above market)
   - Price distribution chart
4. **Switch to "Comparable Listings" Tab** (NEW)
   - AI filters eBay to show only truly comparable coins
   - Shows seller, rating, price, why it's comparable
   - Click listing to view on eBay
5. **Make Pricing Decision**
   - Are you priced right vs truly comparable items?
   - Can you price higher if your grade is better?
   - Can you lower if yours is lower grade?

## Testing Checklist

- [x] Component compiles without errors
- [x] Types are correct (TypeScript validation)
- [ ] Free tier user: Sees "Pro & Shop only" lock on comparable tab
- [ ] Pro tier user: Can see comparable listings tab
- [ ] Modal loads comparable listings on open
- [ ] Listings show correct seller info, ratings, shipping
- [ ] Click listing title → opens eBay in new tab
- [ ] Refresh button updates both price stats AND comparable listings
- [ ] Comparability scores make sense (high for similar, low for different)
- [ ] Reasons match the score (e.g., "Same 1889-CC Morgan" for 90+ score)
- [ ] Mobile responsiveness works (modal scrolls, tabs accessible)
- [ ] No AI errors if title is malformed

## Next Phase: Suggested Pricing

After competitor details is tested, Phase 2b will add:

**Suggested Pricing** — AI recommends optimal price based on:

- Filtered comparable listings (same as above)
- Your coin's position in market
- Seller ratings (higher-rated sellers can price 10% higher)
- Market trends
- Rarity factors

Example output:

> **Suggest: $765**
> Market average for 1889-CC Morgan MS-65: $745
> Your cert status (NGC) commands +2.7% premium
> Sellers with 98%+ ratings averaging +$15
> Current ASK at $750 is competitive; move to $765 to stand out

Gate: **Pro/Shop only** (AI token cost)

## FAQ

**Q: Why don't I see all the listings?**
A: Only 75+ score (truly comparable) are shown. 1889-CC is different from 1889 Philly, so those are filtered out.

**Q: Why do some listings have lower scores than others?**
A: Grade, certification, or other factors differ. Read the "reason" for why it's comparable.

**Q: Can I upgrade to see this feature?**
A: Yes! Subscribe to Pro ($49/mo) or Shop ($99/mo) tier. Start in Dashboard → Billing.

**Q: What if my listing title is weird?**
A: AI will do its best to extract attributes. If coin type isn't recognized, comparability might be low. Try including: Year, country, denomination, grade, certification.

**Q: How often is data updated?**
A: Comparable listings refresh each time you open the modal. Price data cached 23 hours to avoid rate limits.

**Q: Is this worldwide or eBay US only?**
A: Currently eBay US. International support coming in future.

## Architecture

```
Dashboard
├─ PricingInsightsTable
│  └─ Each row has "Details" button
│     └─ Opens CompetitorDetailsModal
│        ├─ Price Stats Tab
│        │  └─ Uses: competitor_prices table (cached)
│        └─ Comparable Listings Tab (Pro/Shop)
│           └─ Calls: filter-comparable-listings Edge Function
│              ├─ Step 1: Gemini extracts attributes
│              ├─ Step 2: Fetch eBay competitors
│              ├─ Step 3: Gemini scores each
│              └─ Step 4: Return top 15 (75+ score)
```

## Troubleshooting

**Listings not loading?**

- Check browser console for errors
- Ensure you're Pro/Shop tier
- Refresh the page and try again

**Comparability scores too low?**

- AI might not recognize your listing type
- Try adding year, mint mark, grade, cert info to title

**Seller info missing?**

- eBay API sometimes doesn't return full data
- Fallback to "Unknown" seller name

---

**Last Updated**: March 29, 2026 | **Status**: Phase 2a Complete ✅
