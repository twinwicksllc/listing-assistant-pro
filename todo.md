# Best Offer Feature

## Phase 1: Types & State
- [ ] Add bestOfferEnabled, bestOfferAutoAcceptPrice, bestOfferAutoDeclinePrice to listing types
- [ ] Add state variables to AnalyzePage for best offer fields

## Phase 2: AnalyzePage UI
- [ ] Add Best Offer toggle (checkbox) below listing price — only shows when format is FIXED_PRICE
- [ ] Add optional auto-accept and auto-decline price inputs (collapse when best offer disabled)

## Phase 3: Backend — ebay-publish
- [ ] Pass bestOffer fields through create_draft action payload
- [ ] Add bestOfferTerms to buildFixedPriceOffer when enabled

## Phase 4: Build, Commit, Deploy
- [ ] Build (no errors)
- [ ] Commit & push → auto-deploys edge function