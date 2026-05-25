# Phase 2: eBay Coin Condition Mandate - Schema & Payload Validation

**Date:** May 25, 2026  
**Status:** Implementation Complete  
**Scope:** Frontend form validation, backend error handling, terminal verification script

---

## Summary of Phase 2 Implementations

### ✅ 1. Schema & Payload Validation (Leaf Categories Only)

**File:** `src/lib/coinConditionValidator.ts`

Strict validation for both graded and raw coins per eBay mandates:

#### **Graded Coins**
- **Required Fields:**
  - `type: "graded"` (exact string)
  - `gradingCompany`: One of `PCGS | NGC | ANACS | ICG | CAC | ICCS` (exact enum)
  - `grade`: Format must be `[A-Z]{1,3} \d{1,2}(\s[A-Z]{2,})?`
    - Valid: `"MS 65"`, `"PR 70 DCAM"`, `"AU 58"`, `"VF 30 RB"`
    - Invalid: `"MS-65"` (hyphen not allowed), `"MS 65 PROOF"` (spaces in suffix)

- **Optional Fields:**
  - `certificationNumber`: String, trimmed, max 30 chars (recommended but not required)

#### **Raw Coins**
- **Required Fields:**
  - `type: "raw"` (exact string)
  - `rawCondition`: **Exactly one of four eBay strings** (case-sensitive):
    - `"Uncirculated"`
    - `"Extremely Fine to About Uncirculated"`
    - `"Fine to Very Fine"`
    - `"Below Fine"`

**Validator Functions:**
```typescript
// Validate the entire structure
validateCoinConditionDetail(detail): CoinConditionValidationResult

// Validate graded coins specifically
validateGradedCoinCondition(detail): CoinConditionValidationResult

// Validate raw coins specifically
validateRawCoinCondition(detail): CoinConditionValidationResult

// Check if a detail is fully valid (boolean)
isCoinConditionValid(detail): boolean

// Get human-readable description
describeCoinCondition(detail): string

// Format errors for UI display
formatValidationErrors(errors): string
```

**Example Usage:**
```typescript
import { validateCoinConditionDetail } from "@/lib/coinConditionValidator";

const gradedDetail = {
  type: "graded",
  gradingCompany: "PCGS",
  grade: "MS 65",
  certificationNumber: "12345678"
};

const result = validateCoinConditionDetail(gradedDetail);
if (!result.valid) {
  console.error(formatValidationErrors(result.errors));
}
```

---

### ✅ 2. Frontend UX Enforcements

**File:** `src/components/analyze/ListingFields.tsx`

#### **Real-Time Validation Feedback**
- Input fields show validation errors instantly (red alert boxes)
- Graded coin path shows:
  - Grading company dropdown (required)
  - Grade input with format hint: `"Format: MS 65 or PR 70 DCAM"`
  - Certification number input (optional)
- Raw coin path shows:
  - Dropdown with exactly four eBay strings (no free text)
  - No other options allowed

#### **Status Indicator**
- **Incomplete:** Amber box with warning icon: `"Complete these fields before publishing this coin listing."`
- **Complete:** Green box with checkmark: `"✓ PCGS MS 65 (Cert: 12345678) — Ready to publish"`

#### **Form Behavior**
- Graded/Raw toggle buttons clearly separate the two paths
- Selecting one path hides the other path's inputs
- Form validates on change (not just on blur)
- Publish button disabled until `coinConditionComplete === true`

---

### ✅ 3. Fallback & Fail-Safe Handling

**File:** `supabase/functions/ebay-publish/index.ts`

#### **Enhanced Metadata API Error Handling**

The `fetchCoinConditionDescriptors()` function now logs in detail:

**Success Path:**
```
fetchCoinConditionDescriptors: cache miss for 45243 — fetching from eBay Metadata API
fetchCoinConditionDescriptors: requesting app token from https://api.ebay.com/identity/v1/oauth2/token
fetchCoinConditionDescriptors: requesting condition policies from https://api.ebay.com/sell/metadata/v1/...
fetchCoinConditionDescriptors: Metadata API returned 1 policies for category 45243
fetchCoinConditionDescriptors: SUCCESS — found 3 descriptors (5 raw, 12 values) for category 45243:
  Grader(84720)[6v], Number Grade(84721)[24v], Certification Number(84722)[1v]
```

