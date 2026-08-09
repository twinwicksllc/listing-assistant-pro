# Supabase Edge Functions → DB Table Mapping

Generated: 2026-03-16

This file lists each Supabase Edge Function and the Postgres tables it references.

| Function (path)                                      |                                        DB Tables Referenced | Notes                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------: | --------------------------------------------------------- |
| `supabase/functions/analyze-item/index.ts`           |        `usage_tracking`, `spot_price_cache`, `gemini_usage` | AI usage & limits, spot price lookup, Gemini cost logging |
| `supabase/functions/spot-prices/index.ts`            |                                          `spot_price_cache` | Spot price fetch + cache                                  |
| `supabase/functions/ebay-publish/index.ts`           |                                `listing-images`, `profiles` | Listing image store, profile-based defaults/locations     |
| `supabase/functions/ebay-competitor-search/index.ts` |                                         `competitor_prices` | Inserts competitor price snapshots                        |
| `supabase/functions/ebay-pricing/index.ts`           |                                                           — | App-level eBay Browse API (no DB)                         |
| `supabase/functions/ebay-policies/index.ts`          |                                                           — | Fetches eBay account policies                             |
| `supabase/functions/ebay-user/index.ts`              |                                                           — | eBay identity lookup                                      |
| `supabase/functions/ebay-listings/index.ts`          |                                                           — | Inventory/Trading API calls, enriches listings            |
| `supabase/functions/category-lookup/index.ts`        |                                         `category_mappings` | Lookup of coin→eBay category mappings                     |
| `supabase/functions/setup-categories/index.ts`       |                                         `category_mappings` | Creates/seeds `category_mappings` via Postgres client     |
| `supabase/functions/transcribe-voice/index.ts`       |                                              `gemini_usage` | Logs Gemini transcription usage                           |
| `supabase/functions/create-checkout/index.ts`        |                                                  `profiles` | Reads profile for checkout metadata                       |
| `supabase/functions/stripe-webhook/index.ts`         |                                 `profiles`, `subscriptions` | Upserts `subscriptions`, links to `profiles`              |
| `supabase/functions/check-subscription/index.ts`     |                                 `subscriptions`, `profiles` | Cached subscription lookups and profile reads             |
| `supabase/functions/competitor-prices-cron/index.ts` |                             `competitor_prices`, `profiles` | Cron refresh of competitor pricing                        |
| `supabase/functions/cost-alert-cron/index.ts`        |                               `gemini_usage`, `cost_alerts` | Monitors Gemini spend, writes alerts                      |
| `supabase/functions/customer-portal/index.ts`        |                                                  `profiles` | Builds Stripe portal session using profile                |
| `supabase/functions/system-status/index.ts`          | `profiles`, `gemini_usage`, `usage_tracking`, `cost_alerts` | Aggregated system health and counts                       |

If you want this exported elsewhere (root `docs/` or CSV), tell me and I will add it.
