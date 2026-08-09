# eBay Coin Condition Mandate - Compliance Analysis & Action Plan

**Effective Date:** Early June 2026  
**Enforcement Scope:** API listings only (no breaches yet, early warning period)  
**Affected Categories:**

- 253 (Coins: US)
- 256 (Coins: World)
- 3377 (Coins: Canada)
- 4733 (Coins: Ancient)
- 18466 (Coins: Medieval)

* all leaf categories beneath them

---

## 1. Current Implementation Status ✅

### What's Already Working

#### ✅ **Type Definitions** ([src/types/listing.ts](src/types/listing.ts#L24))

- `CoinConditionDetail` type fully defined with two branches:
  - **Graded coins**: `{ type: "graded"; gradingCompany; grade; certificationNumber? }`
  - **Raw coins**: `{ type: "raw"; rawCondition: "Uncirculated" | "Extremely Fine to About Uncirculated" | "Fine to Very Fine" | "Below Fine" }`
- Validation functions: `isCoinConditionDetailRequired()`, `isCoinConditionDetailComplete()`
- Coin category detection: Hardcoded sets + breadcrumb-based detection

#### ✅ **Frontend UI** ([src/components/analyze/ListingFields.tsx](src/components/analyze/ListingFields.tsx#L374))

- Conditional "Coin Condition Details" section appears only for coin categories
- Two-button toggle: "Graded coin" / "Raw coin"
- Graded path: Dropdown for grading company (PCGS, NGC, ANACS, ICG, CAC, ICCS) + grade string input + optional cert number
- Raw path: Dropdown for raw condition tier
- Validation indicator shows "Required" badge when incomplete

#### ✅ **Coin Descriptor Fetching** ([supabase/functions/ebay-publish/index.ts#L2309](supabase/functions/ebay-publish/index.ts#L2309))

- `fetchCoinConditionDescriptors()` calls eBay's Metadata API to get numeric descriptor IDs
- In-memory cache per invocation
- Handles both graded and raw coin flows
- Maps user-friendly values → eBay numeric IDs

#### ✅ **Descriptor Building** ([supabase/functions/ebay-publish/index.ts#L2461](supabase/functions/ebay-publish/index.ts#L2461))

- `buildCoinConditionDescriptors()` constructs the final payload:
  - **Graded**: Maps company name + grade parts (letter, number, suffix) to descriptor IDs
  - **Raw**: Maps standardized condition tier to descriptor ID
  - Both: Includes optional certification number via `additionalInfo`
- Descriptor array added to `inventoryBody.conditionDescriptors` before eBay API call

#### ✅ **Storage & Persistence** ([src/hooks/useDrafts.ts](src/hooks/useDrafts.ts#L65))

- Coin condition detail persisted in `item_specifics._coinConditionDetail`
- Loaded back from DB on draft restoration

---

## 2. Gaps & Compliance Risks ⚠️

### Gap 1: Hardcoded Coin Category IDs Are Incomplete

