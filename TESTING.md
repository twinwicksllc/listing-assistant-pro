# Automated Testing Setup

This guide explains how to use the new test database and automated function tests.

## Overview

- **~60 test items** in `test_items` table across 6 domains (coins, cards, jewelry, electronics, vintage clothing, general)
- **Edge function tests** in `supabase/functions/*/test.ts`
- **GitHub Actions CI/CD** runs on every push/PR
- **Test helper** at `supabase/functions/_test-helpers/test-db.ts`

## Quick Start (Local Development)

### 1. Apply the test data migration

```bash
cd /workspaces/listing-assistant-pro

# Start Supabase locally
supabase start

# Apply migrations (including the new test_items table)
supabase db pull  # or let it auto-apply on start
```

The migration `20260329024428_create_test_items_table.sql` will:

- Create `public.test_items` table with same schema as `drafts`
- Pre-populate with 60 realistic test items:
  - **Coins & Bullion** (16 items): Kennedy halves, gold eagles, sovereigns, international coins
  - **Trading Cards** (8 items): Pokemon, MTG, Yu-Gi-Oh, vintage sports cards
  - **Jewelry** (7 items): Diamond rings, watches, vintage brooches
  - **Electronics** (8 items): iPhone, laptops, cameras, TVs, gaming consoles
  - **Vintage Clothing** (6 items): Levis, Chanel, band tees, vintage sneakers
  - **General/Collectibles** (9 items): Beanie babies, stamps, typewriter, lamp, records

### 2. Run tests locally

```bash
# Terminal 1: Start local Supabase
supabase start

# Terminal 2: Deploy functions locally
supabase functions serve

# Terminal 3: Run analyze-item tests
deno test --allow-net --allow-env \
  supabase/functions/analyze-item/test.ts

# Run all function tests
deno test --allow-net --allow-env \
  supabase/functions/*/test.ts
```

### 3. Understand the test helper

File: `supabase/functions/_test-helpers/test-db.ts`

```typescript
import { getTestItemByDomain, TEST_DOMAINS } from "../_test-helpers/test-db.ts";

// Get a specific test item by domain
const coinItem = await getTestItemByDomain("coins_bullion");

// Get random test item
const randomItem = await getRandomTestItem();

// Get by title pattern
const pikachu = await getTestItemByTitle("Pikachu");

// Get all items of a domain
const allCoins = await getTestItems("coins_bullion");
```

### 4. Write function tests

Example: `supabase/functions/analyze-item/test.ts`

```typescript
import { getTestItemByDomain } from "../_test-helpers/test-db.ts";

Deno.test("analyze-item: coins domain", async () => {
  const item = await getTestItemByDomain("coins_bullion");

  const result = await callAnalyzeItem({
    voiceNote: item.title + " " + item.description,
    images: item.image_urls || [],
  });

  assert(result.domain === "coins_bullion");
  assert(result.category > 0);
});
```

## CI/CD Pipeline (.github/workflows/test.yml)

Runs on every push/PR:

1. **Frontend Tests** (3 min)
   - TypeScript type-check (`npx tsc --noEmit`)
   - ESLint (`npx eslint src/`)
   - Unit tests (`bun run test`)
   - Build check

2. **Edge Functions Check** (2 min)
   - Deno format check
   - Deno lint

3. **Integration Tests** (10 min)
   - Starts local Supabase with test DB
   - Runs edge function tests against live functions
   - Tests `analyze-item` with all 6 domains

4. **Test Summary**
   - Reports pass/fail status

## Test Database Schema

`test_items` table mirrors `drafts` with these key columns:

```sql
domain TEXT              -- coins_bullion, trading_cards, jewelry, electronics, vintage_clothing, general
title TEXT               -- Item name
description TEXT         -- Full description
price_min/max NUMERIC    -- Price range
listing_price NUMERIC    -- Likely selling price
ebay_category_id TEXT    -- eBay category
item_specifics JSONB     -- Domain-specific details
condition TEXT           -- Item condition
metal_type TEXT          -- For coins/jewelry: gold, silver, platinum, none
metal_weight_oz NUMERIC  -- For metal items
cogs NUMERIC             -- Cost of goods sold
image_urls TEXT[]        -- Array of image URLs
```

### Sample Test Item:

```json
{
  "id": "uuid...",
  "domain": "coins_bullion",
  "title": "US Silver Quarter 1964 Kennedy",
  "description": "1964 Kennedy silver half dollar, 90% silver content, excellent condition",
  "price_min": 45.0,
  "price_max": 65.0,
  "listing_price": 55.0,
  "ebay_category_id": "2536",
  "item_specifics": {
    "Year": "1964",
    "Composition": "Silver",
    "Grade": "MS-63"
  },
  "condition": "Excellent",
  "metal_type": "silver",
  "metal_weight_oz": 0.3617,
  "cogs": 18.5
}
```

## Running Tests in Production

After CI/CD passes:

```bash
# Deploy functions
supabase functions deploy --use-api

# View results in Supabase dashboard
# https://supabase.com/dashboard/project/wcednzaxmxwfiijzmjmx/functions
```

## Adding More Tests

### For new edge functions:

1. Create `supabase/functions/my-function/test.ts`
2. Import test helpers:
   ```typescript
   import { getTestItemByDomain } from "../_test-helpers/test-db.ts";
   ```
3. Write tests using Deno's `Deno.test()`:
   ```typescript
   Deno.test("my-function: does X", async () => {
     // arrange
     const item = await getTestItemByDomain("coins_bullion");

     // act
     const result = await callMyFunction(item);

     // assert
     assert(result.success);
   });
   ```
4. Tests automatically run in CI/CD when pushed

### For frontend tests:

Add tests in `src/` tree: `*.test.ts` or `*.spec.ts`

Run with: `bun run test`

## Troubleshooting

### Tests fail locally but pass in CI

Common causes:

- Supabase not fully started (wait 45 seconds)
- Different .env setup — verify `SUPABASE_URL` and keys
- Functions not deployed: run `supabase functions serve`

### Database tests timeout

- Check Postgres health: `docker ps -a | grep postgres`
- Restart Supabase: `supabase stop && supabase start`

### Function tests hang

- Verify function is deployed: `supabase functions list`
- Check if local functions server is running on port 54321
- Test connectivity: `curl http://localhost:54321/functions/v1/analyze-item`

## Next Steps

1. ✅ **Commit this migration** to main
2. ✅ **Push to GitHub** to trigger CI/CD
3. **Monitor** first CI/CD run to catch any issues
4. **Expand tests** — add more functions as needed
5. **Track coverage** — use test results to identify gaps

## Questions?

See:

- Test helper: `supabase/functions/_test-helpers/test-db.ts`
- Example tests: `supabase/functions/analyze-item/test.ts`
- CI config: `.github/workflows/test.yml`
