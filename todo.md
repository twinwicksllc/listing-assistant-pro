# 4-Tier Pricing Restructure Plan

## New Tier Structure

| Tier | Price | Listings/mo | AI Enhancement | Voice Notes | Melt Protection | Listing Analytics | Org/Team | 
|------|-------|-------------|----------------|-------------|-----------------|-------------------|----------|
| **Free** | $0 | 6 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Starter** | $19/mo | 25 | ✅ Basic | ❌ | ❌ | ❌ | ❌ |
| **Pro** | $49/mo | 200 | ✅ Full | ✅ | ✅ | ✅ | ❌ |
| **Shop** | $99/mo | ~1,200 (soft) | ✅ Full | ✅ | ✅ | ✅ | ✅ |

---

## Phase 1: Stripe Configuration (Manual / Stripe Dashboard)
- [x] Document new Stripe products/prices needed
  - New: Starter $19/mo (repurpose existing price_1T8lVU4bX0d1SiThMDayhDj5 or create new)
  - Rename: Pro $49/mo (repurpose existing price_1T8mZ84bX0d1SiThFgvRubiN or create new)
  - New: Shop $99/mo (need new Stripe product + price)
  - NOTE: Stripe products/prices need to be created in Stripe Dashboard by the owner

## Phase 2: AuthContext — PLANS constant & tier logic
- [ ] Update PLANS object: free → starter → pro → shop
- [ ] Add feature flags per tier: hasAiEnhancement, hasVoiceNotes, hasMeltProtection, hasListingAnalytics, hasOrgFeature
- [ ] Update tier detection: isStarter, isPro, isShop based on product IDs
- [ ] Update canAnalyze / canPublish limit checks for 4 tiers
- [ ] Update currentPlanLimits for each tier

## Phase 3: Backend — Edge Functions
- [ ] Update `create-checkout` VALID_PRICES to include all 3 paid price IDs
- [ ] Update `analyze-item` tier detection for 4 tiers + limits (6/25/200/1200)
- [ ] Update `check-subscription` if needed (should work as-is since it returns product_id)
- [ ] Update `stripe-webhook` if needed (should work as-is)
- [ ] Update `system-status` if needed

## Phase 4: Billing Page
- [ ] Redesign BillingPage.tsx for 4 tiers (Free / Starter / Pro / Shop)
- [ ] Update feature lists per tier
- [ ] Add Shop tier card with org feature callout
- [ ] Update upgrade/downgrade buttons for all combinations

## Phase 5: Settings Page
- [ ] Update SettingsPage.tsx billing tab for 4 tiers
- [ ] Update current plan display
- [ ] Update upgrade options

## Phase 6: Landing Page
- [ ] Update LandingPage.tsx PLANS array for 4 tiers
- [ ] Update feature descriptions

## Phase 7: Feature Gating
- [ ] Gate voice notes behind Pro/Shop (HomePage.tsx)
- [ ] Gate melt protection display behind Pro/Shop (AnalyzePage.tsx / PricingCard.tsx)
- [ ] Gate listing analytics (DashboardPage.tsx) behind Pro/Shop
- [ ] Gate organization features behind Shop tier only
- [ ] Update error messages for limit exceeded (usePublishDraft.ts, AnalyzePage.tsx)

## Phase 8: Build & Deploy
- [ ] Build frontend (npm run build)
- [ ] Deploy edge functions (supabase functions deploy)
- [ ] Push to GitHub

## Notes for Owner (Stripe Dashboard Tasks)
- Create new Stripe Product "Starter" at $19/mo → get price ID
- Rename/create "Pro" at $49/mo → get price ID  
- Create new Stripe Product "Shop" at $99/mo → get price ID
- Update PLANS in AuthContext.tsx with real price/product IDs
- Set up webhook endpoint if not already done