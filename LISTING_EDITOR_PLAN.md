# Listing Editor — Comprehensive Implementation Plan
**Date:** March 30, 2026  
**Status:** Ready for Implementation  
**Scope:** Click-to-edit any live eBay listing from the Dashboard, with full write-back to eBay  

---

## Executive Summary

Users need to click on any listing card (or row in Pricing Insights table) to open a rich **Listing Editor** that exposes every editable field — title, description, price, quantity, condition, COGS, item specifics/attributes, and eBay category — and writes all changes back to eBay atomically using eBay's best-practice API paths.

This is a **medium-large** feature spanning:
- 1 new React component (`ListingEditorModal.tsx`)
- 1 new Supabase Edge Function (`ebay-edit-listing`)
- 1 new custom hook (`useListingEditor.ts`)
- 1 new DB migration (`listing_edits_log` audit table)
- 1 missing DB migration (`reprice_rules` table — currently used in code but not in migrations)
- Touches to `DashboardPage.tsx`, `PricingInsightsTable.tsx`, and `App.tsx`

---

## Part 1: eBay API Strategy

### Two API Paths — Must Handle Both

#### Path A: Inventory API (REST) — Listings created via `ebay-publish`
These have an `offerId` and `sku`. This is the modern path.

| Operation | eBay REST Endpoint | Notes |
|-----------|-------------------|-------|
| Get inventory item | `GET /sell/inventory/v1/inventory_item/{sku}` | Returns title, condition, aspects, images, quantity |
| Get offer | `GET /sell/inventory/v1/offer/{offerId}` | Returns price, categoryId, description, policies |
| Update inventory item | `PUT /sell/inventory/v1/inventory_item/{sku}` | Full replace — must send complete body |
| Update offer | `PUT /sell/inventory/v1/offer/{offerId}` | Full replace — must send complete body |
| Update price + qty only | `POST /sell/inventory/v1/bulk_update_price_quantity` | Already implemented in `ebay-reprice` |

> **Critical eBay Best Practice:** `PUT /inventory_item/{sku}` and `PUT /offer/{offerId}` are **idempotent full-replace** calls. You MUST GET the current body first, merge your changes, then PUT the full merged body. Never PUT just the changed fields — this will wipe all other fields.

#### Path B: Trading API (XML) — Legacy listings
These have `listingId` but no `offerId`. Use `ReviseFixedPriceItem` XML call (already used in `ebay-reprice`).

> **Key difference:** `ReviseFixedPriceItem` supports **partial** updates — you only need to send the fields you want to change.

---

### What Fields Can Be Edited On a Live Listing

| Field | Inventory API Path | Trading API Path | Notes |
|-------|-------------------|-----------------|-------|
| Title | `PUT /inventory_item/{sku}` → `product.title` | `ReviseFixedPriceItem` → `Item.Title` | Max 80 chars |
| Description | `PUT /offer/{offerId}` → `listing.description` | `ReviseFixedPriceItem` → `Item.Description` | Note: lives on OFFER, not inventory item |
| Price | `bulk_update_price_quantity` (existing) | `ReviseFixedPriceItem` → `Item.StartPrice` | Already in `ebay-reprice` |
| Quantity | `bulk_update_price_quantity` with qty | `ReviseFixedPriceItem` → `Item.Quantity` | 0 = out of stock, keeps listing active |
| Condition | `PUT /inventory_item/{sku}` → `condition` | `ReviseFixedPriceItem` → `Item.ConditionID` | Must use allowed enum values for category |
| Condition Notes | `PUT /inventory_item/{sku}` → `conditionDescription` | `ReviseFixedPriceItem` → `Item.ConditionDescription` | |
| Item Specifics/Aspects | `PUT /inventory_item/{sku}` → `product.aspects` | `ReviseFixedPriceItem` → `Item.ItemSpecifics` | Full replace of aspects block |
| eBay Category ID | `PUT /offer/{offerId}` → `categoryId` | `ReviseFixedPriceItem` → `Item.PrimaryCategory` | Changing category may invalidate aspects |
| Best Offer | `PUT /offer/{offerId}` → `bestOfferTerms` | `ReviseFixedPriceItem` → `Item.BestOfferDetails` | |
| COGS | N/A — local DB only | N/A — local DB only | Write to `listing_cogs` table |

