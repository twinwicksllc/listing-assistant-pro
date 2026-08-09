# Free Tier Gating — Complete Implementation Plan

**Branch:** `pr/category-verify-a8c2406`  
**Date drafted:** 2026-03-18  
**Scope:** Enforce a gated free AI tier (all fields needed to publish to eBay; pricing/melt/competitor data/grading rationale locked to paid; eBay account required; 6 analyses/month **per org** with rolling-window reset) and keep paid tiers (Pro, Unlimited) unrestricted beyond existing limits.

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Data / Schema Changes](#2-data--schema-changes)
3. [Backend — Edge Function Changes](#3-backend--edge-function-changes)
4. [Front-End Changes](#4-front-end-changes)
5. [Telemetry & Edge Cases](#5-telemetry--edge-cases)
6. [Security & Abuse Notes](#6-security--abuse-notes)
7. [Complete Implementation Checklist](#7-complete-implementation-checklist)
8. [Open Questions](#8-open-questions)

---

## 1. Current State Audit

### What already exists

| Area                                  | Current behaviour                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Free (Starter) monthly analysis limit | **5/month**, reset on calendar-month boundary (1st of month)                              |
| Free tier feature scope               | Full AI response — title, description, pricing, melt value, grades, competitor data       |
| eBay account gate for free users      | None — analysis runs with or without a connected eBay account                             |
| One-account enforcement               | None — a user can connect and reconnect to any eBay account                               |
| eBay username stored in profiles      | No — only raw tokens (`ebay_access_token`, `ebay_refresh_token`, `ebay_token_expires_at`) |
| Credit counter location               | `usage_tracking` table, `action_type = 'ai_analysis'` rows; counted per calendar month    |
| Reset anchor                          | Calendar month (1st → last day); Starter = 5, Pro = 50, Unlimited = ∞                     |
| Front-end credit display              | BillingPage only — raw count vs. plan limit, no remaining indicator on Analyze/Dashboard  |
| Paid-tier gating                      | `AuthContext` + `analyze-item` edge function both enforce limits                          |
| Admin bypass                          | `twinwicksllc@gmail.com` hard-coded in `AuthContext` and `analyze-item`                   |

### What must change

- Starter limit: 5 → **6**
- Reset boundary: calendar-month → **rolling window anchored to reset_day**
- Free tier AI output: full response → **title + description + condition + eBay category + item specifics** (all fields needed to publish); pricing, melt value, competitor data, grading rationale locked to paid (OQ-1 RESOLVED: BROAD)
- eBay account gate: none → **connected account required for free users**
- One-account rule: none → **enforce single eBay account per non-Unlimited-tier user** (OQ-3 RESOLVED: gate on LA Unlimited plan, not eBay business accountType)
- eBay username: not stored → **store in `profiles.ebay_username`**
- Credit UX: BillingPage only → **Dashboard, Analyze, Settings, BottomNav badge**

---

## 2. Data / Schema Changes

### 2.1 Migration: `profiles` + `organizations` + `usage_tracking` additions

**File to create:** `supabase/migrations/20260318100000_free_tier_tracking.sql`

```sql
-- ── profiles: eBay connection metadata ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ebay_username          TEXT,
  ADD COLUMN IF NOT EXISTS ebay_account_type      TEXT
    CHECK (ebay_account_type IN ('individual', 'business'));
-- ebay_username:      Connected eBay account username; NULL = no account linked.
--                     Written only by the exchange_code action (service role).
--                     Used to enforce the one-account rule for non-Unlimited users.
-- ebay_account_type:  'individual' | 'business' from eBay Identity API — informational only;
--                     NOT used for access-control decisions (OQ-3 RESOLVED).

-- ── organizations: rolling-window reset anchor (OQ-4 RESOLVED: per-org quota) ─
-- (OQ-2 RESOLVED: anchor = account creation day, set by handle_new_user trigger)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS free_tier_reset_day    SMALLINT
    CHECK (free_tier_reset_day BETWEEN 1 AND 31);
-- free_tier_reset_day: Day-of-month (1–31) when this org's free credit window resets.
--                      Set by handle_new_user trigger at org creation (= user signup day).
--                      NULL for orgs created before this migration → fresh-start on deploy
--                      (OQ-7 RESOLVED: fresh start is acceptable).

-- ── usage_tracking: org affiliation for per-org quota counting ──────────────────
ALTER TABLE public.usage_tracking
  ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES public.organizations(id);
-- org_id: The organization this usage event belongs to.
--         Populated by analyze-item (and publish functions) via service role.
--         Per-org credit checks: WHERE org_id = <orgId> instead of WHERE user_id = <userId>.

-- Index for per-org rolling-window count queries (performance)
CREATE INDEX IF NOT EXISTS idx_usage_tracking_org_action_ts
  ON public.usage_tracking (org_id, action_type, created_at);

-- Backfill existing rows: attribute to each user's earliest org membership
UPDATE public.usage_tracking ut
SET org_id = (
  SELECT om.org_id
  FROM public.organization_members om
  WHERE om.user_id = ut.user_id
  ORDER BY om.created_at ASC
  LIMIT 1
)
WHERE ut.org_id IS NULL;

-- Update handle_new_user trigger: after org INSERT, set free_tier_reset_day
-- (Add to the existing trigger body immediately after the org INSERT)
-- UPDATE public.organizations
--   SET free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT
--   WHERE id = <new_org_id>;
```

### 2.2 Helper PL/pgSQL function for window-start computation

Add to the same migration:

```sql
CREATE OR REPLACE FUNCTION public.get_free_tier_window_start(p_reset_day SMALLINT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_this_month_last_day  INT;
  v_last_month_last_day  INT;
  v_this_window          DATE;
  v_prev_window          DATE;
BEGIN
  -- Days in current month
  v_this_month_last_day := EXTRACT(DAY FROM
    (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day'));

  -- Clamp reset_day to this month's length
  v_this_window := DATE_TRUNC('month', NOW()::DATE)
    + (LEAST(p_reset_day, v_this_month_last_day) - 1);

  IF v_this_window <= NOW()::DATE THEN
    RETURN v_this_window::TIMESTAMPTZ;
  END IF;

  -- This month's day hasn't arrived yet — use previous month
  v_last_month_last_day := EXTRACT(DAY FROM
    (DATE_TRUNC('month', NOW() - INTERVAL '1 month') + INTERVAL '1 month' - INTERVAL '1 day'));

  v_prev_window := DATE_TRUNC('month', (NOW() - INTERVAL '1 month')::DATE)
    + (LEAST(p_reset_day, v_last_month_last_day) - 1);

  RETURN v_prev_window::TIMESTAMPTZ;
END; $$;

COMMENT ON FUNCTION public.get_free_tier_window_start IS
  'Returns the UTC timestamp marking the start of a user''s current free-credit window.
   Clamps reset_day to the last day of the month when that day does not exist
   (e.g., reset_day=31 in February → Feb 28/29).';
```

### 2.3 `usage_tracking` table — `org_id` column added (OQ-4 RESOLVED)

An `org_id TEXT` column is added (see §2.1 migration) so credits are counted per-org instead of per-user. The index `idx_usage_tracking_org_action_ts` speeds up the per-org rolling-window query.

The window-start function (§2.2) lets edge functions compute `WHERE created_at >= get_free_tier_window_start(reset_day)` instead of `WHERE created_at >= date_trunc('month', now())`. When counting for a free-tier user, the query uses `.eq('org_id', orgId)` rather than `.eq('user_id', userId)`.

### 2.4 `subscriptions` table — CONFIRMED present (OQ-11 RESOLVED)

✅ **Confirmed.** The `subscriptions` table exists in production. Supabase reports an "unrestricted" RLS label — no SELECT policy exists, meaning any authenticated user can query any row.

**Security action required (Phase 1):** Add a row-level security SELECT policy before coding `get-free-credits`.

```sql
-- Add to Phase 1 migration (or a separate migration)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
  -- ⚠ Verify 'user_id' column name matches the actual subscriptions schema before applying
```

`get-free-credits` (§3.3) uses service role, which bypasses RLS — no change needed there. The policy protects the table from client-side cross-user reads.

### 2.5 Add `free_analysis_limit` to `PLANS` constant (front-end)

Update `src/contexts/AuthContext.tsx`:

```ts
starter: { name: "Starter", price: 0, analysisLimit: 6, publishLimit: 6 },
//                                                    ^ was 5  ^ was 3 (OQ-10 RESOLVED)
```

---

## 3. Backend — Edge Function Changes

### 3.0 Confirmed Prerequisites (resolve before any coding in Phase 2)

#### 3.0.1 eBay OAuth `identity` scope — CONFIRMED BLOCKER

Code inspection confirms the current OAuth scopes in `ebay-publish/index.ts` are: `api_scope`, `sell.inventory`, `sell.account`, `sell.fulfillment.readonly`. The `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly` scope is **absent**. Every part of §3.2 (username capture, one-account rule) depends on calling the Identity API with the user token. Without this scope, the Identity API returns 403 for production tokens. Adding this scope retroactively forces all existing connected users to re-authorize.

**Action required before Phase 2:**

1. Add `https://api.ebay.com/oauth/api_scope/commerce.identity.readonly` to the scopes list in `get_auth_url`
2. **Re-auth strategy: Option B selected (OQ-5 RESOLVED — forced re-auth).** On migration deploy, NULL all `profiles.ebay_access_token`, `profiles.ebay_refresh_token`, and `profiles.ebay_token_expires_at`. Every existing connected user will be prompted to reconnect on their next eBay-dependent action. The deployment migration must include this step (see §7 Phase 6 checklist).
3. Note: `ebay-user/index.ts` already calls the Identity API today (OQ-15 RESOLVED: confirmed working in production with live tokens — no `commerce.identity.readonly` scope needed to read `ebay-user` today, but it will be needed after the scope change).

#### 3.0.2 Double-counted usage rows — verify before coding

`analyze-item` inserts a `usage_tracking` row server-side. `AuthContext.recordUsage('ai_analysis')` also inserts one client-side. If `AnalyzePage.handleGenerate()` calls `recordUsage('ai_analysis')` after a successful response, every analysis is **double-counted** — the rolling-window credit check would see 2× the actual usage and exhaust credits at twice the intended rate.

**Action required:** ~~Audit `AnalyzePage.handleGenerate()` for `recordUsage` calls.~~ **OQ-12 RESOLVED.**

Audit complete. Findings:

- **`src/pages/AnalyzePage.tsx` line 151**: `await recordUsage("ai_analysis")` — **DOUBLE-COUNT. Remove this line.** `analyze-item` already inserts a server-side usage row. This client-side call causes every analysis to count twice.
- **Line 344**: `await recordUsage("ebay_publish")` — **SAFE. Keep.** Confirmed: `ebay-publish` edge function does NOT insert to `usage_tracking`. This client-side call is the sole tracking point for publish events.
- **Line 874**: `recordUsage("export")` — **SAFE. Keep.** No server-side counterpart.

**Action: Remove line 151 in `AnalyzePage.tsx` before deploying Phase 2.** After removal, `analyze-item` is the sole insertion point for `ai_analysis` usage rows.

#### 3.0.3 Tier detection fragmentation — consolidate before adding more branches

`analyze-item`, `check-subscription`, and the proposed `get-free-credits` each independently determine subscription tier via separate Stripe API calls. `analyze-item` makes **two live Stripe calls** (`customers.list` + `subscriptions.list`) on every invocation — including for Starter users who have no Stripe subscription, making both calls vacuous. Three divergent tier-detection paths create a long-term maintenance hazard and a source of tier-detection drift.

**Recommended before Phase 2:** Refactor `analyze-item` to use the `check-subscription` function (or the `subscriptions` cache table if confirmed present — see §2.4) for tier detection, falling through to live Stripe only on cache miss. For a Starter user with no subscription, this reduces the upfront cost from 2 live Stripe calls to 0.

**Latency note:** Even after consolidation, the new `analyze-item` flow adds a `profiles` SELECT + `get_free_tier_window_start` RPC + `usage_tracking` COUNT + conditional `profiles` UPDATE — approximately 4 serial DB round-trips (~100–200 ms total) before the Gemini call. Combined with the existing Stripe call, cold-start invocations will feel slow. The Stripe consolidation above removes one of the most expensive round-trips; the DB ops should be profiled after staging deployment.

---

### 3.1 `analyze-item/index.ts` — Primary changes

#### 3.1.1 eBay account gate (free users only)

```ts
// After tier detection, before usage check:
if (tier === "starter") {
  // Check eBay connection (per-user — eBay token is stored on profiles, not orgs)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("ebay_access_token")
    .eq("id", userId)
    .single();

  if (!profile?.ebay_access_token) {
    return new Response(
      JSON.stringify({
        error: "ebay_account_required",
        message: "Connect an eBay account to start generating listings.",
      }),
      { status: 403 },
    );
  }

  // Resolve org for per-org quota (OQ-4 RESOLVED: quota is per-org, not per-user)
  const { data: orgMember } = await supabaseAdmin
    .from("organization_members")
    .select("org_id, organizations(free_tier_reset_day)")
    .eq("user_id", userId)
    .single();

  orgId = orgMember?.org_id ?? null;
  orgResetDay = (orgMember?.organizations as any)?.free_tier_reset_day ?? null;
}
```

#### 3.1.2 Rolling-window credit count (replaces calendar-month count)

```ts
// Replace existing calendar-month usage query for free users:
let windowStart: string;
if (tier === "starter") {
  const resetDay = orgResetDay; // from org lookup in §3.1.1
  if (resetDay) {
    const { data: ws } = await supabaseAdmin.rpc("get_free_tier_window_start", {
      p_reset_day: resetDay,
    });
    windowStart = ws;
  } else {
    // Org created before migration (NULL reset_day) — fresh-start window
    windowStart = new Date().toISOString();
  }
} else {
  // Pro/Unlimited: continue using calendar month
  windowStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).toISOString();
}

// Per-org count for Starter; per-user count for paid tiers (OQ-4 RESOLVED)
const usageQuery = supabaseAdmin
  .from("usage_tracking")
  .select("id", { count: "exact", head: true })
  .eq("action_type", "ai_analysis")
  .gte("created_at", windowStart);

if (tier === "starter" && orgId) {
  usageQuery.eq("org_id", orgId);
} else {
  usageQuery.eq("user_id", userId);
}

const { count: usageCount } = await usageQuery;

const FREE_LIMIT = 6;
const limit = tier === "starter" ? FREE_LIMIT : tier === "pro" ? 50 : Infinity;

if (tier !== "unlimited" && usageCount >= limit) {
  return new Response(
    JSON.stringify({
      error: "usage_limit_reached",
      creditsUsed: usageCount,
      creditsRemaining: 0,
      creditsResetAt: computeNextResetAt(orgResetDay), // helper
      tier,
    }),
    { status: 429 },
  );
}
```

#### 3.1.3 `free_tier_reset_day` — set by trigger at org creation (OQ-2 RESOLVED)

> **No action needed in `analyze-item`.** OQ-2 resolved to "account creation" anchor (Option A). The `handle_new_user` DB trigger already creates a personal org for every new user. The Phase 1 migration updates this trigger to also set `organizations.free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT` at org creation time.
>
> For existing users (created before this migration), `free_tier_reset_day` remains NULL. The rolling-window code in §3.1.2 falls through to `windowStart = new Date().toISOString()` (fresh-start behaviour — OQ-7 accepted).
>
> **Remove the previous §3.1.3 code** — the `analyze-item` function must NOT write `free_tier_reset_day` to `profiles` or `organizations`. Only the `handle_new_user` trigger writes it.

#### 3.1.4 Restrict free-tier Gemini response

After receiving the Gemini response and before returning it:

Use an **allowlist** (not a denylist) to select which fields are returned for free users. A denylist requires someone to remember to add every new field added to the Gemini response in the future; an allowlist silently drops new fields until they are explicitly promoted — the safe default.

```ts
// Allowlist approach — OQ-1 RESOLVED: BROAD free tier (all fields to publish; lock only paid-analysis fields)
const FREE_TIER_ALLOWED_FIELDS = new Set([
  // Core listing fields (needed to publish to eBay)
  "title",
  "description",
  "condition",
  "conditionDescription",
  "ebayCategoryId",
  "suggestedCategories",
  "itemSpecifics", // includes Year, Denomination, Mint, Metal, Strike, etc.
  "suggestedGrade", // grade suggestion is free; grading RATIONALE is locked (paid)
  "packageWeightAndSize",
  // Add new fields here intentionally when promoting to free tier
]);

// Fields locked to paid tiers (excluded from free allowlist):
//   priceMin, priceMax         → pricing analysis (Pro+)
//   meltValue, spotPrices      → melt value / spot price (Pro+)
//   pricingNotes               → pricing narrative (Pro+)
//   gradingRationale           → detailed grading explanation (Pro+)
//   competitorListings, competitors, comparables  → competitor data (Pro+)

if (tier === "starter") {
  const fullPayload = responsePayload;
  responsePayload = Object.fromEntries(
    Object.entries(fullPayload).filter(([k]) =>
      FREE_TIER_ALLOWED_FIELDS.has(k),
    ),
  );
  // Also scrub grading rationale if nested inside itemSpecifics
  if ((responsePayload as any).itemSpecifics?.gradingRationale) {
    delete (responsePayload as any).itemSpecifics.gradingRationale;
  }
}
```

> **Note:** `suggestedGrade` is included in the free allowlist (needed to label a listing). `gradingRationale` (the detailed explanation supporting the grade) is locked — this is the paid differentiator.

#### 3.1.5 Annotate all responses with credit metadata

Add to every successful `analyze-item` response body (all tiers):

```ts
{
  ...listingData,
  _meta: {
    tier,
    creditsUsed: usageCount + 1,
    creditsRemaining: tier === 'starter'
      ? Math.max(0, FREE_LIMIT - (usageCount + 1))
      : tier === 'pro'
        ? Math.max(0, 50 - (usageCount + 1))
        : null,      // null = unlimited
    creditsResetAt: tier === 'starter'
      ? computeNextResetAt(profile.free_tier_reset_day).toISOString()
      : null,
  }
}
```

#### 3.1.6 Helper: `computeNextResetAt`

Private function at top of `analyze-item`:

```ts
function computeNextResetAt(resetDay: number | null): Date {
  const now = new Date();
  if (!resetDay) return new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const year = now.getFullYear();
  const month = now.getMonth();
  // Try this month first
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(resetDay, daysInThisMonth);
  const thisMonthDate = new Date(year, month, clampedDay);
  if (thisMonthDate > now) return thisMonthDate;

  // Next month
  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const nm = nextMonth % 12;
  const daysInNextMonth = new Date(nextYear, nm + 1, 0).getDate();
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth));
}
```

---

### 3.2 `ebay-publish/index.ts` — eBay account enforcement + username capture

#### 3.2.1 Store `ebay_username` when token is written

**Scope: `exchange_code` action only — NOT token refresh.** The token upsert path in `ebay-publish` is used for both initial OAuth code exchange and routine token refresh (refresh token → new access token). The Identity API call and one-account check must run **only on initial exchange**, never on a token refresh. Calling the Identity API on every refresh adds unnecessary latency and risks a 429 from eBay's rate limits. On a refresh-triggered write, `ebay_username` must not be overwritten — exclude those columns from the refresh path's `update()` call (OQ-13 RESOLVED: confirmed that `refresh_token` action's `updatePatch` only contains token fields, not username columns — already safe).

```ts
// Guard: only run Identity API + one-account check on initial code exchange
if (action === "exchange_code") {
  // ... Identity API call and username write below ...
  // Token refresh paths skip this block entirely
}
```

In the `exchange_code` action, after writing `ebay_access_token` to `profiles`:

```ts
// After writing ebay_access_token to profiles:
// Fetch account details from eBay Identity API
const identityRes = await fetch(
  "https://apiz.ebay.com/commerce/identity/v1/user/",
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const identity = await identityRes.json();
const newUsername = identity?.userId ?? identity?.username ?? null;
const accountType = identity?.accountType?.toLowerCase() ?? "individual"; // 'individual' | 'business'

// OQ-3 RESOLVED: only Unlimited LA plan subscribers may connect multiple eBay accounts.
// Gate on LA subscription tier, NOT on eBay account type.
// ebay_account_type is stored for informational/UI purposes only; it is NOT used here.
const isUnlimitedTier = tier === "unlimited"; // tier = LA plan, determined earlier in exchange_code

if (
  existingProfile?.ebay_username &&
  existingProfile.ebay_username !== newUsername &&
  !isUnlimitedTier
) {
  return new Response(
    JSON.stringify({
      error: "account_already_linked",
      message: `This Listing Assistant account is already linked to eBay user
              "${existingProfile.ebay_username}". Disconnect it before connecting a new account.`,
    }),
    { status: 409 },
  );
}

await supabaseAdmin
  .from("profiles")
  .update({
    ebay_username: newUsername,
    ebay_account_type: accountType,
  })
  .eq("id", userId);
```

#### 3.2.2 `get_stored_token` — include username in response

```ts
return { token, postalCode, city, isExpired, ebayUsername, ebayAccountType };
```

---

### 3.3 New edge function: `get-free-credits` (lightweight credit status)

This allows the Dashboard and Settings to show credit status without triggering a full analysis.

**File:** `supabase/functions/get-free-credits/index.ts`

```ts
// Auth → get userId from JWT (do NOT trust a client-supplied userId)
// Fetch: organizations.free_tier_reset_day (via org_members join), profiles.ebay_username, profiles.ebay_access_token
//
// ⚠ This function uses service role — bypasses RLS.
//   ALWAYS filter usage_tracking by org_id (Starter) or user_id explicitly.
//   Do NOT copy AuthContext's client-side query which relies on RLS for filtering.
//
// Subscription check:
//   - Query subscriptions table (OQ-11 RESOLVED: confirmed present in prod)
//   - Fix unrestricted RLS on subscriptions table before deploying (see §2.4)
//
// If tier !== 'starter': return { tier, creditsUsed: null, creditsRemaining: null, ... }
// Else: compute window_start via get_free_tier_window_start RPC
//       count usage_tracking rows WHERE org_id = orgId  ← OQ-4: per-org quota
//         AND action_type = 'ai_analysis' AND created_at >= window_start
//       return:
{
  tier: 'starter',
  ebayConnected: !!profile.ebay_access_token,
  ebayUsername: profile.ebay_username ?? null,
  creditsUsed: count,
  creditsRemaining: Math.max(0, 6 - count),
  creditsResetAt: computeNextResetAt(profile.free_tier_reset_day).toISOString(),
  resetDay: profile.free_tier_reset_day,
}
```

Register in `supabase/config.toml` under `[functions.get-free-credits]`.

---

### 3.4 `ebay-user/index.ts` — confirmed Identity API caller (coordinate write paths)

> **Confirmed:** `ebay-user/index.ts` already calls `/commerce/identity/v1/user/` and returns `username`, `accountType` (as `"INDIVIDUAL"` or `"BUSINESS"`), `businessName`, and `userId`. It does NOT currently persist anything to `profiles`.
>
> The `exchange_code` flow in §3.2.1 also needs to make an Identity API call. To avoid duplicating that call, consider having `exchange_code` call `ebay-user` internally (passing the fresh access token) so the Identity API is called exactly once per connection. Regardless of implementation, `ebay-user` must NOT write to `profiles` — that write belongs only in `exchange_code` via service role so the one-account gate check and the username write are atomic.

---

## 4. Front-End Changes

### 4.1 `src/contexts/AuthContext.tsx`

#### 4.1.1 New state

```ts
interface FreeCredits {
  used: number;
  remaining: number;
  resetAt: Date | null;
  resetDay: number | null;
}

interface AuthContextType {
  // ... existing fields ...
  freeCredits: FreeCredits | null; // null for paid users
  ebayConnected: boolean;
  ebayUsername: string | null;
  refreshFreeCredits: () => Promise<void>;
}
```

#### 4.1.2 `refreshFreeCredits()`

```ts
const refreshFreeCredits = useCallback(async () => {
  if (!session) return;
  const { data, error } = await supabase.functions.invoke("get-free-credits");
  if (error || !data) return;
  if (data.tier !== "starter") {
    setFreeCredits(null);
    setEbayConnected(data.ebayConnected ?? false);
    setEbayUsername(data.ebayUsername ?? null);
    return;
  }
  setFreeCredits({
    used: data.creditsUsed,
    remaining: data.creditsRemaining,
    resetAt: data.creditsResetAt ? new Date(data.creditsResetAt) : null,
    resetDay: data.resetDay,
  });
  setEbayConnected(data.ebayConnected);
  setEbayUsername(data.ebayUsername);
}, [session]);
```

#### 4.1.3 `canAnalyze` logic update

```ts
// Replace the existing finalCanAnalyze expression:
const finalCanAnalyze = isUnlimited
  ? true
  : isPro
    ? usage.aiAnalysis < PLANS.pro.analysisLimit
    : // Starter — requires eBay connected AND credits remaining
      ebayConnected && (freeCredits?.remaining ?? 0) > 0;
```

#### 4.1.4 `canPublish` logic update (OQ-10 RESOLVED)

```ts
// Starter publish limit = 6/month (aligned with analysis limit); also requires eBay connected.
// Pro/Unlimited: keep existing logic.
const finalCanPublish = isUnlimited
  ? true
  : isPro
    ? usage.ebayPublish < PLANS.pro.publishLimit
    : // Starter — requires eBay connected AND publish credits remaining
      ebayConnected && (usage.ebayPublish ?? 0) < PLANS.starter.publishLimit;
```

> **Note:** The `get-free-credits` function should also return `publishUsed` and `publishRemaining` (in addition to `creditsUsed`/`creditsRemaining`) so the credit widget can display publish quota separately. However, since analysis and publish limits are the same (both 6), a simpler V1 approach is to show a single combined "listing credits" counter.

#### 4.1.4 Expose `freeCredits`, `ebayConnected`, `ebayUsername` in context value

#### 4.1.5 Call `refreshFreeCredits` after each `recordUsage('ai_analysis')` and on session load

#### 4.1.6 Bump starter `analysisLimit` from 5 → 6 in `PLANS`

---

### 4.2 `src/pages/AnalyzePage.tsx`

#### 4.2.1 Pre-flight eBay gate (free users)

Add at the top of `handleGenerate()`:

```tsx
if (!isPaid && !isAdmin && !ebayConnected) {
  toast.error(
    "Connect an eBay account in Settings to start generating listings.",
  );
  navigate("/settings?tab=integrations");
  return;
}
```

#### 4.2.2 Credit exhaustion gate

```tsx
if (!canAnalyze && !isAdmin) {
  // Replace the existing "Upgrade" modal with credits-specific messaging
  setShowUpgrade(true); // existing upgrade modal
  setUpgradeReason("credits"); // new: drives modal copy
  return;
}
```

#### 4.2.3 Credit counter widget (visible after analysis for free users)

After a successful analysis, if `!isPaid && !isAdmin`, show an inline banner:

```tsx
{
  !isPaid && !isAdmin && freeCredits && (
    <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-3 py-2 mt-4">
      <Sparkles className="h-4 w-4 text-amber-500" />
      <span>
        {freeCredits.remaining} of 6 free analyses remaining
        {freeCredits.resetAt && (
          <> · resets {formatDate(freeCredits.resetAt)}</>
        )}
      </span>
      {freeCredits.remaining <= 1 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/billing")}
        >
          Upgrade
        </Button>
      )}
    </div>
  );
}
```

#### 4.2.4 Lock premium result sections for free users

Wrap the Pricing, Melt Value, and Spot Price panels:

```tsx
{isPaid || isAdmin ? (
  <PricingPanel priceMin={priceMin} priceMax={priceMax} meltValue={meltValue} ... />
) : (
  <div className="relative opacity-50 pointer-events-none select-none">
    <PricingPanel ... />         {/* blurred/locked preview */}
    <div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm rounded-md">
      <div className="text-center">
        <Crown className="h-6 w-6 mx-auto mb-1 text-amber-500" />
        <p className="text-sm font-medium">Pricing analysis is a Pro feature</p>
        <Button size="sm" className="mt-2" onClick={() => navigate('/billing')}>
          Upgrade to Pro
        </Button>
      </div>
    </div>
  </div>
)}
```

Apply the same lock pattern to: `gradingRationale` display, `meltValue` banner, `spotPrices` card.

#### 4.2.5 Consume `_meta` from analyze-item response

```ts
if (result._meta) {
  await refreshFreeCredits(); // triggers re-render of credit widget
}
```

---

### 4.3 `src/pages/DashboardPage.tsx`

#### 4.3.1 Free-credits card (free users only)

Add a new summary card alongside the existing 4 cards:

```tsx
{
  !isPaid && !isAdmin && freeCredits && (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">AI Credits</CardTitle>
        <Sparkles className="h-4 w-4 text-amber-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{freeCredits.remaining}</div>
        <p className="text-xs text-muted-foreground">
          of 6 remaining · resets{" "}
          {freeCredits.resetAt ? formatDate(freeCredits.resetAt) : "—"}
        </p>
        <Progress value={(freeCredits.used / 6) * 100} className="mt-2 h-1.5" />
      </CardContent>
    </Card>
  );
}
```

#### 4.3.2 eBay connection prompt for free users

If `!isPaid && !isAdmin && !ebayConnected`:

```tsx
<Alert variant="warning" className="mb-4">
  <AlertTriangle className="h-4 w-4" />
  <AlertTitle>Connect your eBay account</AlertTitle>
  <AlertDescription>
    Free tier analysis requires a connected eBay account.{" "}
    <button
      className="underline"
      onClick={() => navigate("/settings?tab=integrations")}
    >
      Connect in Settings →
    </button>
  </AlertDescription>
</Alert>
```

---

### 4.4 `src/pages/SettingsPage.tsx` — Integrations tab

#### 4.4.1 Show connected username

Replace the generic "Connected" green dot with:

```tsx
{
  ebayConnected ? (
    <div className="flex items-center gap-2">
      <Check className="h-4 w-4 text-green-500" />
      <span className="text-sm font-medium">
        Connected as <strong>{ebayUsername ?? "eBay Account"}</strong>
      </span>
      {ebayAccountType === "business" && (
        <Badge variant="outline" className="text-xs">
          Business
        </Badge>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <X className="h-4 w-4 text-red-500" />
      <span className="text-sm text-muted-foreground">Not connected</span>
    </div>
  );
}
```

#### 4.4.2 Free-tier credit summary in Integrations tab

For Starter users, below the eBay connection status:

```tsx
{
  !isPaid && !isAdmin && freeCredits && (
    <div className="rounded-md bg-muted p-3 mt-3 text-sm space-y-1">
      <p className="font-medium">Free tier usage</p>
      <p className="text-muted-foreground">
        {freeCredits.used} of 6 analyses used this period
        {freeCredits.resetAt && ` · resets ${formatDate(freeCredits.resetAt)}`}
      </p>
      <Progress value={(freeCredits.used / 6) * 100} className="h-1.5 mt-1" />
    </div>
  );
}
```

#### 4.4.3 One-account notice for Starter and Pro users

```tsx
{
  !isUnlimited && !isAdmin && (
    <p className="text-xs text-muted-foreground mt-2">
      Free and Pro accounts may connect one eBay account. To use multiple
      accounts, upgrade to Unlimited.
    </p>
  );
}
```

> **OQ-3 RESOLVED:** Only Unlimited-tier subscribers are exempt from the one-account rule (supports multi-user orgs). Starter _and_ Pro users are both subject to the single-account limit.

---

### 4.5 `src/pages/BillingPage.tsx`

#### 4.5.1 Update Starter plan description

- Change `analysisLimit` display from 5 → **6**
- Add note: "Requires connected eBay account"
- Add note: "Rolling monthly window (resets on your signup day)"

#### 4.5.2 Credit widget on BillingPage

Show current window progress for Starter users:

```tsx
{
  !isPaid && !isAdmin && freeCredits && (
    <div className="border rounded-lg p-4 mb-6">
      <h3 className="font-semibold text-sm mb-2">This Month's AI Credits</h3>
      <div className="flex justify-between text-sm mb-1">
        <span>{freeCredits.used} used</span>
        <span>{freeCredits.remaining} remaining</span>
      </div>
      <Progress value={(freeCredits.used / 6) * 100} />
      {freeCredits.resetAt && (
        <p className="text-xs text-muted-foreground mt-1">
          Resets {formatDate(freeCredits.resetAt)}
        </p>
      )}
      {freeCredits.remaining === 0 && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Credits exhausted</AlertTitle>
          <AlertDescription>
            Upgrade to Pro for 50 analyses/month, or Unlimited for unrestricted
            access.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

#### 4.5.3 Upgrade CTA on credit exhaustion

On the Pro card, when credits are exhausted for a Starter user, add a highlighted CTA:

```tsx
{
  !isPaid && freeCredits?.remaining === 0 && (
    <Badge variant="destructive" className="mb-2">
      Credits used up — Upgrade now
    </Badge>
  );
}
```

---

### 4.6 `src/components/BottomNav.tsx` — Credit badge

Add a small credit counter badge on the Analyze nav item for free users:

```tsx
{
  !isPaid && !isAdmin && freeCredits && (
    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
      {freeCredits.remaining}
    </span>
  );
}
```

Badge is **always visible** for free users (OQ-9 RESOLVED: always visible). The count provides constant visibility into remaining credits without requiring the user to navigate to the Billing page.

---

## 5. Telemetry & Edge Cases

### 5.1 Reset-day edge cases

| Scenario                                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User first analyzes on March 31st          | `reset_day = 31`; April window starts April 30 (last day); May window starts May 31                                                                                                                                                                                                                                                                                           |
| User first analyzes on Feb 28 (non-leap)   | `reset_day = 28`; Month N window starts on 28th each month                                                                                                                                                                                                                                                                                                                    |
| User first analyzes on Feb 29 (leap year)  | `reset_day = 29`; Non-leap Feb window starts Feb 28 (clamped)                                                                                                                                                                                                                                                                                                                 |
| User has never analyzed                    | `free_tier_reset_day = NULL`; `canAnalyze` = true (up to the first analysis); window computed as "starting now"                                                                                                                                                                                                                                                               |
| **Known inequity (V1 accepted trade-off)** | A user first analyzing on the 31st is anchored there permanently. In 30-day months their window is clamped to the 30th, giving them a marginally shorter period. A user analyzing on the 1st always gets a full calendar-month window. There is no admin tool to adjust `reset_day`. Document this for support escalations; treat as a V1 known limitation rather than a bug. |

### 5.2 Time zone

All computations run in **UTC** in both the PL/pgSQL function and the Deno edge functions. Display in the UI should convert to the browser's local time (`freeCredits.resetAt.toLocaleDateString()`). Add a note in the UI tooltip: "Resets at midnight UTC on [date]."

### 5.3 Concurrent analyses (race condition)

Two tab sessions submitting simultaneously could both pass the `usageCount < 6` check before either records usage. Mitigation options:

- **Option A:** Issue a Postgres advisory lock inside `analyze-item` keyed on `userId` before the usage check. ~~Recommended~~ **Not recommended for this use case.** Postgres advisory locks in Deno edge functions are fragile: edge functions are stateless and connection-pooled. If the function crashes or times out after acquiring the lock but before releasing it, the lock persists until PgBouncer recycles the DB connection. For a hobby coin-listing free tier, this failure mode is worse than the race itself.
- **Option B (recommended):** Accept the race. The maximum over-count per burst is 1–2 extra analyses (two tabs submitting simultaneously at the limit boundary). This is tolerable for this use case. Optionally add a `pg_cron` nightly job that identifies any user with > 6 `ai_analysis` rows in a window for manual review.

### 5.4 eBay token expiry during gating check

If `ebay_access_token` exists but is expired (`ebay_token_expires_at < now()`), the eBay account is still "connected" — the token can be refreshed. The gate should check for token existence, not token validity. The expiry is handled separately when the token is actually used.

### 5.5 Disconnect-then-reconnect eBay account

When a Starter user disconnects and reconnects:

- Same username: allowed (no data loss)
- Different username: blocked with `account_already_linked` error (§3.2.1)
- If user wants to switch: must use the "Disconnect" flow first, which clears `ebay_username` in `profiles`; then the one-account check passes for the new username

**⚠ Conflict with §6 REVOKE:** The §6 Security section proposes `REVOKE UPDATE (ebay_username, ebay_account_type)` from the `authenticated` role so clients cannot spoof their own username. But `handleDisconnectEbay()` runs client-side as the `authenticated` role and needs to clear those same columns. These two requirements are mutually exclusive as originally stated.

**Resolution — two options:**

**Option A (recommended) — create a `disconnect-ebay` edge function:**
Move the disconnect DB write to a new server-side edge function (`supabase/functions/disconnect-ebay/index.ts`) that runs as service role. The client calls the function; the function clears all five columns. This preserves the REVOKE approach for direct client writes while keeping the username clearing server-authoritative.

**Option B — narrow the REVOKE scope:**
Only `REVOKE UPDATE (free_tier_reset_day)` — the column that is genuinely exploit-sensitive (controls the window start). Accept that `ebay_username` and `ebay_account_type` are client-clearable (lower risk since the server overwrites them on reconnect from the Identity API). The client can then call Supabase directly for disconnect as before.

**This plan adopts Option A.** The checklist (§7) is updated accordingly. `handleDisconnectEbay()` becomes:

```ts
const { error } = await supabase.functions.invoke("disconnect-ebay");
if (error) {
  toast.error("Failed to disconnect eBay account");
} else {
  localStorage.removeItem(EBAY_TOKEN_KEY);
  localStorage.removeItem("ebay-refresh-token");
  localStorage.removeItem("ebay-token-expires-at");
  setEbayConnected(false);
  toast.success("eBay account disconnected");
}
```

### 5.6 Org / lister accounts

**OQ-4 RESOLVED — per-org quota.** An org gets ONE shared quota (6 analyses/month) regardless of how many listers are in the org. An org lister's analyses decrement from the _org-level_ counter (`usage_tracking.org_id`). The `analyze-item` edge function counts via `WHERE org_id = <orgId>`, so all users in the same org share the same 6-analysis window. This is enforced server-side; each member cannot individually exhaust credits ahead of teammates.

### 5.7 Admin bypass correctness

`isAdmin` is checked by email in `AuthContext` and mirrored in `analyze-item`. The admin bypass skips both the eBay-required gate and the credit count check. No change needed.

### 5.8 `types.ts` is stale

The Supabase-generated `types.ts` does not reflect:

- `profiles.ebay_username`, `ebay_account_type`, `free_tier_reset_day` (to be added)
- `profiles.ebay_access_token`, `ebay_refresh_token`, `ebay_token_expires_at`, `postal_code`, `city`
- `drafts.publish_status`, `published_at`, `ebay_sku`, …
- `subscriptions` table entirely absent

After running migrations, regenerate `types.ts`:

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

Add this to the pre-deploy checklist.

### 5.9 Pro tier reset boundary

The existing Pro usage counter uses `date_trunc('month', now())` (calendar month). The new free-tier logic uses a rolling window. These are intentionally different — Pro billing aligns to Stripe billing cycles (calendar month is a reasonable proxy). No change needed to Pro counting logic.

### 5.10 Gemini cost on free tier

The analyze-item function still calls `gemini-2.5-flash` for free-tier users even though the response is stripped before delivery. Consider:

- Using `gemini-2.0-flash` for free-tier analyses (lower cost, sufficient for title/description)
- Passing a shorter/simplified prompt for free users that excludes pricing computation instructions
- Single prompt toggle: add a `tier` variable to the system prompt and instruct the model to skip pricing when `tier === 'starter'`

This is a cost optimization, not a correctness issue; defer to a follow-up task unless Gemini cost is already a concern.

---

## 6. Security & Abuse Notes

| Threat                                                                 | Mitigation                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client bypasses credit check by calling edge function directly         | `analyze-item` enforces the count server-side; client-side `canAnalyze` is UI-only                                                                                                                                                                                               |
| User creates multiple Listing Assistant accounts to reset free credits | Each Supabase user has a separate quota; email verification (Supabase default) provides deterrence. Rate-limit new signups with Supabase Auth settings if abuse detected                                                                                                         |
| eBay account shared across multiple Listing Assistant users            | One-account rule (§3.2.1) blocks this at token-store time                                                                                                                                                                                                                        |
| Race condition double-spend on credits                                 | Accept the race (§5.3 Option B). Max over-count is ≤1–2 per burst; advisory lock not recommended in edge function context                                                                                                                                                        |
| Raw eBay tokens exposed to client                                      | `get_stored_token` never returns `access_token`; only metadata (`username`, `postalCode`, `city`, `isExpired`). `analyze-item` and `ebay-publish` use the token server-side only                                                                                                 |
| `ebay_username` spoofing                                               | `ebay_username` is written only by the server-side `store_token` action after an actual eBay Identity API call; the client cannot write `profiles` directly (RLS: users can only update their own row, and the username column should be excluded from client-updatable columns) |
| `free_tier_reset_day` manipulation                                     | Same RLS concern — add a Postgres policy or trigger preventing client-direct updates to `free_tier_reset_day`; only the `analyze-item` service-role write path should set it                                                                                                     |
| Admin email list hard-coded                                            | Consider migrating `ADMIN_EMAILS` to a `profiles.is_admin BOOLEAN` column set by DB admins, or an environment variable. Current hard-coding creates a maintenance vector                                                                                                         |

### RLS additions required

Add to the migration or a separate migration:

```sql
-- Prevent authenticated users from self-updating sensitive free-tier fields
-- (The service role used by edge functions bypasses RLS and can still write them)
CREATE POLICY "Users cannot modify free tier tracking fields"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    -- Allow updates but block changes to system-managed columns
    free_tier_reset_day IS NOT DISTINCT FROM free_tier_reset_day
    -- Note: Postgres column-level privileges are cleaner here; see note below
  );
```

> **Revised approach (resolves §5.5 disconnect conflict):** Only `REVOKE UPDATE (free_tier_reset_day)` from the `authenticated` role — this column is the exploit-sensitive one (controls the window start date). For `ebay_username` and `ebay_account_type`, routing disconnect through the `disconnect-ebay` edge function (service role) makes those writes server-authoritative without needing a column-level revoke. The service role always retains write access to all columns.

```sql
REVOKE UPDATE (free_tier_reset_day)
  ON public.organizations FROM authenticated;
-- Note: free_tier_reset_day is on organizations, not profiles (OQ-2 RESOLVED: set by handle_new_user trigger)
```

> The `disconnect-ebay` edge function handles clearing `ebay_username` and `ebay_account_type` server-side (see §5.5 Option A).

---

## 7. Complete Implementation Checklist

### Phase 1 — Data layer

- [ ] **Migration:** `20260318100000_free_tier_tracking.sql`
  - [ ] Add `profiles.ebay_username TEXT`
  - [ ] Add `profiles.ebay_account_type TEXT CHECK (...)`
  - [ ] Add `organizations.free_tier_reset_day SMALLINT CHECK (1..31)` (OQ-2 RESOLVED: set by trigger at org/account creation, NOT by `analyze-item`)
  - [ ] Add `usage_tracking.org_id TEXT REFERENCES organizations(id)` + index `idx_usage_tracking_org_action_ts` (OQ-4 RESOLVED: per-org quota)
  - [ ] Backfill `usage_tracking.org_id` from `organization_members` for existing rows
  - [ ] Update `handle_new_user` Postgres trigger to set `organizations.free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT` on org INSERT
  - [ ] Create `get_free_tier_window_start(SMALLINT)` PL/pgSQL function — **use `INTERVAL '1 month' - INTERVAL '1 day'` not the invalid `INTERVAL '1 month - 1 day'`**
  - [ ] `REVOKE UPDATE (free_tier_reset_day)` on `public.organizations` from `authenticated` role (see §5.5 — not profiles; `ebay_username`/`ebay_account_type` are handled via `disconnect-ebay` edge function)
  - [ ] Add `subscriptions` table RLS SELECT policy (see §2.4 — OQ-11: unrestricted RLS warning)
- [ ] **Regenerate `src/integrations/supabase/types.ts`** after applying migration
- [ ] **Update `PLANS.starter`** in `AuthContext.tsx`: `analysisLimit` 5 → 6, `publishLimit` 3 → 6 (OQ-10 RESOLVED)
- [ ] Verify `usage_tracking` index on `(user_id, action_type, created_at)` exists (already present per migration audit)

### Phase 2 — Edge functions

#### Pre-coding (resolve before any Phase 2 work)

- [ ] **Add `commerce.identity.readonly` OAuth scope** to `get_auth_url` in `ebay-publish` (§3.0.1 — OQ-5 RESOLVED: Option B hard reset selected; see Phase 6 for token-clear step)
- [ ] **Remove `recordUsage('ai_analysis')` at ~line 151 of `AnalyzePage.tsx`** (OQ-12 RESOLVED: confirmed double-count; `analyze-item` is the sole insertion point)
- [x] ~~**Verify `subscriptions` table** exists in production DB~~ — **DONE: Confirmed present; unrestricted RLS warning noted (§2.4 / OQ-11)**
- [ ] **Refactor tier detection in `analyze-item`** to use cached Stripe data instead of two live Stripe calls per invocation (§3.0.3)
- [x] ~~**Test `ebay-user` in production** with a live token~~ — **DONE: Confirmed working (OQ-15)**

#### `analyze-item`

- [ ] Add eBay account gate for Starter users (403 `ebay_account_required`)
- [ ] Resolve org for per-org quota (lookup `organization_members` by `user_id` to get `org_id` + `free_tier_reset_day`) (OQ-4 RESOLVED)
- [ ] Replace calendar-month usage count with `get_free_tier_window_start` RPC call; count via `org_id` for Starter (OQ-4)
- [ ] Update Starter limit constant: 5 → 6
- [ ] ~~Set `free_tier_reset_day` on first analysis~~ — **REMOVED: set by `handle_new_user` trigger at account creation (OQ-2 RESOLVED)**
- [ ] Use **allowlist** (not denylist) to restrict Starter response fields (§3.1.4)
- [ ] Add `_meta` block (`tier`, `creditsUsed`, `creditsRemaining`, `creditsResetAt`) to all responses
- [ ] Implement `computeNextResetAt()` helper with last-day clamping
- [ ] Accept race condition for double-spend (no advisory lock — §5.3 Option B)
- [ ] Return `429` with credit metadata on exhaustion

#### `ebay-publish` (`exchange_code` action only — NOT token refresh)

- [ ] **Prerequisite:** `commerce.identity.readonly` scope added to `get_auth_url` (pre-coding item above)
- [ ] In `exchange_code` action only (guard with `if (action === 'exchange_code')`): call eBay Identity API for username + accountType
- [ ] Enforce one-account rule before writing token (409 `account_already_linked`)
- [ ] Persist `ebay_username` + `ebay_account_type` to `profiles` via service role
- [ ] Include `ebayUsername` + `ebayAccountType` in `get_stored_token` response
- [ ] Verify token **refresh** path does NOT call Identity API or overwrite `ebay_username`

#### New: `get-free-credits`

- [x] ~~**Prerequisite:** Confirm `subscriptions` table existence~~ — **DONE (OQ-11 RESOLVED)**
- [ ] Create `supabase/functions/get-free-credits/index.ts`
- [ ] Auth → tier detection (query `subscriptions` table — confirmed present; fix unrestricted RLS first per §2.4)
- [ ] **MUST filter `usage_tracking` by `org_id` for Starter users** (OQ-4 RESOLVED: per-org quota); still filter by `user_id` for non-org edge cases
- [ ] (**Service role bypasses RLS — never copy client-side query pattern**)
- [ ] Return credit metadata + `ebayConnected` + `ebayUsername`
- [ ] Register in `supabase/config.toml`

#### New: `disconnect-ebay`

- [ ] Create `supabase/functions/disconnect-ebay/index.ts` (runs as service role)
- [ ] Auth → extract userId from JWT
- [ ] Clear: `ebay_access_token`, `ebay_refresh_token`, `ebay_token_expires_at`, `ebay_username`, `ebay_account_type`
- [ ] Return `{ success: true }`
- [ ] Register in `supabase/config.toml`

#### `ebay-user`

- [ ] Confirmed: already calls Identity API and returns `username`, `accountType`, `userId` (see §3.4)
- [ ] Coordinate with `exchange_code` to avoid a duplicate Identity API call (§3.4)

### Phase 3 — `AuthContext`

- [ ] Add `freeCredits: FreeCredits | null` state
- [ ] Add `ebayConnected: boolean` state
- [ ] Add `ebayUsername: string | null` state
- [ ] Implement `refreshFreeCredits()` calling `get-free-credits`
- [ ] Update `canAnalyze` to require `ebayConnected && freeCredits.remaining > 0` for Starter
- [ ] Update `canPublish` to require `ebayConnected && publishUsed < 6` for Starter (OQ-10 RESOLVED); update `PLANS.starter.publishLimit` 3 → 6
- [ ] Call `refreshFreeCredits()` on session load
- [ ] Call `refreshFreeCredits()` after successful `analyze-item` response (with `recordUsage('ai_analysis')` removed per §3.0.2, trigger `refreshFreeCredits` directly from the response handler)
- [ ] Expose all new fields in `AuthContextType` interface + context `value`

### Phase 4 — Front-end pages & components

#### `AnalyzePage.tsx`

- [ ] Pre-flight gate: navigate to Settings if no eBay connected (Starter)
- [ ] Credit-exhaustion gate: show upgrade modal with `'credits'` reason
- [ ] Credit counter widget below results (Starter only)
- [ ] Lock pricing panel (blurred + upgrade CTA)
- [ ] Lock melt value display
- [ ] Lock spot prices display
- [ ] Lock detailed grading rationale
- [ ] Consume `_meta` from response → call `refreshFreeCredits()`

#### `DashboardPage.tsx`

- [ ] "AI Credits" summary card for Starter users
- [ ] "Connect eBay account" alert banner if not connected (Starter)

#### `SettingsPage.tsx`

- [ ] Show `ebayUsername` instead of generic "Connected"
- [ ] Show `ebayAccountType` badge for business accounts
- [ ] Free-tier credit summary in Integrations tab
- [ ] One-account notice for **Starter and Pro** users (OQ-3 RESOLVED: only Unlimited is exempt)
- [ ] Update `handleDisconnectEbay()`: call `disconnect-ebay` edge function instead of direct Supabase update (§5.5 Option A)

#### `BillingPage.tsx`

- [ ] Update Starter limits text: 5 → 6, add eBay-required note
- [ ] Credit usage widget (progress bar + reset date)
- [ ] Exhaustion alert with upgrade CTA
- [ ] Highlight Pro upgrade card when credits exhausted

#### `BottomNav.tsx`

- [ ] Credit badge on Analyze nav item — **always visible** for free users (OQ-9 RESOLVED: removed ≤ 2 threshold)

### Phase 5 — Testing

- [ ] Unit test `computeNextResetAt()` for Feb 28/29/30/31, Apr 30/31, Dec 31 inputs
- [ ] Unit test `get_free_tier_window_start()` PL/pgSQL function (day before/after reset, end-of-month cases)
- [ ] Integration test `analyze-item`: free user with no eBay → 403; free user with eBay + 6 used → 429; free user response lacks `priceMin`
- [ ] Integration test `ebay-publish` `store_token`: same username accepted, different username rejected for Starter
- [ ] E2E test: new free user → connect eBay → analyze 6 times → 7th shows upgrade prompt
- [ ] Test race condition: two simultaneous requests as same free user may both succeed at the limit boundary (≤1 over-count is accepted per §5.3 Option B); document the accepted behavior

### Phase 6 — Deployment

- [ ] Apply migration to staging; run `supabase gen types typescript` and commit updated `types.ts`
- [ ] Deploy edge functions: `analyze-item`, `ebay-publish`, `get-free-credits`, `ebay-user`
- [ ] Smoke test on staging with a free test account
- [ ] Apply migration to production
- [ ] **OQ-5 RESOLVED — Option B (hard reset):** Immediately after applying migration to production, run:
  ```sql
  UPDATE public.profiles
  SET ebay_access_token    = NULL,
      ebay_refresh_token   = NULL,
      ebay_token_expires_at = NULL
  WHERE ebay_access_token IS NOT NULL;
  ```
  Every previously connected user will be prompted to reconnect eBay on their next eBay-dependent action. This is required to obtain a token with the new `commerce.identity.readonly` scope. Coordinate with the `get_auth_url` scope update deployment.
- [ ] Deploy to production; roll back `analyze-item` to previous version if 5xx spike detected
- [ ] Monitor `gemini_usage` table for unexpected cost increase

---

## 8. Open Questions

All 15 open questions have been answered by the product owner. No open questions remain. See the table below for the final resolutions.

| #         | Status      | Question                                         | Resolution                                                                                                                                                                                                                                                                                                    |
| --------- | ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-1**  | ✅ RESOLVED | Free tier scope                                  | **Broad.** Free tier includes all fields needed to publish to eBay: title, description, condition, ebayCategoryId, suggestedCategories, itemSpecifics, suggestedGrade. Locked for paid only: priceMin/Max, meltValue, spotPrices, pricingNotes, gradingRationale, competitor data. See §3.1.4.                |
| **OQ-2**  | ✅ RESOLVED | Reset day anchor                                 | **Account creation (Option A).** `free_tier_reset_day` is set by the `handle_new_user` DB trigger at org creation time. `analyze-item` does NOT write this field. See §3.1.3.                                                                                                                                 |
| **OQ-3**  | ✅ RESOLVED | One-account exemption                            | **Unlimited LA plan only.** Only Unlimited-tier subscribers may connect multiple eBay accounts (multi-user orgs). Starter and Pro are both subject to the one-account limit. `ebay_account_type` is stored for display only; NOT used in access control. See §3.2.1, §4.4.3.                                  |
| **OQ-4**  | ✅ RESOLVED | Org/team quota                                   | **Per-org.** An org gets ONE 6-analysis quota regardless of number of listers. `analyze-item` counts via `WHERE org_id = <orgId>`. `usage_tracking` gains an `org_id` column. See §2.1, §2.3, §3.1.1–3.1.2, §5.6.                                                                                             |
| **OQ-5**  | ✅ RESOLVED | eBay Identity scope / re-auth                    | **Option B selected — hard reset.** On migration deploy to production, NULL all `ebay_access_token`, `ebay_refresh_token`, `ebay_token_expires_at` rows. All existing connected users must reconnect. Required to obtain tokens with `commerce.identity.readonly` scope. See §3.0.1, §7 Phase 6.              |
| **OQ-6**  | ✅ RESOLVED | `ebay-user` coordination                         | `ebay-user/index.ts` already calls Identity API and returns `username`, `accountType`, `userId`. Does not persist to `profiles`. `exchange_code` path in §3.2.1 handles the write. See §3.4.                                                                                                                  |
| **OQ-7**  | ✅ RESOLVED | Existing users with NULL reset_day               | **Fresh start acceptable.** Existing users get a new 6-credit window starting from deploy date. Admin account is Unlimited — unaffected. No backfill of prior usage counts required. See §5.1 table.                                                                                                          |
| **OQ-8**  | ✅ RESOLVED | Gemini model for free tier                       | **Keep `gemini-2.5-flash`** for free-tier analyses. No model downgrade. Cost optimization deferred to a follow-up task. See §5.10.                                                                                                                                                                            |
| **OQ-9**  | ✅ RESOLVED | Credit badge visibility threshold                | **Always visible** for free users. Removed `<= 2` threshold from BottomNav badge. See §4.6.                                                                                                                                                                                                                   |
| **OQ-10** | ✅ RESOLVED | `canPublish` for free tier                       | Free tier gets **6 publishes/month** (aligned with 6 analyses). `PLANS.starter.publishLimit` updated from 3 → 6. `canPublish` for Starter also requires `ebayConnected`. See §2.5, §4.1.4.                                                                                                                    |
| **OQ-11** | ✅ RESOLVED | `subscriptions` table existence                  | **Confirmed present** in production. Has an "unrestricted" RLS warning — add a user-scoped SELECT policy before coding `get-free-credits`. See §2.4.                                                                                                                                                          |
| **OQ-12** | ✅ RESOLVED | Double-counted `ai_analysis` rows                | `AnalyzePage.tsx` line 151 `recordUsage('ai_analysis')` **must be removed** (double-counts with `analyze-item` server-side insert). Line 344 `recordUsage('ebay_publish')` must stay (no server-side counterpart). See §3.0.2.                                                                                |
| **OQ-13** | ✅ RESOLVED | Token write paths in `ebay-publish`              | `refresh_token` action's `updatePatch` only contains token fields (`ebay_access_token`, `ebay_token_expires_at`, optionally `ebay_refresh_token`) — never `ebay_username` or `ebay_account_type`. Refresh path is already safe. Identity API call must be guarded to `exchange_code` action only. See §3.2.1. |
| **OQ-14** | ✅ RESOLVED | Existing users with 5+ analyses this month       | Covered by OQ-7 resolution: fresh start is acceptable. Existing usage rows remain but `free_tier_reset_day = NULL` means the rolling window starts at deploy date, giving all existing users a clean 6-credit window.                                                                                         |
| **OQ-15** | ✅ RESOLVED | `ebay-user` in production without identity scope | **Confirmed working** in production with current tokens. No scope change needed for `ebay-user` itself. The scope addition in `get_auth_url` affects new token grants only; existing `ebay-user` calls continue to work until those tokens are cleared (Option B). See §3.0.1.                                |

---

_End of document. All open questions resolved. Implementation ready to begin. Start with Phase 1 (migration) → Phase 2 pre-coding items (`commerce.identity.readonly` scope addition, `recordUsage` double-count removal, tier detection refactor) → Phase 2 edge functions → Phase 3 AuthContext → Phase 4 UI → Phase 5 tests → Phase 6 deployment (include token-clear step for OQ-5 Option B re-auth)._
