# Codebase Familiarization Notes
*Updated after full read-through — ready for enhancement work*

---

## Architecture Overview

**Stack:** React 18 + TypeScript + Vite (frontend) · Supabase Edge Functions on Deno (backend) · Supabase Postgres (database) · Tailwind CSS + shadcn/ui

**Routes (src/App.tsx):**
| Path | Component | Guard |
|---|---|---|
| `/dashboard` | DashboardPage | `ownerOnly` |
| `/drafts` | DraftsPage | protected |
| `/analyze` | AnalyzePage | protected |
| `/reprice-rules` | RepriceRulesPage | `ownerOnly` |
| `/profit-report` | ProfitReportPage | `ownerOnly` |
| `/cogs-editor` | BulkCogsPage | `ownerOnly` |
| `/historical-cogs` | HistoricalCogsPage | `ownerOnly` |

---

## Key Data Types

### `ListingDraft` (src/types/listing.ts)
All editable draft fields including:
- `id`, `title`, `description`, `imageUrl/imageUrls`
- `priceMin/priceMax`, `listingPrice`, `listingFormat` (FIXED_PRICE | AUCTION)
- `auctionDuration`, `condition`, `ebayCategoryId`, `ebayCategoryBreadcrumb`
- `itemSpecifics: Record<string, string>`
- `consignor`, `cogs`, `cogsSource`, `cogsAcquiredAt`
- `metalType`, `metalWeightOz`
- `fulfillmentPolicyId`, `paymentPolicyId`, `returnPolicyId`
- `publishStatus` (draft | publishing | published | failed)
- `ebaySku`, `ebayOfferId`, `ebayListingId`, `lastPublishError`

### `EbayListing` (local to DashboardPage.tsx)
- `offerId: string | null` — present for Inventory API listings
- `sku: string` — always present
- `listingId: string | null` — always present when live
- `title`, `imageUrl`, `price`, `currency`, `status`
- `categoryId`, `quantity`, `format`, `condition`, `listingDate`
- Analytics: `views7d/30d/90d`, `impressions7d/30d/90d`, `transactions7d/30d/90d`
- `watchCount`, `questionCount`
- `competitor: CompetitorPriceSnapshot | null`
- `ebayUrl: string | null`

### Two Listing Types (CRITICAL)
1. **Inventory API listing** — has `offerId` + `sku`. Editable via REST `PUT /sell/inventory/v1/inventory_item/{sku}` + `PUT /sell/inventory/v1/offer/{offerId}`
2. **Legacy Trading API listing** — has `listingId`, `offerId = null`. Editable via XML `ReviseFixedPriceItem` call

---

## Auth & Plans (src/contexts/AuthContext.tsx)
Plans: Free ($0, 6 drafts) · Starter ($19, 25) · Pro ($49, 200) · Shop ($99, 1200)

Feature flags on `planFeatures`:
- `hasAiEnhancement` — Pro+
- `hasListingAnalytics` — Pro+
- `hasCogsTracking` — Pro+
- `hasMeltProtection` — Pro+
- `hasVoiceNotes` — Pro+
- `hasOrgFeature` — Shop only

Helpers: `isPro`, `isShop`, `isOwner`, `isLister`, `canAnalyze`, `canPublish`
Admin: `twinwicksllc@gmail.com`

---

## State Management

### `useDrafts()` hook (src/hooks/useDrafts.ts)
- `drafts: ListingDraft[]` — fetched from `drafts` Supabase table
- `addDraft`, `removeDraft`, `updateDraft(id, Partial<ListingDraft>)` — full field mapping to DB columns
- `markDraftPublished(id, {sku, offerId, listingId})` — updates publish lifecycle
- `markDraftFailed(id, errorMsg)`

### `usePublishDraft()` hook (src/hooks/usePublishDraft.ts)
- Gets eBay token: Supabase profiles table → localStorage fallback
- Calls `ebay-publish` edge function with `action: "create_draft"`
- Retry logic: up to 3 attempts, exponential backoff
- On success: calls `markDraftPublished()`, auto-writes COGS to `listing_cogs`

---

## Edge Functions

### `ebay-listings` (1011 lines)
- Fetches offers via `GET /sell/inventory/v1/offer?limit=100` (paginated)
- For each offer: fetches inventory item via `GET /sell/inventory/v1/inventory_item/{sku}`
- Falls back to **Trading API** `GetMyeBaySelling` if Inventory API fails
- Fetches analytics for 3 windows (7d, 30d, 90d) in parallel via `sell/analytics/v1/traffic_report`
- Fetches watch data via Trading API `GetItem`
- Fetches order counts + P&L from Fulfillment API + Finances API
- Returns: `{ listings, orderCount7d/30d/90d, financial: { w7, w30, w90 } }`

### `ebay-reprice` (360 lines)
- `single_update`: Inventory API → `bulkUpdateInventoryPrices([one])`, Legacy → `reviseFixedPriceItem`
- `bulk_update`: batches up to 25 per `POST /sell/inventory/v1/bulk_update_price_quantity`, legacies via `ReviseFixedPriceItem`
- Token resolution: from request body → Supabase profiles table

### `ebay-publish` (large)
- Actions: `create_draft`, `get_auth_url`, `exchange_code`, `refresh_token`, `get_stored_token`, `bulk_create_draft`, `get_policies`
- Inventory item body: `{ product: { title, imageUrls, aspects }, condition, conditionDescription, availability: { shipToLocationAvailability: { quantity } } }`
- **CRITICAL:** Description lives on the OFFER body, NOT the inventory item
- Aspects are full-replace on PUT (GET → merge → PUT pattern required)