---

## Part 2: Database Changes

### New Migration 1: `listing_edits_log` (Audit Trail)

```sql
-- Immutable audit log of all edits made to live eBay listings
CREATE TABLE IF NOT EXISTS public.listing_edits_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  ebay_sku        TEXT,
  ebay_listing_id TEXT,
  ebay_offer_id   TEXT,
  fields_changed  TEXT[]      NOT NULL DEFAULT '{}',
  old_values      JSONB       NOT NULL DEFAULT '{}',
  new_values      JSONB       NOT NULL DEFAULT '{}',
  success         BOOLEAN     NOT NULL DEFAULT false,
  error_message   TEXT,
  ebay_api_path   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_edits_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own edit logs"
  ON public.listing_edits_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX idx_listing_edits_sku ON public.listing_edits_log(ebay_sku);
CREATE INDEX idx_listing_edits_listing_id ON public.listing_edits_log(ebay_listing_id);
CREATE INDEX idx_listing_edits_user_id ON public.listing_edits_log(user_id);
CREATE INDEX idx_listing_edits_created_at ON public.listing_edits_log(created_at DESC);
```

### New Migration 2: `reprice_rules` ⚠️ MISSING

The `reprice_rules` table is **already referenced** in `RepriceRulesModal.tsx`, `RepriceManagerPanel.tsx`, and `useOptimization.ts` but **has no migration file**. This is a production gap that must be fixed.

```sql
CREATE TABLE IF NOT EXISTS public.reprice_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name       TEXT        NOT NULL,
  rule_type       TEXT        NOT NULL CHECK (
    rule_type IN ('match_lowest','beat_lowest','match_avg','match_sold_avg')
  ),
  adjustment_pct  NUMERIC     NOT NULL DEFAULT 0,
  floor_price     NUMERIC,
  ceiling_price   NUMERIC,
  category_filter TEXT,
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reprice_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reprice rules"
  ON public.reprice_rules FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

---

## Part 3: New Edge Function — `ebay-edit-listing`

### Why a New Function (Not Extending `ebay-reprice`)

`ebay-reprice` handles **price/quantity only** via `bulk_update_price_quantity`. Full listing editing requires:
1. GET current inventory item state before PUT (merge pattern)
2. GET current offer state before PUT (merge pattern)
3. Category validation before PUT
4. Category aspect re-fetch when category changes
5. COGS write-back to `listing_cogs`
6. Audit logging to `listing_edits_log`
7. Draft sync back to `drafts` table

This complexity warrants its own function.

### Actions

#### Action: `get_listing_details`
Fetches all current data needed to populate the editor form.

**Input:**
```json
{
  "action": "get_listing_details",
  "sku": "LA-abc123",
  "offerId": "12345678",
  "listingId": null,
  "userId": "uuid"
}
```

**Output:**
```json
{
  "inventoryItem": {
    "product": { "title": "...", "description": "...", "imageUrls": [...], "aspects": {} },
    "condition": "USED_EXCELLENT",
    "conditionDescription": "...",
    "availability": { "shipToLocationAvailability": { "quantity": 1 } }
  },
  "offer": {
    "price": { "value": "49.99", "currency": "USD" },
    "categoryId": "34200",
    "listing": { "description": "..." },
    "bestOfferTerms": { "bestOfferEnabled": false }
  },
  "categoryAspects": [...],
  "allowedConditions": [...],
  "cogs": { "cogs": 15.00, "acquiredAt": "2026-01-15" }
}
```

#### Action: `save_changes`
Applies changes to the live eBay listing.

**Input:**
```json
{
  "action": "save_changes",
  "sku": "LA-abc123",
  "offerId": "12345678",
  "listingId": null,
  "userId": "uuid",
  "changes": {
    "title": "Updated Title",
    "description": "Updated description",
    "price": 44.99,
    "quantity": 1,
    "condition": "USED_EXCELLENT",
    "conditionDescription": "Light wear only",
    "categoryId": "34200",
    "itemSpecifics": { "Year": "1921", "Grade": "MS-63" },
    "bestOfferEnabled": true,
    "bestOfferAutoAcceptPrice": 42.00,
    "bestOfferAutoDeclinePrice": 35.00
  },
  "cogsUpdate": {
    "cogs": 18.00,
    "cogsSource": "manual",
    "acquiredAt": "2026-01-15T00:00:00Z"
  }
}
```

**Output:**
```json
{
  "success": true,
  "updatedFields": ["title", "price", "itemSpecifics"],
  "errors": [],
  "auditLogId": "uuid"
}
```

### Implementation Logic for `save_changes`

```
1. Validate JWT → resolve userId + eBay user token
2. Check token expiry → refresh if needed (same pattern as ebay-publish)
3. Determine API path: Inventory (offerId present) vs Legacy (listingId only)