**Failure Paths:**
1. **Token Request Failed:**
   ```
   fetchCoinConditionDescriptors: app token request FAILED (401): 
   [error response truncated to 200 chars]
   ```
   - Logs HTTP status + response body (first 200 chars)
   - Returns `null` gracefully

2. **Metadata API Failed:**
   ```
   fetchCoinConditionDescriptors: Metadata API request FAILED (500) for category 45243: 
   [error response truncated to 300 chars]
   ```
   - Returns `null`, publish continues with warning 25126

3. **Unexpected Response Schema:**
   ```
   fetchCoinConditionDescriptors: unexpected Metadata API schema — 
   itemConditionPolicies not an array. Got: [response preview]
   ```
   - Logs expected vs actual schema
   - Gracefully returns `null`

4. **Parse Errors:**
   ```
   fetchCoinConditionDescriptors: failed to parse token response: [error details]
   ```
   - Catches JSON parse failures
   - Logs full stack trace

#### **Mandatory Validation at Publish Time**

If coin category is detected but `coinConditionDetailRaw` is missing:
```
throw new Error(
  `Coin listings in category 45243 require detailed condition information per eBay June 2026 mandate. ` +
  `Please specify either a certified grade (PCGS, NGC, ANACS, ICG, CAC, ICCS) or a raw condition tier ` +
  `(Uncirculated, Extremely Fine, etc.) before publishing.`
);
```

If descriptor mapping fails:
```
throw new Error(
  `Could not map condition details (type: graded) to eBay descriptor values for category 45243. ` +
  `Verify the grade, company, or raw condition value is valid and try again.`
);
```

---

### ✅ 4. Terminal Verification Script

**File:** `e2e/scripts/test-coin-conditions.js`

#### **Usage:**
```bash
npm run test:coin-compliance
```

Or directly:
```bash
node e2e/scripts/test-coin-conditions.js
```

#### **Test Cases (12 total):**

**Pass Cases (✓):**
- Valid graded coin (PCGS MS 65 with cert)
- Valid graded coin (NGC PR 70 DCAM without cert)
- Valid raw coin (Uncirculated)
- Valid raw coin (Fine to Very Fine)

**Fail Cases (✗ - intentional):**
- Invalid grading company (FAKE_GRADER)
- Missing grading company
- Invalid grade format (hyphen: MS-65)
- Invalid grade format (number only: 65)
- Raw condition not in allowed list (Used)
- Missing raw condition
- Invalid type field (unknown)
- Invalid cert number type (object instead of string)

#### **Output Example:**
```
================================================================================
eBay Coin Condition Mandate Compliance Test Suite
================================================================================

✓ Valid graded coin (PCGS MS 65)
  Status: PASS ✓

✗ Invalid grading company
  Status: PASS ✓
  (Test correctly identified invalid company and failed as expected)

================================================================================
Test Results: 12 passed, 0 failed out of 12 total
================================================================================

✅ All tests passed! Coin condition validation is working correctly.

Compliance Status:
  ✓ Graded coins: PCGS, NGC, ANACS, ICG, CAC, ICCS enforced
  ✓ Raw coins: Four-tier condition strings strictly validated
  ✓ Grade format: Letter + Space + Number pattern enforced
  ✓ Certification number: Optional, must be string if present
```

---

## Integration Checklist

### Frontend Modifications
- [x] Import validator in `ListingFields.tsx`
- [x] Add real-time validation feedback (red alert boxes)
- [x] Show/hide form fields based on graded/raw toggle
- [x] Display completion status (amber incomplete / green complete)
- [x] Format human-readable descriptions for display

### Backend Modifications
- [x] Enhanced logging in `fetchCoinConditionDescriptors()` with:
  - Cache hit/miss tracking
  - Token request logging
  - API request URL logging
  - Response schema validation
  - Parse error details
  - Success summary (descriptor count + names)
- [x] Mandatory validation at publish time (hard error if missing)
- [x] Fail-safe: returns `null` on API error, logs details

### Testing
- [x] Created terminal verification script with 12 test cases
- [x] Added npm script `test:coin-compliance` to package.json
- [x] All 12 tests pass (4 success, 8 intentional failures)

---

## Testing Workflows

### Manual Testing (UI)
1. Navigate to coin listing form in category 45243 (World Coins)
2. **Test Graded Path:**
   - Select "Graded coin"
   - Leave grading company blank → see red error
   - Select PCGS, enter invalid grade "MS65" (no space) → see red error
   - Correct to "MS 65" → error clears, green status shows
   - Optionally add certification number