### `category-lookup` 
- Looks up eBay category aspects/rules
- Results cached in `category_aspects_cache` table

---

## DashboardPage.tsx — Key Patterns

### Listing Card Structure (lines ~1650-1760)
```
<div> // card
  <button onClick={toggleSelect}> // checkbox
  <img> // image
  <div> // content
    <p> // title + TrendBadge + ProfitBadge + status badge
    <InlinePriceEditor> // click-to-edit price
    <ViewsTrendRow> // 7d/30d/90d views
    <StatPill[]> // watchers, sales, CTR
    <div> // meta: SKU, format, condition, date, categoryId
    <CompetitorPriceCard> // competitor pricing
  </div>
</div>
```

### State Variables
- `listings: EbayListing[]` — live eBay listings
- `ebayToken: string` — current user's eBay OAuth token
- `cogsByListingDb: Record<string, number>` — from `listing_cogs` table
- `cogsByListing` — useMemo merging drafts + DB COGS
- `selectedIds: Set<string>` — for bulk operations
- `listingViewMode: "cards" | "pricing"` — view toggle

### Callbacks
- `handlePriceSaved(offerId, listingId, newPrice)` — updates local state after price edit
- `handleBulkSuccess(updates[])` — bulk price update callback
- `listingKey(l)` = `l.offerId || l.listingId || l.sku` — unique key

---

## EditDraftModal.tsx (620 lines) — Reference for Listing Editor UI

Editable fields for drafts:
- Title (80 char limit with counter)
- Description (textarea)
- Listing format (BIN vs Auction toggle buttons)
- Listing price / starting bid
- Auction duration (1/3/5/7/10 days)
- eBay Category (typed ID, with breadcrumb display)
- Item Specifics (editable key-value list)
- Condition (dynamic select using `getConditionsForCategory()`)
- Consignor
- COGS (via `<CogsInput>` component)
- Business Policies (Shipping, Payment, Returns) — loaded from `get_policies`

Save flow: calls `updateDraft(id, Partial<ListingDraft>)` → Supabase `drafts` table only

---

## PricingInsightsTable.tsx (411 lines)

Props: `{ listings, onRefreshCompetitor, onPriceChange, onApplyPrice, userToken, userId, isLoading }`
- Sort by: title, price, marketAvg, suggested, delta, competitors, condition
- Per-row: price edit input, "Apply" button (calls `ebay-reprice`)
- Throttle 500ms between refresh attempts

---

## Database Tables (Key)

| Table | Purpose |
|---|---|
| `drafts` | All listing drafts with full publish lifecycle |
| `listing_cogs` | `user_id, ebay_sku, ebay_listing_id, cogs` — COGS for live listings |
| `competitor_prices` | Cached competitor price snapshots |
| `category_mappings` | eBay category name → ID mappings |
| `category_aspects_cache` | eBay category aspects (item specifics rules) |
| `reprice_rules` | Auto-reprice rules (created via manual migration — placeholder in `20260324000001`) |
| `optimization_history` | Optimization queue history |
| `profiles` | User profiles, eBay token storage, plan info |

**Missing migration:** `listing_edits_log` (planned in LISTING_EDITOR_PLAN.md but not created)

---

## Components Map

| Component | Purpose |
|---|---|
| `EditDraftModal` | Edit draft fields before publishing |
| `PricingInsightsTable` | Tabular pricing comparison + quick price edit |
| `RepriceManagerPanel` | Manual trigger + rule count display |
| `RepriceRulesModal` | CRUD for `reprice_rules` table |
| `CompetitorPriceCard` | Per-listing competitor price widget |
| `OptimizationQueueWidget` | AI optimization suggestions queue |
| `CogsInput` | COGS entry with margin calculator |
| `ProfitBadge` | Margin % badge from cogs + price |
| `EbayPolicySelector` | Reusable policy picker (also used in AnalyzePage) |
| `CsvCogsImporter` | Bulk COGS import from CSV |

---

## Enhancement Readiness Notes

### For Listing Editor (per LISTING_EDITOR_PLAN.md):
1. **`ebay-edit-listing` edge function** — Does NOT exist yet. Must be created.
2. **`listing_edits_log` migration** — Does NOT exist yet. Must be created.
3. **eBay API pattern:** GET → merge → full-replace PUT (idempotent)
4. **Description is on OFFER, not inventory item** — both endpoints needed
5. **Trading API listings** (offerId = null): use `ReviseFixedPriceItem` XML
6. **Aspects = item specifics** — full array replacement on inventory item PUT

### Click-to-edit hook point in DashboardPage:
- Listing card `<div key={k}>` at line ~1658 — add `onClick` handler
- Each card has `listing.offerId`, `listing.sku`, `listing.listingId` — all available

### Pattern to follow:
- `InlinePriceEditor` shows the edit-in-place pattern for simple fields
- `EditDraftModal` shows the full modal pattern for complex fields
- `BulkPriceModal` shows the modal + Supabase function invoke pattern

### eBay API Fields Available for Edit:
- **Inventory item** (`PUT /sell/inventory/v1/inventory_item/{sku}`): title, aspects, condition, conditionDescription, imageUrls, quantity
- **Offer** (`PUT /sell/inventory/v1/offer/{offerId}`): description, price, categoryId, fulfillmentPolicyId, paymentPolicyId, returnPolicyId, listingFormat
- **Legacy** (`ReviseFixedPriceItem`): title, description, price, quantity, condition, categoryId, item specifics