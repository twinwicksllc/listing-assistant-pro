# Feature #1 — Smart Price Recommender

## Phase 1: Types & Core Logic
- [ ] Create src/types/price-recommender.ts — PriceRecommendation, PriceStrategy, PriceConfidence types
- [ ] Create src/lib/priceRecommender.ts — strategy calculation, confidence scoring, condition adjustments

## Phase 2: Enhanced Edge Function
- [ ] Update supabase/functions/ebay-pricing/index.ts — add condition filtering, percentile stats, strategy hints

## Phase 3: UI Components
- [ ] Create src/components/PriceRecommenderCard.tsx — main card with strategy badges + apply button
- [ ] Create src/components/PriceStrategyBadge.tsx — Undercut / Match Market / Premium badges
- [ ] Create src/components/PriceHistogram.tsx — mini bar chart of price distribution

## Phase 4: Integration
- [ ] Integrate PriceRecommenderCard into AnalyzePage (replace/enhance existing PricingCard)
- [ ] Add "Apply Suggested Price" button wiring in AnalyzePage
- [ ] Add price recommendation button to DraftsPage (per draft card)
- [ ] Create src/components/DraftPriceAdvisor.tsx — lightweight inline price check for drafts

## Phase 5: Build, Commit & Deploy
- [ ] npm run build — zero TypeScript errors
- [ ] Commit and push branch
- [ ] Open PR
- [ ] Deploy updated ebay-pricing edge function