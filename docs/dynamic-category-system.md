# Dynamic Category & Aspect Lookup System

## Overview

This document describes the new self-learning category identification system that replaces hardcoded category IDs and aspect rules with eBay's Taxonomy API.

### Problem (Before)

- **50+ hardcoded category IDs** baked into the Gemini AI prompt (`analyze-item`)
- **30+ hardcoded aspect rule entries** (`CATEGORY_ASPECT_RULES`) in `ebay-publish`
- **Hardcoded condition normalization** sets (`COIN_CATEGORY_IDS`, `TRADING_CARD_CATEGORY_IDS`, etc.)
- Every new item type required a code change and redeployment

### Solution (After)

- **eBay's `getCategorySuggestions` API** dynamically finds the correct leaf category for any item
- **eBay's `getItemAspectsForCategory` API** dynamically fetches required/recommended aspects per category
- Results are **cached in the database** for instant future lookups (self-learning)
- Hardcoded rules kept as **safety net fallback only**

---

## Architecture Flow

```
User scans item --> analyze-item
                      |
                      +-- 1. DB pre-lookup (category_mappings table)
                      +-- 2. eBay getCategorySuggestions (via category-lookup "suggest" action)
                      +-- 3. Inject dynamic suggestions into Gemini prompt
                      +-- 4. Gemini returns categoryId + itemSpecifics
                              |
                              v
                         ebay-publish
                              |
                              +-- 1. fetchDynamicAspectRule() -- checks category_aspects_cache
                              +-- 2. If cache miss -- calls category-lookup "aspects" action
                              |                       -- fetches from eBay getItemAspectsForCategory
                              |                       -- caches result (7-day TTL)
                              +-- 3. If dynamic fails -- falls back to hardcoded CATEGORY_ASPECT_RULES
                              +-- 4. Merges: dynamic required/preferred + hardcoded fixedValues
                              +-- 5. detectCategoryTreeSync() for condition normalization
                              +-- 6. Publishes to eBay
```

---

## Database Tables

### `category_mappings` (enhanced)

Existing table -- now also stores breadcrumb paths from eBay's taxonomy.

| Column                | Type          | Description                                                                                 |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `coin_type`           | TEXT (PK)     | Legacy key                                                                                  |
| `item_type`           | TEXT (unique) | Normalized item description                                                                 |
| `ebay_category_id`    | TEXT          | eBay leaf category ID                                                                       |
| `category_name`       | TEXT          | Short name                                                                                  |
| **`breadcrumb`**      | TEXT          | **NEW** -- Full path, e.g. "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)" |
| `confidence`          | INT           | 0-100                                                                                       |
| `verification_source` | TEXT          | "user_verified", "ebay_api", "gemini_ai", "ai_auto"                                         |

### `category_aspects_cache` (new)

Caches eBay's `getItemAspectsForCategory` API responses per category.

| Column          | Type        | Description                         |
| --------------- | ----------- | ----------------------------------- |
| `category_id`   | TEXT (PK)   | eBay leaf category ID               |
| `category_name` | TEXT        | Human-readable name                 |
| `aspects`       | JSONB       | Array of aspect objects (see below) |
| `fetched_at`    | TIMESTAMPTZ | When fetched from eBay              |
| `expires_at`    | TIMESTAMPTZ | Cache expiry (default: 7 days)      |

**Aspect object format:**

```json
{
  "name": "Certification",
  "required": true,
  "usage": "RECOMMENDED",
  "mode": "SELECTION_ONLY",
  "dataType": "STRING",
  "values": ["Uncertified", "PCGS", "NGC", "ANACS", "ICG"]
}
```

---

## Files Changed

### 1. `category-lookup/index.ts` — The Core Lookup Engine

**New lookup flow (4 tiers):**

1. **DB exact match** — instant, highest confidence
2. **DB fuzzy match** — keyword search with slight confidence penalty
3. **eBay getCategorySuggestions** — NEW, calls eBay's Taxonomy API with the item description as a free-text query. Returns ranked leaf categories with full ancestor breadcrumbs. Auto-saves result to DB.
4. **Gemini AI fallback** — last resort, asks Gemini to guess the category ID

**New actions added:**

- **`suggest`** — Direct pass-through to eBay's `getCategorySuggestions`. Used by `analyze-item` to pre-populate the Gemini prompt with real category options. Returns up to 5 suggestions with categoryId, categoryName, and breadcrumb.

- **`aspects`** — Fetches aspect rules for a category from eBay's `getItemAspectsForCategory`. Caches result in `category_aspects_cache` table (7-day TTL). Returns required/recommended aspects with allowed values. Used by `ebay-publish` to dynamically build item specifics.

**Key functions:**

```typescript
// Calls eBay's getCategorySuggestions endpoint
// Takes free-text query, returns ranked leaf category suggestions
async function fetchCategorySuggestions(
  query: string,
  appToken: string,
  base: string,
): Promise<CategorySuggestion[]>;

// Calls eBay's getItemAspectsForCategory endpoint
// Returns all aspect metadata for a leaf category
async function fetchItemAspects(
  categoryId: string,
  appToken: string,
  base: string,
): Promise<AspectInfo[]>;
```

---

### 2. `analyze-item/index.ts` — AI Prompt Changes

**Before:** System prompt contained a massive hardcoded CATEGORY ROUTING section with 50+ category IDs:

```
### CATEGORY ROUTING -- ALL ITEM TYPES
- Beanie Babies / Ty Plush: **19203**
- Morgan Dollars: **39464**
- Sports Trading Cards: **261328** or **213** or **64482**
... (50+ more entries)
```

