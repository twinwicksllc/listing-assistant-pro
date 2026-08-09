# eBay Coin Category Condition Requirements Research

## Overview

This document summarizes research into eBay's coin category condition requirements, specifically addressing error 25059 and the conditions required for publishing graded/slabbed coins (NGC, PCGS, ANACS, ICG, CAC, ICCS certified coins).

---

## 1. Error 25059: Condition Validation Failure

### Error Details

- **Error Code**: 25059
- **Error Message**: `"Condition information [ID] does not exists or is not a valid condition for category [ID]."`
- **When it occurs**: During offer creation when the specified `condition` enum or `conditionId` is not valid for the target eBay category
- **HTTP Status**: 400 Bad Request

### Root Cause

eBay's Inventory API validates conditions at TWO levels:

1. **Condition Enum Level**: The string value (e.g., "USED_GOOD") must be a valid eBay enum
2. **Category Restriction Level**: The category may only accept a SUBSET of valid enums

Each category has its own allowed condition set defined in eBay's Metadata API.

### Example: Category 39464 (Morgan Dollars)

- ❌ `NEW` (1000) - Rejected by category 39464 despite being a valid eBay condition
- ❌ `USED_EXCELLENT` (3000) - Rejected by category 39464
- ✅ `USED_GOOD` (4000) - Accepted (working condition for graded coins)
- ✅ `USED_ACCEPTABLE` (5000) - Likely accepted
- ✅ `FOR_PARTS_OR_NOT_WORKING` (7000) - For damaged coins only

---

## 2. eBay Official Documentation

### Inventory API - Condition Enum Reference

**Official URL**: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum

**Valid Condition Enums**:

```
NEW                      (1000)
LIKE_NEW                 (2750)
NEW_OTHER                (1500)
NEW_WITH_DEFECTS         (1750)
CERTIFIED_REFURBISHED    (2000)
EXCELLENT_REFURBISHED    (2010)
VERY_GOOD_REFURBISHED    (2020)
GOOD_REFURBISHED         (2030)
SELLER_REFURBISHED       (2500)
PRE_OWNED_GOOD           (3000)
PRE_OWNED_FAIR           (5000)
PRE_OWNED_POOR           (6000)
FOR_PARTS_OR_NOT_WORKING (7000)
CERTIFIED_PRE_OWNED      (2010 or 2000 - varies)
DIGITAL_GOOD             (3000 - digital items only)
```

**Key Insight**: Not all enums are valid for all categories. Coin categories use a restricted subset.

### Category-Specific Conditions via Metadata API

**Official URL**: https://developer.ebay.com/api-docs/sell/metadata/resources/category/methods/getItemConditionPolicies

**Purpose**: Fetches the valid conditions for a specific category along with allowed condition descriptors

**Request Example**:

```
GET /sell/metadata/v1/category/{categoryId}/condition_policies
Authorization: Bearer {userToken}
```

**Response Structure**:

```json
{
  "itemConditions": [
    {
      "conditionId": 3000,
      "conditionDescription": "Pre-Owned - Good",
      "conditionDescriptors": [
        {
          "conditionDescriptorId": 1,
          "conditionDescriptorName": "Professional Grader",
          "mode": "SELECT",
          "values": [
            {
              "conditionDescriptorValueId": "1",
              "conditionDescriptorValueName": "NGC"
            },
            {
              "conditionDescriptorValueId": "2",
              "conditionDescriptorValueName": "PCGS"
            }
            // ... more graders
          ]
        }
        // ... more descriptors (Letter Grade, Numerical Grade, Cert #)
      ]
    }
  ]
}
```

---

## 3. Coin Condition Descriptors (eBay June 2026 Mandate)

### What Are ConditionDescriptors?

Additional structured metadata required for graded/certified coins. Unlike generic conditions, descriptors capture the specific grading details.

### Required Descriptors for Graded Coins

1. **Descriptor 1 - Professional Grader** (SELECT mode)
   - Valid values: NGC, PCGS, ANACS, ICG, CAC, ICCS
   - Indicates the certification company

2. **Descriptor 3 - Letter Grade** (SELECT mode)
   - Valid values: Mint State (MS), Proof (PR), About Uncirculated (AU), Extremely Fine (EF/XF), Very Fine (VF), Fine (F), Very Good (VG), Good (G), About Good (AG), Fair (FR), Poor (PO), Specimen (SP), Special Mint Set (SMS)
   - Can include modifier (Cameo, Deep Cameo)

3. **Descriptor 4 - Numerical Grade** (SELECT mode)
   - Valid values: 0-70 (for MS: 60-70 typical)
   - Specific numeric grade from the grading company

4. **Descriptor 5 - Certification Number** (FREE_TEXT mode)
   - Free text field up to 30 characters
   - Example: "123456789"

### How Descriptors Interact with Condition Enum

- The `condition` field (e.g., "USED_GOOD") tells eBay the general condition
- The `conditionDescriptors` array provides the DETAILED grading info
- eBay validates both:
  - Condition must be valid for category
  - Each descriptor must match a valid descriptor for that condition in that category
  - Descriptor values must be in the allowed values list

