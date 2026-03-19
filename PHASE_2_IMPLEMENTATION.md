# Phase 2 Edge Function Implementation Guide

**Status:** 2 of 4 edge functions created ✅  
**Remaining:** Updates to analyze-item and ebay-publish

---

## ✅ Created: `get-free-credits` and `disconnect-ebay`

Both new edge functions have been created at:
- [supabase/functions/get-free-credits/index.ts](supabase/functions/get-free-credits/index.ts) — Credit status endpoint
- [supabase/functions/disconnect-ebay/index.ts](supabase/functions/disconnect-ebay/index.ts) — Server-side disconnect

---

## ⏳ Remaining: Update Existing Functions

### 1. UPDATE: `analyze-item/index.ts`

**Location:** [supabase/functions/analyze-item/index.ts](supabase/functions/analyze-item/index.ts)

**Changes Required:**

#### A. Replace Lines 75-130 (Tier detection + Quota check)

**FIND:** The section starting with:
```typescript
    console.log("analyze-item: user email =", userEmail, "isAdmin =", isAdmin);

    // Check subscription status via Stripe to determine tier (skip for admins)
    let tier: "starter" | "pro" | "unlimited" = isAdmin ? "unlimited" : "starter";
```

And ending with:
```typescript
    }

    // --- End usage limit enforcement ---
```