INVENTORY API PATH:
  a. GET /sell/inventory/v1/inventory_item/{sku}     → current item body
  b. GET /sell/inventory/v1/offer/{offerId}          → current offer body

  c. If categoryId changed:
     - Call category-lookup verify action → confirm leaf category
     - Fetch new aspects for new category
     - Warn if required aspects are now missing

  d. Merge item changes (title, condition, conditionDescription, aspects, quantity):
     - Deep merge: keep all existing aspects, overlay user's changes
     → PUT /sell/inventory/v1/inventory_item/{sku}

  e. Merge offer changes (price, description, categoryId, bestOfferTerms):
     - Keep existing offer fields, overlay user's changes
     → PUT /sell/inventory/v1/offer/{offerId}

LEGACY TRADING API PATH:
  → ReviseFixedPriceItem XML with only changed fields
     (title, description, price, quantity, condition, ItemSpecifics, category)

4. Update drafts table (match by ebay_sku or ebay_listing_id):
   UPDATE drafts SET title=?, description=?, listing_price=?, 
   item_specifics=?, ebay_category_id=? WHERE ebay_sku=?

5. Upsert listing_cogs (if cogsUpdate provided)

6. Insert into listing_edits_log (always — even on failure)

7. Return { success, updatedFields, errors, auditLogId }
```

### eBay API Compliance

- **Rate limits:** eBay Inventory API — 5,000 PUT calls/day per user. Max 2 calls per save (item + offer). Well within limits.
- **Idempotency:** PUT is idempotent — safe to retry on network timeout.
- **Validation before calling eBay (client + server):**
  - Title: ≤ 80 chars, no `<`, `>`, `*`, `{`, `}` characters
  - Price: ≥ $0.01
  - Quantity: integer ≥ 0
  - CategoryId: must be a leaf category (validate via `category-lookup` → `verify`)
  - Condition: must be in `allowedConditions` for the category
  - ItemSpecifics: required aspects must be non-empty

---

## Part 4: Frontend Architecture

### Decision: Drawer/Slide-over Modal (Not a New Page)

**Rationale:**
- Keeps Dashboard context visible while editing
- Standard UX pattern (Shopify, eBay Seller Hub, Amazon Seller Central)
- No route change required — avoids losing filter/sort state
- URL param pattern: `/dashboard?edit={listingId}` for deep-linking

### New Hook: `useListingEditor.ts`

```typescript
interface UseListingEditorReturn {
  // State
  editorState: EditorState | null;
  isLoading: boolean;
  isSaving: boolean;
  dirtyFields: Set<string>;
  errors: Record<string, string>;
  
  // Actions
  loadListing: (listing: EbayListing) => Promise<void>;
  updateField: (field: string, value: unknown) => void;
  saveChanges: () => Promise<SaveResult>;
  discardChanges: () => void;
  
