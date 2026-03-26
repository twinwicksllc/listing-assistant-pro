# Shipping Label Cost Fix

## Tasks
- [x] Add `sell.finances` scope to all 3 OAuth scope arrays in ebay-publish/index.ts
- [x] Add `fetchShippingLabelCosts()` function to ebay-listings/index.ts using Finances API
- [x] Fix netProfit: exclude shippingCollected from income (it's a pass-through, not kept money)
- [x] Wire fetchShippingLabelCosts into fetchOrderCounts and apply to financial windows
- [x] Push branch and create PR (#168)