**Location:** [supabase/functions/ebay-publish/index.ts#L301](supabase/functions/ebay-publish/index.ts#L301)

```typescript
const HARDCODED_COIN_CATEGORY_IDS = new Set([
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
  "166679",
  "41109",
  "526",
  "253",
  "45243",
  "39471",
  "39472",
  "39473",
  "39474",
  "39475",
]);
```

**Issue:**

- The five mandate parent categories (253, 256, 3377, 4733, 18466) are partially present, but:
  - 256 (World Coins) **not in set**
  - 3377 (Canada Coins) **not in set**
  - 4733 (Ancient Coins) **not in set**
  - 18466 (Medieval Coins) **not in set**
- Missing leaf categories under these parents won't trigger descriptor fetching

**Impact:** Listings in these categories proceed without `conditionDescriptors`, generating eBay warning 25126 (non-fatal, but signals non-compliance).

---

### Gap 2: No Validation Schema for `CoinConditionDetail`

**Location:** [src/types/listing-form.ts](src/types/listing-form.ts)

**Issue:**

- The Zod schema `listingFormSchema` does **not** validate `coinConditionDetail`
- No superRefine logic to enforce:
  - If `coinConditionDetailRequired === true` → detail must be complete
  - If graded → `gradingCompany` and `grade` are non-empty
  - If raw → `rawCondition` is selected

**Impact:**

- Users can submit listings with empty coin condition fields
- The publish function logs a warning but proceeds (graceful degradation)
- Potential eBay rejection at submission time

---

### Gap 3: Missing Category Detection for New Mandate Categories

**Location:** [src/types/listing.ts#L290](src/types/listing.ts#L290)

```typescript
function isCoinConditionDetailRequired(
  categoryId: string | undefined,
  domain: string | undefined,
  breadcrumb: string | undefined,
): boolean {
  return Boolean(
    (categoryId && COIN_CATEGORY_IDS.has(categoryId)) ||
    domain === "coins_bullion" ||
    (breadcrumb &&
      /coins?:\s*(us|world|canada|ancient|medieval)|coins?\s*&\s*paper money/i.test(
        breadcrumb,
      )),
  );
}
```

**Issue:**

- The regex pattern checks for breadcrumb matches, which is good
- But `COIN_CATEGORY_IDS` hardcoded set is missing 256, 3377, 4733, 18466
- If breadcrumb lookup fails → fallback set is incomplete

---

### Gap 4: No User Confirmation Flow for Auto-Suggested Conditions

**Location:** Frontend (analyze page)

**Issue:**

- The code supports eBay's auto-assignment of condition (eBay can suggest a default)
- But there's **no helper function** to:
  1. Detect when eBay suggests a condition
  2. Display it to the user for confirmation
  3. Allow override before publishing

**Current state:**

- If eBay returns a default condition → we blindly use it
- No user visibility or approval gate

---

### Gap 5: No Mandatory Field Validation at Publish Time

**Location:** [supabase/functions/ebay-publish/index.ts#L3916](supabase/functions/ebay-publish/index.ts#L3916)

```typescript
if (
  coinConditionDetailRaw &&
  isCoinDescriptorCategory &&
  clientId &&
  clientSecret
) {
  // Build descriptors...
} else if (coinConditionDetailRaw && categoryTreeType === "coin") {
  console.log(`create_draft: coinConditionDetail present but skipping...`);
}
```

**Issue:**

- If coin category is detected but `coinConditionDetailRaw === null` → **no error**
- Logging only; proceeds to publish
- Should throw an explicit error instead

---

## 3. Recommended Action Plan

### ✅ Action 1: Update Hardcoded Category Sets (Priority: CRITICAL)

**File:** [supabase/functions/ebay-publish/index.ts#L287](supabase/functions/ebay-publish/index.ts#L287)

```typescript
/** Coin category IDs required by eBay June 2026 mandate */
const COIN_CONDITION_DESCRIPTOR_PARENT_IDS = new Set([
  "253", // Coins: US
  "256", // Coins: World ← MISSING
  "3377", // Coins: Canada ← MISSING
  "4733", // Coins: Ancient ← MISSING
  "18466", // Coins: Medieval ← MISSING
]);

/** All coin-related categories (parent + leaf) for category tree detection */
const HARDCODED_COIN_CATEGORY_IDS = new Set([
  // Mandate parents
  "253",
  "256",
  "3377",
  "4733",
  "18466",
  // Existing leaf categories
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
  "166679",
  "41109",
  "526",
  "45243",
  "39471",
  "39472",
  "39473",
  "39474",
  "39475",
]);
```

**Also update:** [src/types/listing.ts#L274](src/types/listing.ts#L274)

```typescript
const COIN_CATEGORY_IDS = new Set([
  "253",
  "256",
  "3377",
  "4733",
  "18466", // Mandate parents
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
  "166679",
  "41109",
  "526",
  "45243",
  "39471",
  "39472",
  "39473",
  "39474",
  "39475",
]);
```

---

### ✅ Action 2: Add Zod Validation for `CoinConditionDetail`

**File:** [src/types/listing-form.ts](src/types/listing-form.ts)

Add to the schema after policy validation:

```typescript
import type { CoinConditionDetail } from "./listing";
import {
  isCoinConditionDetailRequired,
  isCoinConditionDetailComplete,
} from "./listing";

export const listingFormSchema = z
  .object({
    // ... existing fields ...
    ebayCategoryId: z
      .string()
      .min(1, "eBay category is required (generate listing to set)"),
    // Add coin condition field to schema
    coinConditionDetail: z
      .custom<CoinConditionDetail | null | undefined>()
      .optional(),
    coinConditionDetailRequired: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // ... existing validation ...

    // Coin condition requirement validation
    if (
      data.coinConditionDetailRequired &&
      !isCoinConditionDetailComplete(data.coinConditionDetail)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coinConditionDetail"],
        message:
          "Coin condition details are required for this category before publishing",
      });
    }
  });

// Add type export
export type ListingFormDataWithCoinCondition = z.infer<
  typeof listingFormSchema
>;
```

---

### ✅ Action 3: Create Helper Function for Condition Confirmation Flow

**File:** Create new [src/lib/coinConditionHelper.ts](src/lib/coinConditionHelper.ts)

```typescript
import type { CoinConditionDetail } from "@/types/listing";

/**
 * Represents a suggestion from eBay for a coin condition when one isn't provided.
 * Allows the UI to display it for user confirmation before submission.
 */
export interface EbayCoinConditionSuggestion {
  suggested: CoinConditionDetail;
  confidence: "high" | "medium" | "low";
  rationale: string; // e.g., "Detected from images: lightly circulated appearance"
}

/**
 * Parse eBay's automatic condition suggestion from metadata API response.
 *
 * eBay may suggest a default condition in the Metadata API response.
 * This function extracts and normalizes it into our CoinConditionDetail format.
 *
 * @param ebaySuggestion - Raw suggestion from eBay API
 * @param categoryId - Category ID to context the suggestion
 * @returns Structured suggestion or null if none available
 */
export function parseEbayCoinConditionSuggestion(
  ebaySuggestion: any,
  categoryId: string,
): EbayCoinConditionSuggestion | null {
  if (!ebaySuggestion) return null;

  // eBay returns condition in one of these formats:
  // 1. { type: "raw", value: "Uncirculated" }
  // 2. { type: "graded", grader: "PCGS", grade: "MS 65" }
  // 3. { defaultConditionId: 1000, description: "New" }

  try {
    if (
      ebaySuggestion.type === "graded" &&
      ebaySuggestion.grader &&
      ebaySuggestion.grade
    ) {
      return {
        suggested: {
          type: "graded",
          gradingCompany: ebaySuggestion.grader as any,
          grade: ebaySuggestion.grade,
          certificationNumber: ebaySuggestion.certNumber,
        },
        confidence: ebaySuggestion.confidence ?? "medium",
        rationale: ebaySuggestion.rationale ?? "Automatically detected by eBay",
      };
    }

    if (ebaySuggestion.type === "raw" && ebaySuggestion.value) {
      const validRawConditions = [
        "Uncirculated",
        "Extremely Fine to About Uncirculated",
        "Fine to Very Fine",
        "Below Fine",
      ];
      if (validRawConditions.includes(ebaySuggestion.value)) {
        return {
          suggested: {
            type: "raw",
            rawCondition: ebaySuggestion.value as any,
          },
          confidence: ebaySuggestion.confidence ?? "medium",
          rationale:
            ebaySuggestion.rationale ?? "Automatically detected by eBay",
        };
      }
    }
  } catch (e) {
    console.error("parseEbayCoinConditionSuggestion: parse failed", e);
  }

  return null;
}

/**
 * Generate user-friendly description of a coin condition for confirmation UI.
 */
export function describeCoinCondition(detail: CoinConditionDetail): string {
  if (detail.type === "graded") {
    const cert = detail.certificationNumber
      ? ` (Cert: ${detail.certificationNumber})`
      : "";
    return `${detail.gradingCompany} ${detail.grade}${cert}`;
  } else {
    return `Raw: ${detail.rawCondition}`;
  }
}

/**
 * Suggest a default condition based on common patterns.
 * Useful as a fallback when eBay doesn't provide a suggestion.
 */
export function suggestDefaultCoinCondition(
  itemTitle: string,
): CoinConditionDetail | null {
  const title = itemTitle.toLowerCase();

  // Pattern: detect "proof" or "proof set"
  if (title.includes("proof")) {
    return {
      type: "raw",
      rawCondition: "Uncirculated",
    };
  }

  // Pattern: detect grading company mention
  const graders = [
    { pattern: /\bpcgs\b/i, company: "PCGS" as const },
    { pattern: /\bngc\b/i, company: "NGC" as const },
    { pattern: /\banacs\b/i, company: "ANACS" as const },
    { pattern: /\bicg\b/i, company: "ICG" as const },
  ];

  for (const { pattern, company } of graders) {
    if (pattern.test(title)) {
      // Try to extract grade from title (e.g., "MS 65", "PR 70")
      const gradeMatch = title.match(
        /\b(MS|PR|AU|XF|VF|F|VG|G)\s*(\d{1,2})\b/i,
      );
      if (gradeMatch) {
        return {
          type: "graded",
          gradingCompany: company,
          grade: `${gradeMatch[1].toUpperCase()} ${gradeMatch[2]}`,
        };
      }
    }
  }

  // Default fallback for unspecified coins
  return {
    type: "raw",
    rawCondition: "Uncirculated",
  };
}
```

---

### ✅ Action 4: Add Publish-Time Validation

**File:** [supabase/functions/ebay-publish/index.ts#L3890](supabase/functions/ebay-publish/index.ts#L3890)

Replace the current graceful-degradation logic with strict validation:

```typescript
// ── eBay June 2026 Coin Condition Descriptors ─────────────────────────
// Extract coinConditionDetail stored under itemSpecifics._coinConditionDetail
const rawItemSpecifics = (
  itemSpecifics && typeof itemSpecifics === "object" ? itemSpecifics : {}
) as Record<string, unknown>;
const coinConditionDetailRaw = rawItemSpecifics._coinConditionDetail as
  CoinConditionDetail | null | undefined;

// Check if this category is a coin category requiring descriptors
const isCoinDescriptorCategory = categoryTreeType === "coin";

// VALIDATION: Coin categories MUST have condition details
if (isCoinDescriptorCategory && !coinConditionDetailRaw) {
  throw new Error(
    `Coin listings in category ${finalCategoryId} require detailed condition information. ` +
      `Please specify either a certified grade (PCGS, NGC, etc.) or a raw condition tier before publishing.`,
  );
}

if (
  coinConditionDetailRaw &&
  isCoinDescriptorCategory &&
  clientId &&
  clientSecret
) {
  try {
    console.log(
      `create_draft: fetching coin condition descriptors for category ${finalCategoryId}, type=${coinConditionDetailRaw.type}`,
    );
    const descriptors = await fetchCoinConditionDescriptors(
      finalCategoryId,
      clientId,
      clientSecret,
      apiBase,
    );
    if (descriptors && descriptors.length > 0) {
      const conditionDescriptors = buildCoinConditionDescriptors(
        coinConditionDetailRaw,
        descriptors,
      );
      if (conditionDescriptors && conditionDescriptors.length > 0) {
        inventoryBody.conditionDescriptors = conditionDescriptors;
        console.log(
          `create_draft: added ${conditionDescriptors.length} conditionDescriptors for coin category ${finalCategoryId}:`,
          JSON.stringify(conditionDescriptors),
        );
      } else {
        // FAIL: Could not map user values to descriptor IDs
        throw new Error(
          `Could not map condition "${coinConditionDetailRaw.type === "graded" ? "graded" : coinConditionDetailRaw.rawCondition}" ` +
            `to eBay descriptor values for category ${finalCategoryId}. Please verify the condition is valid.`,
        );
      }
    } else {
      throw new Error(
        `Unable to retrieve condition descriptors from eBay for category ${finalCategoryId}. ` +
          `Please try again or contact support.`,
      );
    }
  } catch (cdErr) {
    console.error(`create_draft: coin descriptor error (FATAL):`, cdErr);
    throw cdErr;
  }
}
// ── End Coin Condition Descriptors ──────────────────────────────────
```

---

### ✅ Action 5: Add UI Confirmation Component

**File:** Create new [src/components/CoinConditionConfirmation.tsx](src/components/CoinConditionConfirmation.tsx)

```typescript
import { AlertTriangle, Check, Info } from "lucide-react";
import type { EbayCoinConditionSuggestion } from "@/lib/coinConditionHelper";
import { describeCoinCondition } from "@/lib/coinConditionHelper";
import type { CoinConditionDetail } from "@/types/listing";

interface CoinConditionConfirmationProps {
  suggestion: EbayCoinConditionSuggestion;
  onConfirm: (detail: CoinConditionDetail) => void;
  onReject: () => void;
  onEdit: () => void;
}

export function CoinConditionConfirmation({
  suggestion,
  onConfirm,
  onReject,
  onEdit,
}: CoinConditionConfirmationProps) {
  return (
    <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900">Confirm Coin Condition</h3>
          <p className="text-xs text-amber-800 mt-1">
            {suggestion.rationale}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
          suggestion.confidence === "high"
            ? "bg-green-100 text-green-700"
            : suggestion.confidence === "medium"
            ? "bg-yellow-100 text-yellow-700"
            : "bg-gray-100 text-gray-700"
        }`}>
          {suggestion.confidence} confidence
        </span>
      </div>

      <div className="bg-white rounded-lg p-3 border border-amber-100">
        <p className="text-sm font-bold text-foreground">
          {describeCoinCondition(suggestion.suggested)}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(suggestion.suggested)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          Use This Condition
        </button>
        <button
          onClick={onEdit}
          className="flex-1 py-2 rounded-lg bg-amber-100 text-amber-900 text-xs font-semibold hover:bg-amber-200 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onReject}
          className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
```

---

### ✅ Action 6: Update Category Lookup to Include Mandate Categories

**File:** [src/lib/ebayCategoryMap.ts](src/lib/ebayCategoryMap.ts)

Ensure the dynamic category mapping includes 256, 3377, 4733, 18466 in breadcrumb lookups and condition options.

---

## 4. Implementation Priority & Rollout

| Priority     | Action                                    | Effort | Impact                                                      | Target Date     |
| ------------ | ----------------------------------------- | ------ | ----------------------------------------------------------- | --------------- |
| **CRITICAL** | Update hardcoded category sets (Action 1) | 15 min | Unblocks descriptor detection for 256, 3377, 4733, 18466    | **ASAP**        |
| **CRITICAL** | Add publish-time validation (Action 4)    | 20 min | Prevents silent failures; catches missing conditions early  | **This week**   |
| **HIGH**     | Add Zod schema validation (Action 2)      | 20 min | Catches empty conditions at form submission, not at publish | **This week**   |
| **HIGH**     | Create coin condition helper (Action 3)   | 45 min | Enables user confirmation flow and default suggestions      | **Next sprint** |
| **MEDIUM**   | Add UI confirmation component (Action 5)  | 30 min | Improves UX for suggested conditions                        | **Next sprint** |
| **MEDIUM**   | Update category lookup (Action 6)         | 15 min | Ensures dynamic categories are recognized                   | **This week**   |

---

## 5. Testing Checklist

- [ ] **Sandbox Publish**: Create a draft coin listing in category 256 (World Coins) and publish to sandbox; verify `conditionDescriptors` appear in payload
- [ ] **Validation**: Attempt to submit form with empty coin condition for category 253; expect form validation error
- [ ] **Publish Validation**: Submit draft with missing `coinConditionDetail` for coin category; expect edge function to throw error
- [ ] **Grade Mapping**: Publish graded coin (MS 65, PCGS) in category 256; verify descriptor maps correctly to numeric IDs
- [ ] **Raw Condition**: Publish raw coin ("Uncirculated") in category 3377; verify descriptor maps correctly
- [ ] **Cert Number**: Publish graded coin with certification number; verify it appears in `additionalInfo`
- [ ] **Fallback**: Publish to production with eBay Metadata API call failing; verify graceful degradation logs warning and includes no `conditionDescriptors`

---

## 6. eBay Compliance Notes

**What eBay expects:**

- All coin listings in the five mandate categories must include structured `conditionDescriptors` in the Inventory API payload
- Descriptors map user condition (graded/raw) → numeric descriptor IDs fetched from Metadata API
- Missing `conditionDescriptors` = warning 25126 (advisory, not blocking early June)
- Come mid-June, non-compliance may escalate to rejection

**Our current resilience:**

- If descriptor fetch fails → log warning, include `conditionDescriptors` array (empty), let eBay decide
- If mapping fails → log error, include what we can
- **Improvement:** Make it a hard stop instead (proposed Action 4)

---

## 7. Long-Term Tracking

Once implemented, add a Supabase function to periodically validate:

```sql
SELECT count(*) as coin_listings_without_condition
FROM listings
WHERE ebay_category_id IN ('253', '256', '3377', '4733', '18466')
  AND (item_specifics->>'_coinConditionDetail' IS NULL OR item_specifics->>'_coinConditionDetail' = 'null')
  AND status = 'published';
```

Monitor this query weekly until mid-June; any non-zero results = compliance gap.

---

**Next Steps:** Begin with Action 1 (update category IDs) + Action 4 (strict validation) this week. These are low-effort, high-impact blockers for the mandate.