  // Category
  onCategoryChange: (newCategoryId: string) => Promise<void>;
  categoryAspects: EbayAspect[];
  allowedConditions: string[];
}
```

### New Component: `ListingEditorModal.tsx`

#### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Close  [Thumbnail]  1921 Morgan Silver Dollar MS-63      [Save ▶] │
│                        SKU: LA-a1b2c3  ● ACTIVE  📎 View on eBay    │
├─────────────────────────────────────────────────────────────────────┤
│ [Overview]  [Pricing]  [Attributes]  [Details]  [History]           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  OVERVIEW TAB                                                         │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Title*                                          [72/80 chars]│    │
│  │ [1921 Morgan Silver Dollar MS-63 NGC Certified____________]  │    │
│  │                                                               │    │
│  │ Description                                                   │    │
│  │ [────────────────────────────────────────────────────────]   │    │
│  │ [                                                          ]  │    │
│  │ [────────────────────────────────────────────────────────]   │    │
│  │                                                               │    │
│  │ Condition*       Condition Notes                              │    │
│  │ [Used - Good ▼]  [Light surface wear, no damage__________]   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  PRICING TAB                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Price*        Quantity      Currency                          │    │
│  │ [$  49.99]    [  1  ]       [USD    ]                         │    │
│  │                                                               │    │
│  │ ○ Best Offer Enabled                                          │    │
│  │   Auto-Accept: [$ 47.00]  Auto-Decline: [$ 38.00]            │    │
│  │                                                               │    │
│  │ ── Cost of Goods (local only — not sent to eBay) ──────────  │    │
│  │ COGS          Acquired Date                                   │    │
│  │ [$ 16.00]     [Jan 15 2026 ▼]                                 │    │
│  │                                                               │    │
│  │ Est. Margin: $33.99 (68%)  ░░░░░░░░░░████████████████ 68%    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ATTRIBUTES TAB                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ [REQ] Year         [REQ] Grade      [REQ] Certification      │    │
│  │ [1921___________]  [MS-63_________]  [NGC ▼]                 │    │
│  │                                                               │    │
│  │ [OPT] Country      [OPT] Mint Mark  [OPT] Denomination       │    │
│  │ [USA_____________]  [P_____________]  [Dollar_____________]   │    │
│  │                                                               │    │
│  │ [+ Add custom attribute]                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  DETAILS TAB                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ eBay Category                                                 │    │
│  │ [Coins: US > Morgan Dollars (34200) ▼]                        │    │
│  │ ⚠ Changing category may affect required attributes            │    │
│  │                                                               │    │
│  │ SKU: LA-a1b2c3 (read-only)                                    │    │
│  │ Listed: March 15, 2026 (read-only)                            │    │
│  │ Format: Fixed Price (read-only)                               │    │
│  │ Offer ID: 1234567890 (read-only)                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  HISTORY TAB                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Mar 30, 2026 — Price $49.99 → $44.99 ✅                       │    │
│  │ Mar 28, 2026 — Title updated ✅                                │    │
│  │ Mar 25, 2026 — Attribute "Grade" added ✅                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  [Discard Changes]                    [Preview on eBay ↗] [Save ▶]  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Dirty Field Indicators

Every edited field gets:
- Yellow/amber left border: `border-l-2 border-amber-400`
- Pencil icon in field label
- "Save All Changes" button badge showing count: `Save 3 Changes ▶`

#### Category Change Warning Flow

```
User selects new category
  → Toast warning: "Changing category may require different item attributes"
  → Fetch new aspects for new category
  → Re-render Attributes tab with new required/optional fields
  → Fields that no longer map to new category are shown in red with ⚠
  → User must resolve before save is allowed
```

---

## Part 5: Triggering the Editor

### From Dashboard Cards

Add a pencil icon to each listing card, AND make the listing title itself clickable:

```tsx
// Option A: Icon button (less disruptive)
<button onClick={() => openEditor(listing)} title="Edit listing">
  <Pencil className="w-3.5 h-3.5" />
