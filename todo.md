# Fix errorId 25604 "Product not found" — Triceratops Bar

## Root Cause
`"Precious Metal Content per Unit": "0.1607 Troy oz"` is non-standard.
eBay category 39489 requires values like `"5 g"`, `"1 oz"`, `"1/10 oz"`.

## Tasks
- [x] Research eBay accepted values for "Precious Metal Content per Unit"
- [x] Add `normalizePreciousMetalContent()` function to ebay-publish/index.ts
- [x] Wire it into `buildAndNormalizeAspects()` for the "Precious Metal Content per Unit" key
- [x] Update version banner to v12
- [x] Commit and push to main (triggers GitHub Actions deploy)