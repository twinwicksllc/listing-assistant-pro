# Current State Summary - Listing Assistant Pro
**Last Updated:** March 21, 2026 (Pulled from main)

## Recent Commits (Last 20)
1. `90a718e` - fix: initialize competitorData early to prevent hoisting error
2. `d628093` - refactor: move competitor search to post-AI analysis
3. `eed7b1f` - fix: use voiceNote as fallback for competitor search query
4. `7271d5e` - fix: correct import path for suggestedCategories helper
5. `0da4a0c` - feat: fix voiceNotes button and add AI category suggestions
6. `2913be9` - feat: implement sequential SKU generation (LA01000, LA01001, etc.)
7. `d14f859` - fix: correct eBay inventory location by DELETE+re-create
8. `e68d35d` - fix: revert ebay-pricing to Browse API for completed items search
9. And more...

## Pricing Tiers (4-Tier System)
| Tier | Price | Listings/Mo | Features |
|------|-------|-------------|----------|
| Free | $0 | 6 | Basic item recognition, Draft saving |
| Starter | $19 | 25 | Basic AI enhancement, eBay publishing |
| Pro | $49 | 200 | Voice notes, Melt protection, Analytics, Sold comps |
| Shop | $99 | ~1,200 | Full features + Org/Team features |

## Stripe Integration
- **Edge Functions:**
  - `create-checkout` - Creates Stripe checkout sessions
  - `customer-portal` - Stripe billing portal access
  - `stripe-webhook` - Handles Stripe events (checkout, subscription changes)
  - `check-subscription` - Returns user subscription status (cached in DB)
  
- **Database Tables:**
  - `subscriptions` - Stores Stripe subscription data
  - `profiles.stripe_customer_id` - Cached Stripe customer ID

- **Price IDs (need confirmation):**
  - Starter: `price_1T8lVU4bX0d1SiThMDayhDj5` / `prod_U6zUiC1SYuPrGU`
  - Pro: `price_1T8mZ84bX0d1SiThFgvRubiN` / `prod_U70aT1KvuI2uDx`
  - Shop: `price_SHOP_PLACEHOLDER` / `prod_SHOP_PLACEHOLDER` (TODO: create in Stripe)

## Key Edge Functions
- `analyze-item` - AI-powered item analysis with Gemini
- `ebay-listings` - Fetches eBay listings with multi-window analytics (7d/30d/90d)
- `ebay-pricing` - Fetches sold comps for pricing
- `ebay-publish` - Publishes listings to eBay
- `ebay-competitor-search` - NEW: Competitor price search
- `spot-prices` - Live metal spot prices (12-hour cache)
- `category-lookup` - eBay category suggestions
- `transcribe-voice` - Voice note transcription

## Database Schema Highlights
- `profiles` - User profiles with eBay tokens, stripe_customer_id, ebay_username
- `drafts` - Listing drafts
- `usage_tracking` - Usage analytics with org_id for per-org quotas
- `organizations` - Team/org management with free_tier_reset_day
- `subscriptions` - Stripe subscription data
- `spot_price_cache` - Cached metal prices
- `competitor_prices` - Competitor price snapshots

## Free Tier Implementation
- Per-org rolling-window quota system
- `free_tier_reset_day` anchors the credit reset to signup day
- `get_free_tier_window_start()` PL/pgSQL function for window calculation
- eBay account gate for Starter users (must connect eBay to use)
- 6 credits per month for free tier

## Dashboard Features
- Multi-window analytics (7d/30d/90d views)
- Trend indicators (Hot 🔥 / Stable / Stale 📉)
- Sort by views, watchers, impressions, transactions, trend
- Filters for engagement (zero views, has watchers, etc.)
- Competitor price cards

## Pending Tasks
1. Create Shop tier Stripe products/prices (placeholder IDs)
2. Confirm/replace Starter and Pro Stripe IDs
3. Update `create-checkout` VALID_PRICES for Shop tier