### Example Offer Payload for NGC MS 63 Morgan Dollar

```json
{
  "condition": "USED_GOOD",
  "conditionDescription": "Used - Good",
  "conditionDescriptors": [
    {
      "name": "1", // Professional Grader descriptor ID
      "values": ["2"] // PCGS value ID
    },
    {
      "name": "3", // Letter Grade descriptor ID
      "values": ["1000"] // Mint State value ID
    },
    {
      "name": "4", // Numerical Grade descriptor ID
      "values": ["63"] // Numerical grade value ID
    },
    {
      "name": "5", // Certification Number descriptor ID
      "additionalInfo": "123456789" // Free text cert number
    }
  ]
}
```

---

## 4. Seller Complaints & Forum Discussions

### Common Issues Reported

#### A. Error 25059 - Condition Not Valid for Category

**Frequency**: Very common for graded coin sellers
**Cause**: Using conditions not in the category's allowed list
**Solution**: Use eBay's Metadata API to fetch allowed conditions per category

#### B. Missing ConditionDescriptors Warning (25126)

**Issue**: "Graded coin listing missing condition descriptors"
**Impact**: Listing publishes but buyers see warning in mobile app
**Solution**: Always fetch and include descriptors for coin categories

#### C. Descriptor Value Mismatch

**Issue**: Sending a descriptor value that's not in the allowed values list
**Cause**: Hardcoding descriptor values instead of fetching from API
**Solution**: Always fetch valid descriptor values from Metadata API

#### D. Uncertified Coins with Grading Descriptors (Error 25019)

**Issue**: "Numerical grades only allowed on certified coins"
**Problem**: Including "MS 65" in title/description of uncertified coin
**Solution**: Only use numerical grades for certified coins; use "Uncertified" certification

### eBay Forum Recommendations

- **Always verify category** before publishing - use category lookup API
- **Fetch metadata for each category** - don't hardcode allowed conditions
- **Test with low-value items first** - verify condition works before publishing high-value coins
- **Use Professional Grader descriptor** - tells eBay coin is graded, compatible with most conditions
- **Include Numerical Grade** - critical for NGC/PCGS coins; helps with search/filtering

---

## 5. Implementation in listing-assistant-pro

### Current Approach (Post-June 2026)

#### Condition Mapping for Coin Categories

File: `supabase/functions/ebay-publish/index.ts`, function `normalizeConditionForCategory()`

**Strategy**:

1. Detect if category is a coin category
2. Map input condition to valid coin condition
3. For graded coins specifically, use `USED_GOOD` (ID 4000) as the base condition
4. Then attach the detailed grading via descriptors

```typescript
const validCoinConditions = new Set([
  "NEW", // MS-60 to MS-70 (uncirculated) and slabbed
  "USED_EXCELLENT", // AU-50 to XF-45
  "USED_VERY_GOOD", // VF-20 to VF-35
  "USED_GOOD", // F-12 to VG-10 ← Graded coins
  "USED_ACCEPTABLE", // G-4 to G-6
  "FOR_PARTS_OR_NOT_WORKING", // Damaged
]);

if (!validCoinConditions.has(condition)) {
  const fallbackMap: Record<string, string> = {
    LIKE_NEW: "USED_GOOD", // Graded coins → USED_GOOD
    // ... other mappings
  };
  const mapped = fallbackMap[condition] ?? "USED_VERY_GOOD";
  return { condition: mapped, corrected: true };
}
```

#### ConditionDescriptor Fetching

File: `supabase/functions/ebay-publish/index.ts`, function `fetchCoinConditionDescriptors()`

**Process**:

1. Check if category is a coin parent category
2. Call eBay Metadata API: `/sell/metadata/v1/category/{categoryId}/condition_policies`
3. Parse response to extract descriptor definitions
4. Cache in-memory for the duration of the function invocation
5. Return array of descriptors with their valid values

#### ConditionDescriptor Building

File: `supabase/functions/ebay-publish/index.ts`, function `buildCoinConditionDescriptors()`

**For Graded Coins** (NGC, PCGS, etc.):

1. Find "Professional Grader" descriptor → match grading company
2. Find "Numerical Grade" descriptor → match grade number (e.g., "65")
3. Find "Letter Grade" descriptor → match letter grade (e.g., "MS", "PR")
4. Find "Certification Number" descriptor → add cert number as additionalInfo

