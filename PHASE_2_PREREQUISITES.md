# Phase 2 Pre-Coding Prerequisites — Complete Guide

**Status:** 2/4 Prerequisites Completed ✅  
**Blocking:** Items 3-4 must be completed before Phase 2 edge function implementation

---

## ✅ Completed: Items 1 & 2

### 1. ✅ Added `commerce.identity.readonly` OAuth Scope
**File:** [supabase/functions/ebay-publish/index.ts](supabase/functions/ebay-publish/index.ts#L1043-L1047)  
**What was done:** Added `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly` to the OAuth scopes list (line 1047).

**Impact:** OQ-5 (Option B) — Forces existing users to re-authenticate with the new scope when they next connect/reconnect eBay accounts. Phase 6 deployment will include a token-clear step to accelerate this.

---

### 2. ✅ Removed `recordUsage('ai_analysis')` Double-Count
**File:** [src/pages/AnalyzePage.tsx](src/pages/AnalyzePage.tsx#L151)  
**What was done:** Removed the client-side `await recordUsage("ai_analysis");` call (line 151). Replaced with comment explaining server-side insertion.

**Impact:** OQ-12 — Each analysis is now counted exactly once (server-side only by `analyze-item` edge function). Prevents double-counted usage that would exhaust credits at 2× intended rate.

---

## ⏳ Remaining: Items 3 & 4

### 3. Verify `subscriptions` RLS Policy is Working

**Objective:** Ensure the RLS policy added in Phase 1 is functioning correctly.

**Test 1: Verify RLS is Enabled**
```sql
SELECT tablename, rowsecurity
FROM pg_tables 
WHERE tablename = 'subscriptions';
```

Expected result: `rowsecurity = true`

**Test 2: Verify Policy Exists**
```sql
SELECT policyname, permissive, roles, qual
FROM pg_policies 
WHERE tablename = 'subscriptions';
```

Expected result: One policy named `"Users can read own subscription"` with `qual = (user_id = auth.uid())`

**Test 3: Cross-Org Read Prevention (must be authenticated user)**
```sql
-- Sign in as User A, then run:
SELECT * FROM subscriptions WHERE user_id != auth.uid();
-- Should return 0 rows (RLS blocks cross-user reads)

-- Then sign in as User B and verify the same
```

Expected result: Both users only see their own subscription rows.

**Test 4: Service Role Bypass (used by get-free-credits)**
```sql
-- Service role queries bypass RLS
-- This is expected behavior for backend functions that need unrestricted access
```

**Verification Script:**
```bash
# From workspace root, run these SQL checks against Supabase:
psql "$SUPABASE_DB_URL" <<EOF
-- 1. RLS enabled?
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'subscriptions';

-- 2. Policy exists?
SELECT policyname FROM pg_policies WHERE tablename = 'subscriptions';

-- 3. Create test: insert a dummy subscription to verify RLS works
-- (Optional: test with your Supabase dashboard console)
EOF
```

**Blockers resolved by this test:**
- ✅ Confirms `get-free-credits` can use service role to query subscriptions safely
- ✅ Confirms client-side cross-org attacks are blocked
- ✅ Confirms user privacy enforcement

---

### 4. Refactor Tier Detection in `analyze-item` — Reduce Stripe Calls

**Current State (lines 95-110 of analyze-item/index.ts):**
- Makes 2 live Stripe API calls per analysis:
  1. `stripe.customers.list({ email: userEmail, limit: 1 })`
  2. `stripe.subscriptions.list({ customer: <id>, ... })`
- Runs these calls for EVERY user, including Starter tier users who have no subscription (wasteful)

**Problem:**
- High latency: ~1-2 seconds per Stripe call
- High cost: Stripe charges for list operations
- Inconsistent with Per-org quotas: Tier detection should be cache-aware

**Solution Options:**

#### Option A: Use `subscriptions` Table Cache (Recommended)
The `subscriptions` table already exists (verified in Phase 1). It's populated by the Stripe webhook and should contain all active subscriptions.

**Implementation:**
```typescript
// Before: 2 Stripe calls for every user
// After: 1 DB query for active subscriptions, fall through to Stripe only on cache miss

let tier: "starter" | "pro" | "unlimited" = isAdmin ? "unlimited" : "starter";

if (!isAdmin && userEmail) {
  try {
    // 1. Check subscriptions table (fast, cached)
    const { data: subs, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_product_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1);
    
    if (!subError && subs && subs.length > 0) {
      const productId = subs[0].stripe_product_id;
      if (productId === "prod_U70aT1KvuI2uDx") tier = "unlimited";
      else if (productId === "prod_U6zUiC1SYuPrGU") tier = "pro";
    } else {
      // 2. Cache miss: fall back to Stripe (slower, but infrequent)
      const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
      const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basial" });
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
      if (customers.data.length > 0) {
        const subs = await stripe.subscriptions.list({ 
          customer: customers.data[0].id, 
          status: "active", 
          limit: 1 
        });
        if (subs.data.length > 0) {
          const productId = subs.data[0].items.data[0].price.product;
          if (productId === "prod_U70aT1KvuI2uDx") tier = "unlimited";
          else if (productId === "prod_U6zUiC1SYuPrGU") tier = "pro";
        }
      }
    }
  } catch (err) {
    console.error("Tier detection failed, defaulting to starter:", err);
  }
}
```

**Benefits:**
- DB query: ~10-50ms (much faster than Stripe)
- Reduces Stripe calls by ~90% (only on cache miss)
- Webhook-backed: subscriptions table stays in sync with Stripe
- Reduces per-analysis latency from ~2s to ~100-200ms (including DB + Stripe fallback)

**Assumptions to verify:**
- `subscriptions` table has `user_id`, `status`, `stripe_product_id` columns
- Webhook populates this table on Stripe events
- RLS policy allows service role bypass (it does — Phase 1 confirmed)

**Verification:**
```sql
-- Confirm subscriptions table schema
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'subscriptions' 
ORDER BY ordinal_position;

-- Check if webhook is populating the table
SELECT COUNT(*) as subscription_count, status
FROM subscriptions 
GROUP BY status;
```

#### Option B: Use Auth-Cached Tier (If Available)
If `auth.users.raw_user_meta_data` already stores tier, that would be fastest (0 DB calls). Check:
```sql
SELECT raw_user_meta_data FROM auth.users LIMIT 1;
-- If it contains tier info, we can use: (auth.jwt() -> 'user_metadata' ->> 'tier')
```

---

## Action Items Before Phase 2 Implementation

### Step 1: Verify Subscriptions RLS
Run the verification script from Item 3 above. Confirm all 4 tests pass.

### Step 2: Inspect Subscriptions Table
```sql
DESCRIBE subscriptions;  -- or:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'subscriptions';
```

Confirm columns: `user_id`, `status`, `stripe_product_id` (or equivalent).

### Step 3: Refactor analyze-item Tier Detection
Based on your findings from Step 2, apply Option A above (DB cache-first) or Option B (auth metadata).

**File to modify:** [supabase/functions/analyze-item/index.ts](supabase/functions/analyze-item/index.ts#L95-L110)

**Lines to replace:** 95-110 (the entire tier detection block)

### Step 4: Test Tier Detection
After refactoring, verify tier detection still works:
```bash
# Call analyze-item with a Starter user
# Expected: fast tier detection without Stripe calls (or with Stripe fallback)

# Call analyze-item with a Pro/Unlimited user
# Expected: correct tier detected from subscriptions table
```

---

## Next: Phase 2 Edge Function Implementation

Once all 4 prerequisites are complete, you're ready to implement the 4 Phase 2 edge functions:

1. **analyze-item** — eBay gate, per-org quota, field allowlist, credit metadata
2. **ebay-publish** — Identity API call, one-account enforcement
3. **get-free-credits** — Lightweight credit status endpoint
4. **disconnect-ebay** — Server-side eBay disconnect

See [FREE_TIER_IMPLEMENTATION_PLAN.md §3](FREE_TIER_IMPLEMENTATION_PLAN.md#3-backend--edge-function-changes) for detailed pseudocode and reference implementations.