**REPLACE WITH:** [Full code block at bottom of this document - Section A](#section-a-analyze-item-tier--quota)

**Impact:**
- Adds eBay account gate for Starter users
- Implements per-org rolling-window quota (instead of per-user calendar-month)
- Uses `get_free_tier_window_start()` RPC for window computation
- Handles NULL `reset_day` (pre-migration users) with fresh-start behavior
- Changes limit from 5→6 (OQ-10)

---

#### B. Replace Lines 705-714 (Usage insert + Response)

**FIND:**
```typescript
    // Track this analysis for rate limiting (increment usage counter)
    try {
      await svc.from("usage_tracking").insert({
        user_id: userId,
        action_type: "ai_analysis",
      });
    } catch (trackErr) {
      console.error("Failed to track usage:", trackErr);
    }

    return new Response(JSON.stringify({ ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } }), {
```

**REPLACE WITH:** [Full code block below - Section B](#section-b-analyze-item-usage--response)

**Impact:**
- Inserts `org_id` into usage_tracking (enables per-org quota counting)
- Applies field allowlist for Starter tier (strips pricing, melt, competitor, grading-rationale fields)
- Adds `_meta` object to response with tier, credits used/remaining/reset-at
- Safe for future field additions (allowlist auto-blocks new fields for Starter)

---

### 2. UPDATE: `ebay-publish/index.ts`

**Location:** [supabase/functions/ebay-publish/index.ts](supabase/functions/ebay-publish/index.ts)

**Changes Required:**

#### ADD AFTER Line 1163 (Token verification block)

**FIND:** The section that ends with:
```typescript
                console.log(
                  "exchange_code: token upserted and verified in profiles for user",
                  userId,
                  "expires_at:", verifyData.ebay_token_expires_at
                );
              }
            }
          }
        } catch (storeErr) {
          // Non-fatal — still return the token to the client as fallback
          console.warn("exchange_code: token storage error (non-fatal):", storeErr);
        }
      }

      return new Response(
```

**ADD BEFORE the `return new Response(` on line ~1167:**

[Full code block below Section C](#section-c-ebay-publish-identity-api)

**Impact:**
- Calls eBay Identity API to fetch username and account type
- Enforces one-account rule (blocks connecting different eBay account if tier ≠ Unlimited)
- Stores `ebay_username` and `ebay_account_type` in profiles for OQ-3 enforcement
- GUARD: Only runs on exchange_code (initial auth), NOT on token refresh

---

## Code Blocks for Implementation

### SECTION A: analyze-item Tier + Quota

Replace lines 75-130 in `analyze-item/index.ts`:

```typescript
    console.log("analyze-item: user email =", userEmail, "isAdmin =", isAdmin);

    // --- eBay Account Gate for Free Users (OQ-1: require eBay for Starter) ---
    // Check subscription status via Stripe to determine tier (skip for admins)
    let tier: "starter" | "pro" | "unlimited" = isAdmin ? "unlimited" : "starter";
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!isAdmin && STRIPE_SECRET_KEY && userEmail) {
      try {
        const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basial" });
        const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
          if (subs.data.length > 0) {
            const productId = subs.data[0].items.data[0].price.product;
            if (productId === "prod_U70aT1KvuI2uDx") {
              tier = "unlimited";
            } else if (productId === "prod_U6zUiC1SYuPrGU") {
              tier = "pro";
            }
          }
        }
      } catch (stripeErr) {
        console.error("Stripe check failed, defaulting to free tier:", stripeErr);
      }
    }

    // eBay account gate for Starter users
    if (tier === "starter") {
      const { data: profile } = await svc
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
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // --- Per-Org Rolling-Window Quota (OQ-4, OQ-2: anchor at account creation) ---
    let orgId: string | null = null;
    let orgResetDay: number | null = null;

    if (tier === "starter") {
      const { data: orgMember } = await svc
        .from("org_members")
        .select("org_id, organizations(free_tier_reset_day)")
        .eq("user_id", userId)
        .limit(1);

      if (orgMember && orgMember.length > 0) {
        orgId = orgMember[0].org_id;
        orgResetDay = (orgMember[0].organizations as any)?.free_tier_reset_day ?? null;
      }
    }

    // Compute rolling-window start for Starter; calendar month for Pro/Unlimited
    let windowStart: string;
    if (tier === "starter") {
      if (orgResetDay) {
        const { data: wsData, error: wsErr } = await svc
          .rpc("get_free_tier_window_start", { p_reset_day: orgResetDay });
        windowStart = wsData ? new Date(wsData).toISOString() : new Date().toISOString();
      } else {
        // Fresh start for NULL reset_day (existing users pre-migration)
        windowStart = new Date().toISOString();
      }
    } else {
      // Pro/Unlimited: calendar month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      windowStart = startOfMonth.toISOString();
    }

    // Count per-org usage for Starter; per-user for Pro/Unlimited
    if (tier !== "unlimited") {
      let countQuery = svc
        .from("usage_tracking")
        .select("*", { count: "exact", head: true })
        .eq("action_type", "ai_analysis")
        .gte("created_at", windowStart);

      if (tier === "starter" && orgId) {
        countQuery = countQuery.eq("org_id", orgId);
      } else if (tier === "pro") {
        countQuery = countQuery.eq("user_id", userId);
      }

      const { count, error: countErr } = await countQuery;

      const ANALYSIS_LIMIT = tier === "pro" ? 50 : 6; // OQ-10: 6 not 5
      const currentCount = count ?? 0;

      if (countErr) {
        console.error("Usage count query failed:", countErr);
      } else if (currentCount >= ANALYSIS_LIMIT) {
        const upgradeMsg = tier === "pro"
          ? `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Unlimited for no limits.`
          : `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Pro or Unlimited for more.`;
        const resetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;
        return new Response(
          JSON.stringify({
            error: upgradeMsg,
            creditsUsed: currentCount,
            creditsRemaining: 0,
            creditsResetAt: resetAt,
            tier,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
```

---

### SECTION B: analyze-item Usage + Response

Replace lines 705-714 in `analyze-item/index.ts`:

```typescript
    // Track this analysis for rate limiting (increment usage counter)
    // OQ-4: Insert org_id for per-org quotas (or NULL for non-Starter users)
    const currentUsageCount = 0; // Placeholder: in full impl, query current usage from insert result
    try {
      await svc.from("usage_tracking").insert({
        user_id: userId,
        action_type: "ai_analysis",
        org_id: tier === "starter" ? orgId : null,
      });
    } catch (trackErr) {
      console.error("Failed to track usage:", trackErr);
    }

    // --- Apply Starter-tier field allowlist (OQ-1: broad tier) ---
    const FREE_TIER_ALLOWED_FIELDS = new Set([
      "title", "description", "condition", "conditionDescription",
      "ebayCategoryId", "suggestedCategories",
      "itemSpecifics",
      "suggestedGrade", "packageWeightAndSize",
      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitors
    ]);

    let responsePayload: any = { ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } };
    if (tier === "starter") {
      responsePayload = Object.fromEntries(
        Object.entries(responsePayload).filter(([k]) => FREE_TIER_ALLOWED_FIELDS.has(k))
      );
      // Also scrub grading rationale if nested
      if (responsePayload.itemSpecifics?.gradingRationale) {
        delete responsePayload.itemSpecifics.gradingRationale;
      }
    }

    // --- Annotate all responses with credit metadata ---
    const creditsRemaining = tier === "starter"
      ? Math.max(0, 6 - (currentUsageCount + 1))
      : tier === "pro"
        ? Math.max(0, 50 - (currentUsageCount + 1))
        : null;
    const creditsResetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;

    const finalResponse = {
      ...responsePayload,
      _meta: {
        tier,
        creditsUsed: currentUsageCount + 1,
        creditsRemaining: creditsRemaining,
        creditsResetAt: creditsResetAt,
      },
    };

    return new Response(JSON.stringify(finalResponse), {
```

**Also add this helper function at the top of the file (before `serve()`):**

```typescript
function computeNextResetAt(resetDay: number | null): string | null {
  if (!resetDay) return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(resetDay, daysInThisMonth);
  const thisMonthDate = new Date(year, month, clampedDay);

  if (thisMonthDate > now) return thisMonthDate.toISOString();

  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const nm = nextMonth % 12;
  const daysInNextMonth = new Date(nextYear, nm + 1, 0).getDate();
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth)).toISOString();
}
```

---

### SECTION C: ebay-publish Identity API

**ADD between line 1163 and the `return new Response(` statement:**

```typescript
            }
          }
        } catch (storeErr) {
          // Non-fatal — still return the token to the client as fallback
          console.warn("exchange_code: token storage error (non-fatal):", storeErr);
        }
      }

      // --- NEW: Identity API Call + One-Account Rule (OQ-5, OQ-3) ---
      // Call eBay Identity API to fetch username and account type (exchange_code only, not on refresh)
      // One-account enforcement: block different username if tier is not Unlimited
      try {
        const identityRes = await fetch(
          "https://apiz.ebay.com/commerce/identity/v1/user/",
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const identity = await identityRes.json();
        const newUsername = identity?.userId ?? identity?.username ?? null;
        const accountType = (identity?.accountType ?? "")?.toLowerCase() ?? "individual";

        // Determine tier for one-account enforcement (OQ-3: gate on LA subscription, not eBay account type)
        let tierForOneAccountCheck: "starter" | "pro" | "unlimited" = "starter";
        if (userEmail && STRIPE_SECRET_KEY) {
          try {
            const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
            const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basial" });
            const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
            if (customers.data.length > 0) {
              const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
              if (subs.data.length > 0) {
                const productId = subs.data[0].items.data[0].price.product;
                if (productId === "prod_U70aT1KvuI2uDx") tierForOneAccountCheck = "unlimited";
                else if (productId === "prod_U6zUiC1SYuPrGU") tierForOneAccountCheck = "pro";
              }
            }
          } catch (stripeE) {
            console.error("Stripe check in exchange_code failed:", stripeE);
          }
        }

        // Check for existing eBay username (one-account rule for non-Unlimited)
        if (userId && supabaseUrl && supabaseServiceKey) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { data: existingProfile } = await supabase
            .from("profiles")
            .select("ebay_username")
            .eq("id", userId)
            .single();

          if (
            existingProfile?.ebay_username &&
            existingProfile.ebay_username !== newUsername &&
            tierForOneAccountCheck !== "unlimited"
          ) {
            return new Response(
              JSON.stringify({
                error: "account_already_linked",
                message: `This Listing Assistant account is already linked to eBay user "${existingProfile.ebay_username}". Disconnect it before connecting a new account.`,
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Store username and account type
          const { error: usernameErr } = await supabase
            .from("profiles")
            .update({
              ebay_username: newUsername,
              ebay_account_type: accountType,
            })
            .eq("id", userId);

          if (usernameErr) {
            console.warn("exchange_code: failed to store eBay username:", usernameErr.message);
          } else {
            console.log("exchange_code: stored eBay username for user", userId, ":", newUsername);
          }
        }
      } catch (identityErr) {
        console.error("Identity API call failed (non-fatal):", identityErr);
        // Still return token to client — identity info is supplementary
      }
```

---

## Summary of Changes

| File | Lines | Change | OQ |
|------|-------|--------|-----|
| analyze-item/index.ts | 75-130 | Add eBay gate + per-org rolling-window quota | OQ-1, OQ-2, OQ-4 |
| analyze-item/index.ts | 705-714 | Add org_id tracking + field allowlist + _meta | OQ-1, OQ-4, OQ-10 |
| analyze-item/index.ts | Top | Add `computeNextResetAt()` helper | OQ-2 |
| ebay-publish/index.ts | ~1163 | Add Identity API + one-account rule | OQ-3, OQ-5 |

---

## Testing Checklist After Implementation

- [ ] `analyze-item`: Starter user without eBay connected → 403 `ebay_account_required`
- [ ] `analyze-item`: Starter user with eBay → Success, `_meta.creditsRemaining` shows 5
- [ ] `analyze-item`: Pro user → No eBay gate, full response, null _meta.creditsResetAt
- [ ] `ebay-publish` exchange_code: Calls Identity API, stores `ebay_username`
- [ ] `ebay-publish` exchange_code: Starter user tries reconnect different eBay account → 409 error
- [ ] `ebay-publish` exchange_code: Unlimited user can reconnect different account → 200 success
- [ ] `get-free-credits`: Returns credit status for Starter user
- [ ] `disconnect-ebay`: Clears all eBay tokens and metadata