</button>

// Option B: Clickable title (user's original request)
<h3
  className="font-medium text-sm cursor-pointer hover:text-primary hover:underline"
  onClick={() => openEditor(listing)}
>
  {listing.title}
</h3>
```

**Recommendation: Both** — make the title clickable (satisfies the original request) AND add a dedicated edit icon for clarity.

### From Pricing Insights Table

Add an `Edit` icon column to `PricingInsightsTable.tsx`:

```tsx
<button onClick={() => onEditListing(listing)} title="Edit listing">
  <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
</button>
```

### URL Deep Linking

```
/dashboard?edit=<ebayListingId_or_sku>
```

On `DashboardPage` mount: check `useSearchParams()` for `edit` param. If present and listings are loaded, auto-open the editor for that listing. Useful for sharing direct edit links with team members.

---

## Part 6: Complete Data Flow

```
User clicks listing title or edit icon
         │
         ▼
DashboardPage: setEditingListing(listing) 
         │   [listing has: offerId, sku, listingId, title, price, etc.]
         ▼
ListingEditorModal opens (slide-over drawer)
useListingEditor.loadListing(listing) called
         │
         ├── Call ebay-edit-listing { action: "get_listing_details" }
         │     │
         │     ├── GET /sell/inventory/v1/inventory_item/{sku}
         │     │     → product.title, product.aspects, condition, quantity, images
         │     │
         │     ├── GET /sell/inventory/v1/offer/{offerId}
         │     │     → price, categoryId, listing.description, bestOfferTerms
         │     │
         │     ├── category-lookup { action: "aspects", categoryId }
         │     │     → requiredAspects, suggestedAspects, allowedConditions
         │     │
         │     └── SELECT * FROM listing_cogs WHERE ebay_sku = ? OR ebay_listing_id = ?
         │
         ▼
Form populated with all current values
dirtyFields = new Set() (clean state)
         │
User makes edits → markDirty(fieldName) called for each change
         │
User clicks "Save N Changes"
         │
         ▼
Client validation:
  - title.length <= 80
  - price > 0
  - quantity >= 0
  - required aspects non-empty
  - if categoryId changed: confirm leaf category
         │
         ▼
Call ebay-edit-listing { action: "save_changes", ...changes }
         │
         ├── INVENTORY API:
         │     a. GET current item + offer (fresh state)
         │     b. PUT /inventory_item/{sku} (merged title, condition, aspects, qty)
         │     c. PUT /offer/{offerId} (merged price, description, categoryId, bestOffer)
         │
         ├── LEGACY TRADING API:
         │     → ReviseFixedPriceItem XML (only changed fields)
         │
         ├── UPDATE drafts SET ... WHERE ebay_sku = ?
         │
         ├── UPSERT listing_cogs (if cogsUpdate)
         │
         └── INSERT listing_edits_log (audit record)
         │
         ▼
Success: 
  toast("Listing updated on eBay ✅")
  onSaved(updatedListing) → parent updates listings array
  Modal stays open for further edits (or closes if user chose)

Failure:
  toast.error("Failed to update: <eBay error message>")
  Dirty fields remain highlighted — user can retry or discard
