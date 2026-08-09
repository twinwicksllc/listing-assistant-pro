# Category Identification Flow: Analyze-Item to Publish

## Executive Summary

This document describes the end-to-end category identification and management system implemented in the eBay Listing Assistant. The system addresses ten critical deficiencies identified by the team and establishes a robust, deterministic approach to category selection that prevents incorrect mappings from poisoning the database while ensuring high-confidence eBay taxonomy suggestions are prioritized.

The architecture consists of three primary Edge Functions working in concert: `category-lookup` (the intelligent lookup service), `analyze-item` (the AI-powered listing generator), and `ebay-publish` (the listing publication service). Together, they implement a four-tier candidate ranking system, deterministic locking for high-confidence matches, gated persistence to prevent database pollution, and feedback loops that promote successful mappings while demoting failures.

---

## System Architecture Overview

### Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTION                                │
│                     (Upload images + voice note)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            analyze-item                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 1. Pre-Lookup Phase                                                     ││
│  │    • Calls category-lookup with voice note as query                     ││
│  │    • Receives ranked candidates + deterministic lock status             ││
│  │    • Injects LOCKED CATEGORY or hints into Gemini prompt                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 2. AI Analysis Phase                                                    ││
│  │    • Gemini Flash analyzes images + voice note                          ││
│  │    • MUST use locked category if present (cannot override)              ││
│  │    • Returns structured listing with categoryId                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ebay-publish                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 3. Publication Phase                                                    ││
│  │    • Fetches dynamic aspects from eBay Taxonomy API                     ││
│  │    • Applies fixedValues ONLY for coin/bullion allowlist (#5)           ││
│  │    • Creates inventory item + offer + publishes                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ 4. Feedback Loop Phase                                                  ││
│  │    • On SUCCESS: calls category-lookup "promote" action                 ││
│  │    • On FAILURE: calls category-lookup "demote" action                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           category-lookup                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Core Actions:                                                           ││
│  │  • lookup: 4-tier ranked candidate system with deterministic lock       ││
│  │  • store: Gated persistence with confidence/leaf/status checks          ││
│  │  • promote: Approve quarantined mapping after publish success           ││
│  │  • demote: Record failure, potentially reject after 3 failures          ││
│  │  • aspects: Fetch/cache eBay category aspects (composite key #7)        ││
│  │  • verify: Check if category is leaf + active via eBay API              ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Four-Tier Candidate Ranking System

### Overview

The `category-lookup` function implements a four-tier precedence system for category candidates. Each tier represents a different source with varying levels of trust, and candidates are ranked by their **effective score**, which incorporates source weighting, token overlap, recency, and penalties.

### Tier Definitions

| Tier | Source                   | Weight | Description                             |
| ---- | ------------------------ | ------ | --------------------------------------- |
| 1    | `db_exact_user_verified` | +15    | User-approved mapping from admin UI     |
| 1    | `db_exact_ebay_api`      | +10    | Previously persisted from eBay API      |
| 1    | `db_exact`               | +8     | Other approved exact match from DB      |
| 2    | `ebay_api`               | +12    | Fresh suggestion from eBay Taxonomy API |
| 3    | `db_fuzzy`               | +3     | Partial match from DB (gated)           |
| 4    | `gemini`                 | +5     | AI fallback when no better candidates   |

### Effective Score Computation (Deficiency #8)

The effective score formula balances multiple factors:

```
effectiveScore = min(100, max(0,
  rawScore
  + sourceWeight
  + similarityBonus
  + recencyBonus
  - genericPenalty
  - ambiguityPenalty
))
```

Where:

- **sourceWeight**: Based on tier (see table above)
- **similarityBonus**: `(tokenOverlap / totalQueryTokens) * 15` — rewards semantic match
- **recencyBonus**: `max(0, 5 - (daysSinceUpdate / 30))` for DB sources — decays over time
- **genericPenalty**: `-20` if candidate item_type is all generic terms (e.g., "coin", "card")
- **ambiguityPenalty**: `-15` for fuzzy matches with low token overlap

### Deterministic Lock Threshold (Deficiency #3)

When an eBay API suggestion achieves an effective score ≥ 88 AND is verified as a leaf category, the system **locks** that category. This means:

1. The category is injected into the Gemini prompt with `**LOCKED CATEGORY**` designation
2. Gemini is explicitly instructed: "YOU MUST USE THIS CATEGORY ID. Do not override."
3. No LLM-mediated choice occurs — the deterministic result wins

**Rationale**: High-confidence eBay Taxonomy API results represent the official eBay category tree. Allowing Gemini to override them introduces unnecessary risk of hallucination. The lock threshold of 88 was chosen to balance confidence with coverage.

---

## The Lookup Action: Detailed Flow

### Step 1: Tier 1 — Database Exact Match

```typescript
// Query approved mappings with exact item_type/coin_type match
const { data: exactRows } = await supabase
  .from("category_mappings")
  .select(
    "ebay_category_id, category_name, confidence, verification_source, ...",
  )
  .or(`item_type.eq.${normalizedKey},coin_type.eq.${normalizedKey}`)
  .eq("status", "approved") // Only approved rows (#2)
  .order("effective_score", { ascending: false })
  .limit(3);
```

**Deficiency #2 Compliance**: Only `status = "approved"` rows are considered. Quarantined or rejected mappings are excluded from exact match lookup.

### Step 2: Tier 2 — eBay getCategorySuggestions

```typescript
// Always run eBay API for comparison, even if DB exact exists
const ebaySuggestions = await fetchCategorySuggestions(rawItemType, appToken, base);

for (let i = 0; i < Math.min(ebaySuggestions.length, 5); i++) {
  const s = ebaySuggestions[i];

  // Raw scores: 90, 87, 84, 81, 78 for ranks 1-5
  const rawScore = 90 - (i * 3);

  // Verify leaf status for TOP candidate only (#4)
  if (i === 0) {
    const verification = await verifyCategoryLeafActive(s.categoryId, token, base);
    verifiedLeaf = verification.isLeaf;
    verifiedActive = verification.isActive;
  }

  // Compute effective score with eBay source weight
  const effectiveScore = computeEffectiveScore("ebay_api", rawScore, ...);
}
```

**Deficiency #4 Compliance**: The top eBay suggestion is verified for leaf + active status before being considered for deterministic lock. Non-leaf categories are flagged but not automatically excluded from the candidate pool.

### Step 3: Tier 3 — Database Fuzzy Match (Gated)

```typescript
// Fuzzy match with gates (#1)
const keywords = normalizedKey
  .split(" ")
  .filter((w) => w.length > 3 && !STOPWORDS.has(w));

for (const kw of keywords.slice(0, 3)) {
  const { data: fuzzy } = await supabase
    .from("category_mappings")
    .select("...")
    .eq("status", "approved")
    .or(`item_type.ilike.%${kw}%,coin_type.ilike.%${kw}%`)
    .limit(3);
}

// Apply gates
for (const row of fuzzyMatches) {
  const tokenOverlap = computeTokenOverlap(queryTokens, candidateText);

  // Gate 1: Minimum token overlap
  if (tokenOverlap < FUZZY_MIN_TOKEN_OVERLAP) {
    console.log(
      `Rejected — token overlap ${tokenOverlap} < ${FUZZY_MIN_TOKEN_OVERLAP}`,
    );
    continue;
  }

  // Gate 2: Generic term penalty
  if (isGenericItemType(candidateText)) {
    effectiveScore -= 20; // Generic penalty
  }

  // Gate 3: Minimum effective score
  if (effectiveScore < FUZZY_MIN_SIMILARITY * 100) {
    console.log(`Rejected — effective score ${effectiveScore} < 65`);
    continue;
  }
}
```

**Deficiency #1 Compliance**: Fuzzy matches no longer blindly override eBay suggestions. They must pass:

- Token overlap ≥ 2 meaningful words
- Effective score ≥ 65 (after penalties)
- Generic term check to prevent broad matches like "coin" → "Coins" category

### Step 4: Tier 4 — Gemini Fallback

```typescript
// Only invoke Gemini if no good candidates exist
const bestSoFar = allCandidates.reduce(
  (best, c) => (c.effectiveScore > (best?.effectiveScore ?? 0) ? c : best),
  null,
);

if (!bestSoFar || bestSoFar.effectiveScore < 70) {
  const geminiResult = await askGeminiForCategory(rawItemType);
  // Gemini suggestions get lowest priority due to hallucination risk
}
```

### Step 5: Winner Selection & Deterministic Lock

```typescript
// Sort by effective score descending
allCandidates.sort((a, b) => b.effectiveScore - a.effectiveScore);

// Check for deterministic lock (#3)
const topEbay = allCandidates.find(
  (c) => c.source === "ebay_api" && c.rank === 1,
);

if (
  topEbay &&
  topEbay.effectiveScore >= DETERMINISTIC_LOCK_THRESHOLD &&
  topEbay.verifiedLeaf !== false
) {
  winner = topEbay;
  lockReason = `Deterministic lock: eBay top-1 score ${topEbay.effectiveScore} >= 88`;
} else {
  // Take highest effective score, skipping known non-leaf (#4)
  for (const c of allCandidates) {
    if (c.verifiedLeaf === false) continue;
    winner = c;
    break;
  }
}
```

### Step 6: Audit Logging (Deficiency #0)

```typescript
// Log ALL candidates to lookup_decisions table
for (const c of allCandidates) {
  auditEntries.push({
    request_id: requestId,
    query_text: rawItemType,
    candidate_source: c.source,
    candidate_id: c.categoryId,
    candidate_score: c.effectiveScore,
    was_selected: c === winner,
    reason_selected: c === winner ? lockReason : c.reason,
    verified_leaf: c.verifiedLeaf,
    verified_active: c.verifiedActive,
    latency_ms: sourceLatency,
  });
}

await persistAuditEntries(supabase, auditEntries);
```

**Deficiency #0 Compliance**: Every lookup decision is logged with full context for debugging, analytics, and future model training.

---

## The Analyze-Item Pre-Lookup Phase

### Integration with Category-Lookup

Before Gemini analyzes the uploaded images, `analyze-item` performs a **pre-lookup** using the voice note (or item description) as the query:

```typescript
// Pre-lookup: Deterministic category resolution
const lookupResp = await fetch(`${supabaseUrl}/functions/v1/category-lookup`, {
  method: "POST",
  body: JSON.stringify({ action: "lookup", itemType: voiceNote }),
});

if (lookupResp.ok) {
  const lookupData = await lookupResp.json();

  if (lookupData.found) {
    const score = lookupData.effectiveScore || 0;
    const isVerifiedLeaf = lookupData.verifiedLeaf !== false;
    const source = lookupData.source || "";

    // Deterministic lock: high-confidence verified result (#3)
    const isLockable =
      score >= 88 &&
      isVerifiedLeaf &&
      (source === "ebay_api" ||
        source.includes("user_verified") ||
        source.includes("db_exact"));

    if (isLockable) {
      lockedCategoryId = lookupData.categoryId;
      categoryHints += `\n- **LOCKED CATEGORY** (verified, high-confidence): **${lockedCategoryId}** — ${breadcrumb}. YOU MUST USE THIS CATEGORY ID. Do not override.`;
    } else {
      // Strong hint but not locked
      categoryHints += `\n- BEST MATCH (score=${score}, source=${source}): **${categoryId}** — ${breadcrumb}. Use as primary category unless item clearly belongs elsewhere.`;
    }
  }
}
```

### The LOCKED CATEGORY Prompt Guard

When a deterministic lock is achieved, the category is injected into Gemini's system prompt:

```
### CATEGORY SELECTION
You MUST select the correct eBay **leaf** category ID for every item.

**CRITICAL: If a LOCKED CATEGORY is specified below, you MUST use that exact category ID. Do NOT override it.**

Use these resources in order:
1. **LOCKED CATEGORY** (below): If present, use this category ID unconditionally.
2. **BEST MATCH / SUGGESTIONS** (below): If no lock, use the highest-scored suggestion.
3. **Your knowledge**: Use when no suggestions are available.

- **LOCKED CATEGORY** (verified, high-confidence): **41111** — Coins & Paper Money > Coins > US > Dollars > American Eagle. YOU MUST USE THIS CATEGORY ID. Do not override.
```

**Deficiency #3 Compliance**: The LLM-mediated final choice is eliminated when a deterministic, high-confidence result is available. Gemini cannot override the locked category.

---

## The Store Action: Gated Persistence

### Three-Gate System (Deficiency #2)

When persisting a category mapping to the database, three gates prevent pollution:

```typescript
async function safePersistMapping(supabase, normalizedKey, categoryId, ...) {
  // Gate 1: Minimum confidence
  if (confidence < AUTO_PERSIST_MIN_CONFIDENCE) {  // 85
    console.log(`Skipping auto-persist — confidence ${confidence} < 85`);
    return false;
  }

  // Gate 2: Verify leaf + active (#4)
  const verification = await verifyCategoryLeafActive(categoryId, ebayAuth);
  if (!verification.isLeaf || !verification.isActive) {
    console.warn(`Blocking persist of non-leaf/inactive category ${categoryId}`);
    return false;
  }

  // Gate 3: Determine status based on source
  const status = (source === "ebay_api" && confidence >= 85) ? "approved" : "quarantine";

  // Persist with deep-normalized key for dedup (#6)
  const normalized = deepNormalize(normalizedKey);
  await supabase.from("category_mappings").upsert({
    item_type_normalized: normalized,
    ebay_category_id: categoryId,
    status: status,
    ...
  });
}
```

### Status Workflow

| Source    | Confidence | Resulting Status           |
| --------- | ---------- | -------------------------- |
| eBay API  | ≥ 85       | `approved`                 |
| eBay API  | < 85       | `quarantine`               |
| Gemini AI | Any        | `quarantine`               |
| Admin UI  | Any        | `approved` (user_verified) |

### Deep Normalization (Deficiency #6)

To prevent near-duplicate entries from fragmenting the mapping table:

```typescript
function deepNormalize(input: string): string {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((w) => !STOPWORDS.has(w) && w.length > 1)
    .sort() // Sort tokens for order-independent matching
    .join(" ");
}

// Examples:
// "1964 Kennedy Half Dollar" → "1964 dollar half kennedy"
// "Kennedy Half Dollar 1964" → "1964 dollar half kennedy" (same!)
```

---

## The Promote/Demote Feedback Loop (Deficiency #8)

### Overview

After each eBay publish attempt, the system updates the category mapping's effectiveness metrics. This creates a feedback loop that improves future lookups.

### Promote Action (Publish Success)

```typescript
if (action === "promote") {
  const newSuccessCount = (existing.publish_success_count || 0) + 1;

  await supabase
    .from("category_mappings")
    .update({
      status: "approved",
      publish_success_count: newSuccessCount,
      last_publish_success: new Date().toISOString(),
    })
    .eq("ebay_category_id", categoryId);
}
```

Called by `ebay-publish` after successful listing publication:

```typescript
// In ebay-publish/index.ts
await fetch(`${supabaseUrl}/functions/v1/category-lookup`, {
  method: "POST",
  body: JSON.stringify({
    action: "promote",
    categoryId: finalCategoryId,
    itemType: payload.itemType,
  }),
});
```

### Demote Action (Publish Failure)

```typescript
if (action === "demote") {
  const newFailCount = (existing.publish_failure_count || 0) + 1;
  const newScore = Math.max(0, (existing.effective_score || 50) - 10);

  // Auto-reject if 3+ failures and no successes
  const newStatus =
    newFailCount >= 3 && successCount === 0 ? "rejected" : undefined;

  await supabase
    .from("category_mappings")
    .update({
      publish_failure_count: newFailCount,
      effective_score: newScore,
      status: newStatus,
    })
    .eq("ebay_category_id", categoryId);
}
```

**Auto-Rejection Rule**: If a category mapping accumulates 3+ publish failures with zero successes, it is automatically moved to `rejected` status. This prevents recurring use of broken mappings.

---

## Aspect Handling in ebay-publish

### Dynamic Aspect Fetching (Deficiency #7)

The `ebay-publish` function fetches aspect requirements from the `category_aspects_cache` table, which uses a **composite cache key**:

```typescript
// In category-lookup "aspects" action
const { data: cached } = await supabase
  .from("category_aspects_cache")
  .select("aspects, fetched_at, expires_at")
  .eq("category_id", categoryId)
  .eq("marketplace_id", "EBAY_US") // Composite key component
  .eq("category_tree_id", "0") // Composite key component
  .maybeSingle();
```

**Deficiency #7 Compliance**: Cache keys now include `marketplace_id` and `category_tree_id`, preventing cross-marketplace aspect leakage.

### Fixed Values Allowlist (Deficiency #5)

Coin-specific fixed values (Composition, Fineness, Denomination) are only applied to categories in the allowlist:

```typescript
const COIN_FIXED_VALUES_ALLOWED_IDS = new Set([
  // Coins
  "11981",
  "39464",
  "11980",
  "11971",
  "41099",
  "41102",
  "11973",
  "39455",
  "41084",
  "11950",
  "41111",
  "41109",
  "526",
  "253",
  "45243",
  // Bullion
  "178906",
  "39489",
  "3361",
  "532",
  "173685",
  "166679",
]);

// In aspect merging logic:
if (COIN_FIXED_VALUES_ALLOWED_IDS.has(categoryId)) {
  // Safe to apply fixedValues like { Composition: "Silver", Fineness: "0.999" }
} else {
  // Do NOT apply coin-specific fixed values
}
```

**Deficiency #5 Compliance**: Coin defaults no longer leak to non-coin categories like Beanie Babies or Funko Pops.

---

## Category Tree Detection

### Breadcrumb-Based Detection

The system dynamically detects category type from the stored breadcrumb path:

```typescript
async function detectCategoryTree(
  categoryId: string,
  supabase: any,
): Promise<string> {
  const { data: mapping } = await supabase
    .from("category_mappings")
    .select("breadcrumb, category_name")
    .eq("ebay_category_id", categoryId)
    .maybeSingle();

  const breadcrumb = (mapping?.breadcrumb || "").toLowerCase();

  if (breadcrumb.includes("bullion")) return "bullion";
  if (breadcrumb.includes("coins:") || breadcrumb.includes("coins >"))
    return "coin";
  if (breadcrumb.includes("trading cards")) return "trading_card";
  if (breadcrumb.includes("collectibles") || breadcrumb.includes("funko"))
    return "collectible";
  return "other";
}
```

This replaces hardcoded ID sets with dynamic detection, making the system more resilient to eBay taxonomy changes.

---

## Operational Guardrails (Deficiency #9)

### Circuit Breaker

When no candidate passes the confidence threshold, the system returns a "present options to user" response instead of making a low-confidence choice:

```typescript
if (!winner) {
  return new Response(
    JSON.stringify({
      found: false,
      message:
        "No category passed confidence threshold — present top options to user",
      topCandidates: allCandidates.slice(0, 3).map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        score: c.effectiveScore,
      })),
    }),
  );
}
```

### Audit Trail

Every lookup is logged to `lookup_decisions` with:

- `request_id`: Unique identifier for the request
- `query_text`: Original search query
- `candidate_source`: Source tier (db_exact, ebay_api, db_fuzzy, gemini)
- `was_selected`: Whether this candidate won
- `reason_selected`: Why it was selected or rejected
- `latency_ms`: Response time for performance monitoring

---

## Weekly Maintenance: category-hygiene-cron

### Scheduled Jobs

The `category-hygiene-cron` function runs weekly to maintain database health:

| Task              | Description                                         |
| ----------------- | --------------------------------------------------- |
| **Deduplication** | Remove duplicate mappings by `item_type_normalized` |
| **Score Decay**   | Reduce effective_score for stale mappings           |
| **Expiration**    | Move old quarantine entries to rejected             |
| **Cleanup**       | Remove orphaned entries with NULL category_id       |

### Hygiene Log

Each run is logged to `category_hygiene_log`:

```sql
CREATE TABLE category_hygiene_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ DEFAULT now(),
  duplicates_removed INTEGER,
  scores_decayed INTEGER,
  entries_expired INTEGER,
  orphans_cleaned INTEGER
);
```

---

## Constants Reference

| Constant                       | Value | Purpose                                    |
| ------------------------------ | ----- | ------------------------------------------ |
| `FUZZY_MIN_SIMILARITY`         | 0.65  | Minimum similarity ratio for fuzzy matches |
| `FUZZY_MIN_TOKEN_OVERLAP`      | 2     | Minimum meaningful tokens for fuzzy gate   |
| `AUTO_PERSIST_MIN_CONFIDENCE`  | 85    | Minimum confidence for auto-persist        |
| `DETERMINISTIC_LOCK_THRESHOLD` | 88    | eBay score above = locked category         |

---

## Deficiency Resolution Summary

| #   | Deficiency                           | Resolution                                            |
| --- | ------------------------------------ | ----------------------------------------------------- |
| 0   | No audit trail for lookup decisions  | `lookup_decisions` table logs every candidate         |
| 1   | DB fuzzy overriding eBay             | Token overlap gates + generic term penalties          |
| 2   | Auto-persist poisoning DB            | Three-gate system (confidence, leaf, status)          |
| 3   | LLM overriding deterministic results | Deterministic lock at score ≥ 88                      |
| 4   | Leaf validation too late             | Pre-selection leaf verification via eBay API          |
| 5   | Coin defaults leaking to non-coins   | `COIN_FIXED_VALUES_ALLOWED_IDS` allowlist             |
| 6   | Weak item_type uniqueness            | Deep normalization with stopwords + sorting           |
| 7   | Cache key missing context            | Composite key: category_id + marketplace_id + tree_id |
| 8   | No source weighting/decay            | Effective score formula with weights + decay          |
| 9   | No operational guardrails            | Circuit breaker + audit logging + hygiene cron        |

---

## Appendix: Key File Locations

| File                                                               | Purpose                                 |
| ------------------------------------------------------------------ | --------------------------------------- |
| `supabase/functions/category-lookup/index.ts`                      | Core lookup service with 4-tier ranking |
| `supabase/functions/analyze-item/index.ts`                         | AI listing generator with pre-lookup    |
| `supabase/functions/ebay-publish/index.ts`                         | Publication service with promote/demote |
| `supabase/functions/category-hygiene-cron/index.ts`                | Weekly maintenance job                  |
| `supabase/migrations/20260330000000_category_system_hardening.sql` | Schema changes for deficiencies         |

---

_Document generated for team review. Last updated: March 31, 2026_