**After:** System prompt uses dynamic suggestions injected at runtime:

```
### CATEGORY SELECTION
You MUST select the correct eBay **leaf** category ID for every item.
Use these resources in order:

1. **DYNAMIC SUGGESTIONS** (below): If eBay API suggestions or DB matches
   are provided, use these FIRST -- they come from eBay's official taxonomy.
2. **Your knowledge**: Use it when dynamic suggestions are unavailable.
3. **google_search**: If confidence <90%, search to verify.

- EBAY API SUGGESTIONS (from eBay's official taxonomy):
  * **39464** -- Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)
  * **11980** -- Coins & Paper Money > Coins: US > Dollars > Peace (1921-35)
```

**Pre-lookup flow:**

1. DB fuzzy search using voice note keywords (same as before, now includes breadcrumb)
2. **NEW:** Calls `category-lookup` `suggest` action with voice note text
3. Both results injected into `${categoryHints}` in the system prompt

---

### 3. `ebay-publish/index.ts` — Dynamic Aspect Rules

**New functions added at top of file:**

```typescript
// Fetches aspect rules from cache or eBay API
// Returns AspectRule compatible with existing buildAndNormalizeAspects()
async function fetchDynamicAspectRule(
  categoryId: string,
  supabase: any,
): Promise<AspectRule | null>;

// Converts eBay API format to our internal AspectRule format
function convertEbayAspectsToRule(aspects: any[]): AspectRule;

// Detects category tree type from breadcrumb (async, DB-based)
async function detectCategoryTree(
  categoryId: string,
  supabase: any,
): Promise<CategoryTreeType>;

// Sync fallback using hardcoded ID sets + item type hints
function detectCategoryTreeSync(
  categoryId: string,
  itemType: string | undefined,
): CategoryTreeType;
```

**Aspect building flow (in `create_draft` handler):**

```
1. Try fetchDynamicAspectRule(categoryId)
   -- Checks category_aspects_cache table
   -- If cache miss, calls category-lookup "aspects" action
   -- Converts eBay API response to AspectRule format

2. If dynamic rule found:
   -- Merge with hardcoded fixedValues (e.g., Fineness "0.900" for Morgan Dollars)
   -- Merge with hardcoded defaults (e.g., Certification "Uncertified")
   -- Use merged rule for buildAndNormalizeAspects()

3. If dynamic rule NOT found:
   -- Fall back to hardcoded CATEGORY_ASPECT_RULES (same as before)
   -- For unknown categories: coin/bullion -> "253" fallback, others -> "__empty__"
```

**Condition normalization now uses `CategoryTreeType`:**

```typescript
type CategoryTreeType =
  "coin" | "bullion" | "trading_card" | "collectible" | "other";

// detectCategoryTreeSync uses:
// 1. Hardcoded ID sets (HARDCODED_COIN_CATEGORY_IDS, etc.) — same sets as before
// 2. Legacy 261xxx range detection for bullion
// 3. Item type text hints ("coin", "round", "bar", "trading card", etc.)
```

This replaces the old separate `COIN_CATEGORY_IDS`, `BULLION_CATEGORY_IDS`, `TRADING_CARD_CATEGORY_IDS`, and `COLLECTIBLE_CATEGORY_IDS` sets with a unified function.

---

### 4. `_helpers/suggestedCategories.ts` — Dynamic Breadcrumbs

**New helper function:**

```typescript
// Looks up breadcrumb: DB first (has dynamic breadcrumbs), hardcoded map as fallback
async function lookupBreadcrumb(cid: string, svc: any): Promise<string | null>;
```

The massive `EBAY_CATEGORY_BREADCRUMBS` hardcoded map (100+ entries) is kept as fallback but is no longer the primary source. The DB `category_mappings.breadcrumb` column (populated by `getCategorySuggestions`) is checked first.

---

### 5. Migration: `20260329000000_add_category_aspects_cache.sql`

```sql
-- New table for caching eBay aspect rules
CREATE TABLE public.category_aspects_cache (
  category_id    TEXT PRIMARY KEY,
  category_name  TEXT,
  aspects        JSONB NOT NULL DEFAULT '[]',
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add breadcrumb column to existing category_mappings
ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS breadcrumb TEXT;
```

---

## Self-Learning Behavior

The system gets smarter over time:

1. **First time** listing a "Morgan Silver Dollar":
   - DB miss -> eBay API returns category 39464 with full breadcrumb
   - Auto-saved to `category_mappings` with confidence 90
   - Aspects fetched and cached in `category_aspects_cache`

2. **Second time** listing a "Morgan Silver Dollar":
   - DB exact hit -> instant response, no API calls needed
   - Aspects served from cache (7-day TTL)

3. **First time** listing a "Nintendo Switch":
   - DB miss -> eBay API returns category 139971 (Video Games & Consoles)
   - Auto-saved to DB -> future lookups are instant
   - Aspects dynamically fetched -> knows exactly what eBay requires for this category

No code changes needed. The system handles ANY item type eBay supports.

---

## Safety Guarantees

- **All hardcoded rules are kept** as fallback -- if eBay's API is down, everything works exactly as before
- **Hardcoded `fixedValues` always win** -- known-correct values like Fineness "0.900" for Morgan Dollars can't be overridden by dynamic rules
- **Hardcoded `defaults` are merged** -- e.g., Certification "Uncertified" is preserved even with dynamic rules
- **Condition normalization** still uses hardcoded ID sets as fallback when breadcrumb is unavailable