```

---

## Part 7: Files to Create

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `supabase/functions/ebay-edit-listing/index.ts` | Edge function: get + save listing details | ~400 |
| `src/components/ListingEditorModal.tsx` | Main drawer/modal UI | ~500 |
| `src/hooks/useListingEditor.ts` | State management + API calls | ~200 |
| `supabase/migrations/YYYYMMDD_listing_edits_log.sql` | Audit trail table | ~40 |
| `supabase/migrations/YYYYMMDD_reprice_rules.sql` | Missing reprice_rules table | ~30 |

---

## Part 8: Files to Modify

| File | Change Required |
|------|----------------|
| `src/pages/DashboardPage.tsx` | Add `editingListing` state, `<ListingEditorModal>`, edit icon/clickable title on cards, `?edit=` URL param handler |
| `src/components/PricingInsightsTable.tsx` | Add Edit icon column, `onEditListing` prop |
| `src/App.tsx` | No changes needed (modal pattern, no new route) |
| `supabase/functions/ebay-reprice/index.ts` | Optional: add `update_quantity` action since bulk_update_price_quantity also supports qty changes |

---

## Part 9: Gotchas & Edge Cases

### 1. Description Lives on the OFFER, Not the Inventory Item
For Inventory API listings, the **description is on the offer** (`PUT /offer/{offerId}`), NOT the inventory item. This is counter-intuitive but is eBay's design. The `get_listing_details` action must fetch it from the offer response.

### 2. Aspects Are a Full Replace
When saving item specifics via `PUT /inventory_item/{sku}`, ALL aspects are replaced. The function must GET the current aspects first, then merge the user's changes on top. Never send only the user's modified aspects — this wipes all others.

### 3. Category Change Cascades
Changing category may:
- Make existing aspects invalid (aspects specific to old category)
- Require new required aspects (aspects specific to new category)
- Change which condition values are allowed
The editor must re-fetch aspects + conditions when category changes and guide the user through any conflicts.

### 4. Quantity 0 vs Ending a Listing
- `quantity: 0` → listing stays active, shows "Out of Stock" to buyers
- `DELETE /offer/{offerId}` → ends the listing entirely
The editor should support setting quantity to 0 but NOT deleting/ending listings — that's a separate destructive action outside scope.

### 5. Token Expiry Mid-Edit
The eBay OAuth token may expire during a long editing session. The `ebay-edit-listing` function must check token expiry before making API calls and trigger a refresh if needed (same pattern as `ebay-publish`).

### 6. eBay Error Code Handling
The editor should translate common eBay error codes into user-friendly messages:
- `25002`: Offer already exists (should not occur on edit, but handle gracefully)
- `25004`: Invalid price (below minimum for category)
- `25005`: Not a leaf category (show category search helper)
- `25021`: Condition not valid for this category
- `25002`: Item specific required (highlight the missing field)

### 7. Concurrent Edits (Multi-User Orgs)
If two org members edit the same listing simultaneously, one will overwrite the other. Phase 1 should add a warning banner: "Another team member may have recently edited this listing." Phase 2 can add optimistic locking using eBay's `If-Match` header where supported.

### 8. Legacy Listings — Limited GET Support
Legacy Trading API listings don't have a GET equivalent as clean as the Inventory API. Use `GetItem` XML call to fetch current state. This is more complex to parse — the `ebay-edit-listing` function must handle both XML (legacy) and JSON (Inventory API) response parsing.

### 9. Draft Sync
After a successful edit, the corresponding `drafts` row (matched by `ebay_sku` or `ebay_listing_id`) should be updated to keep the local DB in sync with eBay. This ensures the Drafts page and Analyze page show accurate data.

### 10. Image Editing — Out of Scope for Phase 1
Image replacement requires:
- Uploading new images to Supabase Storage
- Converting storage URLs to public CDN URLs
- Sending new URLs via `PUT /inventory_item/{sku}` with `product.imageUrls`
- Minimum 1 image, maximum 12, each ≥ 500x500px

Include image editing as a dedicated Phase 2 feature with a proper image management UI.

---

## Part 10: What's Not in the Original Request (Recommended Additions)

| Addition | Rationale | Effort |
|----------|-----------|--------|
| **Best Offer settings** | Already supported by `PUT /offer/{offerId}` — very low effort to include | Low |
| **Edit History tab** | Shows all past edits from `listing_edits_log` — builds trust, aids debugging | Low |
| **"Preview on eBay" button** | Link directly to the live listing — already have `ebayUrl` in listing data | Trivial |
| **Profit margin calculator** | Show real-time margin as user changes price/COGS — pure math, no API calls | Low |
| **SEO title suggestions** | Gemini-powered title improvement suggestions when editing title field | Medium |
| **Duplicate listing button** | Copy listing into a new draft in Analyze page | Low |
| **Image management** | Add/remove/reorder photos on live listing | High |
| **Shipping policy override** | Change fulfillment/return policies per-listing | Medium |
| **End listing / Delist** | Separate destructive button with confirmation | Low |
| **Relist ended listing** | Re-publish offer that was ended | Low |

---

## Part 11: Implementation Sequence

### Sprint 1 — Backend (2-3 days)
1. Create `reprice_rules` migration (fix existing production gap)
2. Create `listing_edits_log` migration
3. Build `ebay-edit-listing` function → `get_listing_details` action
4. Build `ebay-edit-listing` function → `save_changes` action (Inventory API path)
5. Add Legacy Trading API path (`ReviseFixedPriceItem` for title/desc/aspects/category)
6. Add COGS write-back and audit logging

### Sprint 2 — Frontend Modal (3-4 days)
7. Create `useListingEditor` hook
8. Build `ListingEditorModal` shell with tabs
9. Overview tab: title, description, condition fields
10. Pricing tab: price, quantity, best offer, COGS, margin calculator
11. Attributes tab: dynamic aspects from eBay + required/optional badges
12. Details tab: category selector with breadcrumb, read-only metadata
13. History tab: query `listing_edits_log` for this listing

### Sprint 3 — Dashboard Integration (1-2 days)
14. Add `editingListing` state to DashboardPage
15. Make listing card titles clickable + add edit icon
16. Add Edit column to PricingInsightsTable
17. Handle `?edit=` URL parameter for deep linking
18. Wire up `onSaved` callback to update listings array in parent

### Sprint 4 — Polish & Testing (1-2 days)
19. Per-field dirty indicators (amber border, pencil label, dirty count badge)
20. eBay error code → user-friendly message mapping
21. Category change warning + aspect refresh flow
22. End-to-end test: Inventory API path (all fields)
23. End-to-end test: Legacy Trading API path
24. Test COGS update flow
25. Test audit log entries

---

## Part 12: Effort Summary

| Component | Effort | Priority |
|-----------|--------|----------|
| `reprice_rules` migration (fix gap) | 0.5 day | P0 — blocking existing features |
| `listing_edits_log` migration | 0.5 day | P0 |
| `ebay-edit-listing` edge function | 2.5 days | P0 |
| `useListingEditor` hook | 1 day | P0 |
| `ListingEditorModal` UI | 3 days | P0 |
| Dashboard integration | 1 day | P0 |
| PricingInsightsTable edit button | 0.5 day | P0 |
| History tab | 0.5 day | P1 |
| Image management | 2 days | P2 |
| SEO title suggestions (Gemini) | 1 day | P2 |
| **Total Phase 1 (P0)** | **~9 days** | |
| **Total Phase 2 (P1 + P2)** | **~4 days** | |

---

## Quick Reference: eBay API Endpoints

```
Production:  https://api.ebay.com
Sandbox:     https://api.sandbox.ebay.com

# Inventory API
GET  /sell/inventory/v1/inventory_item/{sku}           ← fetch item
PUT  /sell/inventory/v1/inventory_item/{sku}           ← update item (full replace)
GET  /sell/inventory/v1/offer/{offerId}                ← fetch offer
PUT  /sell/inventory/v1/offer/{offerId}                ← update offer (full replace)
POST /sell/inventory/v1/bulk_update_price_quantity     ← price + qty only (existing)

# Category
GET  /commerce/taxonomy/v1/category_tree/{tree_id}/get_item_aspects_for_category?category_id={id}

# Trading API (Legacy)
POST https://api.ebay.com/ws/api.dll
     Header: X-EBAY-API-CALL-NAME: ReviseFixedPriceItem
     Header: X-EBAY-API-CALL-NAME: GetItem

# eBay Docs
https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/updateOffer
```

---

**Last Updated:** March 30, 2026 | **Status:** Plan Ready — Awaiting Implementation Approval