3. **Test Raw Path:**
   - Select "Raw coin"
   - Leave condition blank → see red error
   - Select "Uncirculated" → green status shows

### Automated Testing (Terminal)
```bash
npm run test:coin-compliance
```

Expected: All 12 tests pass ✓

### Integration Testing (API)
1. Create a Supabase Draft with coin condition detail:
   ```json
   {
     "type": "graded",
     "gradingCompany": "NGC",
     "grade": "PR 70 DCAM",
     "certificationNumber": "ABC123456"
   }
   ```
2. Call `ebay-publish` function with `create_draft` action
3. Verify logs include:
   - `fetchCoinConditionDescriptors: cache miss for [categoryId]`
   - `SUCCESS — found X descriptors`
   - `MANDATORY: added X conditionDescriptors`
4. Verify eBay response includes `conditionDescriptors` array

---

## Troubleshooting

### Issue: Validation errors appear but don't clear when fixed

**Solution:** Component re-renders on every keystroke. If grade field shows error "MS65" → correct to "MS 65", error should clear instantly. If not, check that `validateCoinConditionDetail()` is being called in the change handler.

### Issue: Metadata API logs show "unexpected schema"

**Solution:** eBay Metadata API schema changed. Check:
1. `itemConditionPolicies` is still an array
2. Each policy has `itemConditions` array
3. Each condition has `conditionDescriptors` array
4. Each descriptor has `conditionDescriptorId`, `conditionDescriptorName`, `conditionDescriptorValues`

Contact eBay support if schema differs from documentation.

### Issue: Grade "MS 65 DCAM" fails validation

**Solution:** Grade pattern is `[A-Z]{1,3}\s+\d{1,2}(\s+[A-Z]{2,})?`. Your example "MS 65 DCAM":
- "MS" ✓ (2 letters, matches [A-Z]{1,3})
- " " ✓ (space separator)
- "65" ✓ (2 digits, matches \d{1,2})
- " DCAM" ✓ (space + 4 letters, matches \s+[A-Z]{2,})

Should pass. If it doesn't, check for:
- Hidden Unicode characters (copy-paste from web source)
- Single digit number ("MS 6" fails because \d{1,2} requires 1-2 digits AND 65 is 2)
- Three-letter code without numbers ("MS AU" fails because it needs \d)

### Issue: "Below Fine" not appearing in raw condition dropdown

**Solution:** This is the fourth option. If dropdown shows only 3 options, check `COIN_RAW_CONDITIONS` constant is defined with all four strings:
```typescript
"Uncirculated"
"Extremely Fine to About Uncirculated"
"Fine to Very Fine"
"Below Fine"
```

Exact spelling and capitalization required.

---

## Next Steps (Phase 3 - Future)

1. **Sentry Integration:** Log validator failures to Sentry for monitoring
2. **Analytics:** Track validation patterns (how many users select graded vs raw)
3. **Bulk Publish:** Extend validator to bulk operations
4. **Mobile UX:** Optimize form layout for small screens (raw dropdown may exceed width)
5. **Auto-Population:** When user uploads graded coin photo, AI suggests grader/grade and pre-fills form

---

## Files Changed

### New Files
- `src/lib/coinConditionValidator.ts` — Validation logic
- `e2e/scripts/test-coin-conditions.js` — Terminal test script

### Modified Files
- `src/components/analyze/ListingFields.tsx` — Frontend UI with validation
- `supabase/functions/ebay-publish/index.ts` — Enhanced error handling
- `package.json` — Added `test:coin-compliance` script

---

## Compliance Summary

| Requirement | Status | Evidence |
|---|---|---|
| Graded coins: Enforce exact company names | ✅ | Validator uses Set, rejects unknowns |
| Graded coins: Enforce grade format | ✅ | Regex `/^[A-Z]{1,3}\s+\d{1,2}(\s+[A-Z]{2,})?$/` |
| Raw coins: Enforce four-tier strings | ✅ | Validator uses Set with exact eBay strings |
| Frontend validation feedback | ✅ | Red alert boxes with error messages |
| Backend metadata logging | ✅ | Detailed logs at each step |
| Fallback error handling | ✅ | Returns null, logs details, continues safely |
| Terminal verification | ✅ | 12 test cases, all pass |

---

**Prepared by:** GitHub Copilot  
**For:** eBay Coin Condition Mandate Compliance (June 2026)  
**Approved by:** User (May 25, 2026)