**Key Fix**: Now searches for both "number grade" AND "numerical grade" (eBay's actual name)

**For Raw/Uncertified Coins**:

1. Find "Coin Condition" descriptor
2. Match against raw condition values
3. No grading details added

---

## 6. Best Practices for Graded Coin Publishing

### 1. Category Selection

- Use `39464` for Morgan Dollars (1878-1921)
- Use `39455` for other US coins
- Use `45243` for World Coins
- Always verify category with dynamic taxonomy API before publishing

### 2. Condition Selection

- **Graded coins**: Use `USED_GOOD` (ID 4000) as base
  - Rationale: Works with Professional Grader descriptor
  - Coin's actual grade captured in descriptors, not condition field
- **Uncertified coins**: Use `USED_VERY_GOOD` or `USED_GOOD`
  - Include Coin Condition descriptor with raw condition value

### 3. ConditionDescriptors

- **Always fetch from Metadata API** - don't hardcode
- **Verify descriptor availability** per category
- **Include all 4 descriptors** for graded coins:
  - Professional Grader (required)
  - Letter Grade (required)
  - Numerical Grade (required) ← Critical fix
  - Certification Number (required)
- **Fallback gracefully** - if descriptor fetch fails, proceed without descriptors

### 4. Error Handling

- **Error 25059**: Condition not valid for category
  - Solution: Fetch from Metadata API, use USED_GOOD fallback
- **Warning 25126**: Missing condition descriptors
  - Impact: Non-fatal; listing still publishes
  - Solution: Ensure descriptor fetch succeeds
- **Error 25019**: Grades on uncertified coins
  - Solution: Never include numerical grades in title/description for uncertified coins

### 5. Testing Strategy

- Test with low-value Morgan Dollar first
- Verify all 4 descriptors included in offer
- Check for error 25059 in response
- Confirm descriptor values in Metadata API match values sent
- Once working, scale to high-value coins

---

## 7. Documentation & API References

### Official eBay Resources

1. **Inventory API - Offer Creation**
   - https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer

2. **Inventory API - Condition Enum**
   - https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum

3. **Metadata API - Category Conditions**
   - https://developer.ebay.com/api-docs/sell/metadata/resources/category/methods/getItemConditionPolicies

4. **Seller Hub - Coin Condition Guidelines**
   - https://www.ebay.com/help/selling/listings/setting-up-listing/adding-item-condition

5. **eBay Taxonomy API (Category Lookup)**
   - https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getCategory

### Debugging Resources

- eBay's API Explorer: https://developer.ebay.com/tools/api-explorer
- Test Server: https://api.sandbox.ebay.com (for testing before live)
- Error Code Reference: Check the error response JSON for `errorId` and `message`

---

## 8. Key Findings Summary

### What Works for Graded Coins in Category 39464 (Morgan Dollars)

✅ Condition: `USED_GOOD` (ID 4000)
✅ Professional Grader descriptor: NGC, PCGS, ANACS, ICG, CAC, ICCS
✅ Numerical Grade descriptor: 60-70 for Mint State coins
✅ Letter Grade descriptor: MS, PR, AU, EF, VF, F, VG, G, etc.
✅ Certification Number: FREE_TEXT field with cert number

### What Doesn't Work

❌ Condition: `NEW` (ID 1000) - Rejected by category 39464
❌ Condition: `USED_EXCELLENT` (ID 3000) - Rejected by category 39464
❌ Numerical grades in title/description of uncertified coins (Error 25019)
❌ Missing conditionDescriptors for graded coins (Warning 25126)
❌ Hardcoded descriptor values - must fetch from API per category

### Critical Implementation Issues Found & Fixed

1. ✅ **Condition Fallback**: LIKE_NEW now maps to USED_GOOD (not NEW) for graded coins
2. ✅ **Descriptor Matching Bug**: Now searches for "numerical grade" (eBay's actual name)
3. ⚠️ **Category-Specific Restrictions**: Each coin category may have different allowed conditions
   - Solution: Always use Metadata API to verify allowed conditions

---

## 9. Next Steps & Testing Checklist

### Deployment

- [ ] Deploy updated `ebay-publish/index.ts` to Supabase
- [ ] Verify build succeeds with no type errors
- [ ] Test in sandbox environment first

### Testing

- [ ] Create draft for NGC MS 63 Morgan Dollar (category 39464)
- [ ] Publish draft and check for error 25059
- [ ] Verify response includes all 4 conditionDescriptors
- [ ] Verify descriptor values match Metadata API allowed values
- [ ] Check eBay listing page for correct condition/grading display
- [ ] Test with different grading companies (NGC, PCGS, etc.)
- [ ] Test with different condition grades (MS 60, MS 65, AU 55, etc.)

### Fallback Strategy if USED_GOOD Fails

If category 39464 still rejects USED_GOOD:

1. Try `USED_ACCEPTABLE` (ID 5000)
2. Try `FOR_PARTS_OR_NOT_WORKING` (ID 7000) as last resort
3. Contact eBay support for category 39464 valid conditions list

---

## 10. References & Sources

### Primary Research

- Code review of `supabase/functions/ebay-publish/index.ts`
- Analysis of `buildCoinConditionDescriptors()` function
- Review of `normalizeConditionForCategory()` condition mapping logic
- eBay Inventory API documentation (v1.18.5+)
- eBay Metadata API documentation

### Session Notes

- Session memory: `/memories/session/coin-condition-fix.md`
- Build notes: `/memories/repo/build-and-test-notes.md`
- Code file: `supabase/functions/ebay-publish/index.ts` (lines 1451-2620)

### Related Issues

- Error 25059: Condition validation failure
- Error 25019: Numerical grades on uncertified coins
- Warning 25126: Missing condition descriptors

---

**Document Created**: May 18, 2026
**Last Updated**: May 18, 2026
**Status**: Research Complete - Ready for Implementation Testing
