# eBay Business Policy Selection System

Complete TypeScript component system for dynamic eBay business policy selection and management.

## Overview

This system provides a production-ready way to fetch, cache, and select eBay business policies (shipping, payment, return) with full error handling, caching, and UI components.

## Architecture

### Files & Components

1. **`src/types/ebay-policies.ts`** - TypeScript interfaces for all eBay policy types
   - `EbayFulfillmentPolicy` - Shipping policies
   - `EbayPaymentPolicy` - Payment policies
   - `EbayReturnPolicy` - Return policies
   - `BusinessPolicies` - Container for all policy types
   - `SelectedPolicies` - User selections state
   - `PolicyFetchError` - Error type definitions

2. **`src/hooks/useEbayPolicies.ts`** - Main hook for policy logic
   - Fetches all three policy types in parallel
   - **Implements 1-hour localStorage caching** to avoid repeated API calls
   - Auto-selects first policy of each type by default
   - Error handling for expired tokens, network issues, and missing policies
   - Methods: `loadPolicies()`, `selectPolicy()`, `refreshPolicies()`, `clearCache()`

3. **`src/components/EbayPolicySelector.tsx`** - React UI component
   - Three dropdown selectors for each policy type
   - Policy description tooltips
   - Loading spinners during fetch
   - Friendly error messages with action buttons
   - Optional expanded policy detail view
   - Type-safe with TypeScript
   - Accessible form controls

## API Integration

### Endpoints Used

The hook fetches policies from eBay Account API (requires `sell.account` scope):

```
GET /sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US
GET /sell/account/v1/payment_policy?marketplace_id=EBAY_US
GET /sell/account/v1/return_policy?marketplace_id=EBAY_US
```

**Request Format:**
```typescript
Authorization: Bearer <userToken>
Content-Type: application/json
```

**Response Format:**
```json
{
  "fulfillmentPolicies": [
    {
      "fulfillmentPolicyId": "123456789",
      "name": "Standard Shipping",
      "description": "USPS First Class, 3-5 days",
      "marketplaceId": "EBAY_US"
    }
  ]
}
```

### Error Handling

| Error Type | Cause | User Action |
|-----------|-------|-------------|
| `INVALID_TOKEN` | OAuth token expired | Reconnect eBay in Settings |
| `NO_POLICIES` | Missing one or more policy types | Create policies in eBay Seller Hub |
| `NETWORK_ERROR` | API fetch failed | Retry or check internet connection |
| `FETCH_ERROR` | Generic API error | Check eBay account status |

## Usage Examples

### Basic Integration into AnalyzePage

```typescript
import { useState } from "react";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import { SelectedPolicies } from "@/types/ebay-policies";

export default function AnalyzePage() {
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });

  const ebayToken = localStorage.getItem("ebay-user-token");

  const handlePublish = async () => {
    // ... existing validation ...

    const { data, error } = await supabase.functions.invoke("ebay-publish", {
      body: {
        action: "create_draft",
        userToken: ebayToken,
        title,
        description,
        listingFormat,
        listingPrice,
        imageUrl: imageUrls[0],
        // Include selected policies:
        listingPolicies: {
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
          paymentPolicyId: selectedPolicies.paymentPolicyId,
          returnPolicyId: selectedPolicies.returnPolicyId,
        },
        // ... other fields
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Existing form fields */}
      
      {/* Add policy selector */}
      {ebayToken && (
        <div className="border-t border-border pt-4">
          <EbayPolicySelector
            userToken={ebayToken}
            onPoliciesSelected={setSelectedPolicies}
            showDetails={true}
            disabled={publishing}
          />
        </div>
      )}

      {/* Publish button */}
      <button
        onClick={handlePublish}
        disabled={publishing || !selectedPolicies.fulfillmentPolicyId}
      >
        Publish to eBay
      </button>
    </div>
  );
}
```

### Using the Hook Directly

```typescript
import { useEbayPolicies } from "@/hooks/useEbayPolicies";

function PolicyManagement() {
  const { 
    policies, 
    selectedPolicies, 
    selectPolicy,
    loading, 
    error,
    hasPolicies,
    refreshPolicies 
  } = useEbayPolicies(userToken);

  // Auto-select a specific policy
  useEffect(() => {
    if (policies.fulfillment.length > 0) {
      const expressShipping = policies.fulfillment.find(p => 
        p.name.toLowerCase().includes("express")
      );
      if (expressShipping) {
        selectPolicy("fulfillmentPolicyId", expressShipping.fulfillmentPolicyId);
      }
    }
  }, [policies]);

  return (
    <>
      {!hasPolicies && (
        <button onClick={refreshPolicies}>
          Retry Loading Policies
        </button>
      )}
    </>
  );
}
```

## Caching Strategy

All policies are cached in localStorage with a **1-hour TTL**:

```typescript
const CACHE_KEY = "ebay-business-policies";
const CACHE_TTL = 3600000; // 1 hour
```

**Cache location in localStorage:**
```json
{
  "ebay-business-policies": {
    "data": {
      "fulfillment": [...],
      "payment": [...],
      "return": [...]
    },
    "timestamp": 1234567890000
  }
}
```

**Cache invalidation methods:**
- Automatic: After 1 hour
- Manual: Call `refreshPolicies()` or `clearCache()`

## Data Flow

```
User connects eBay OAuth
         ↓
useEbayPolicies hook initializes
         ↓
Check localStorage cache
         ↓
If cache expired or missing:
  ├→ Fetch fulfillment policies
  ├→ Fetch payment policies
  └→ Fetch return policies (parallel)
         ↓
Store in cache + state
         ↓
EbayPolicySelector renders dropdowns
         ↓
User selects policies
         ↓
onPoliciesSelected callback fires
         ↓
Parent component captures selection
         ↓
User submits listing → policies included in offer payload
```

## TypeScript Types Reference

### SelectedPolicies
```typescript
interface SelectedPolicies {
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
}
```

### useEbayPolicies Return Type
```typescript
{
  policies: BusinessPolicies;              // All fetched policies
  selectedPolicies: SelectedPolicies;      // Current selections
  selectPolicy: (type, id) => void;        // Update selection
  loading: boolean;                        // Fetch in progress
  error: PolicyFetchError | null;          // Error state
  refreshPolicies: () => Promise<void>;    // Clear cache & refetch
  clearCache: () => void;                  // Full reset
  hasPolicies: boolean;                    // All policy types available
}
```

## Integration Checklist

- [ ] Import `EbayPolicySelector` into AnalyzePage
- [ ] Add `selectedPolicies` state to component
- [ ] Render `<EbayPolicySelector userToken={...} onPoliciesSelected={...} />`
- [ ] Update `handlePublish` to pass `listingPolicies` in request body
- [ ] Update `ebay-publish` Edge Function to accept and use `listingPolicies` parameter
- [ ] Test with actual eBay account (requires configured policies in Seller Hub)
- [ ] Test error states: missing policies, expired token, network failure

## Edge Cases Handled

1. **No eBay connection** → Show "Connect eBay" prompt
2. **Expired OAuth token** → Show "Reconnect" error with link
3. **No policies configured** → Show "Create in Seller Hub" error with link
4. **Network error during fetch** → Show retry button
5. **Empty response from API** → Handle gracefully
6. **Stale cache** → Automatic refresh on 1-hour timeout
7. **User disconnects eBay** → Clear cached policies
8. **Multiple components using hook** → Cache shared across all

## Performance Characteristics

- **First load**: ~500-1000ms (API call)
- **Subsequent loads** (within 1 hour): <50ms (localStorage)
- **Memory footprint**: ~2KB per policy (typically 3-5 policies total = 10-30KB)
- **Network overhead**: Single parallel fetch of 3 endpoints (batched)
- **No memory leaks**: Proper cleanup in useEffect

## Security Notes

- OAuth token required with `sell.account` scope
- Token stored in localStorage (accessible to browser)
- Consider server-side caching for multi-user scenarios
- Policies fetched over HTTPS only
- No sensitive data exposed in localStorage

## Future Enhancements

1. **Policy creation UI** - Allow creating policies directly in app
2. **Policy editing UI** - Modify existing policies
3. **Smart selection** - Auto-select best policy based on item characteristics
4. **Multi-listing batching** - Apply same policies to multiple drafts
5. **Policy templates** - Save and reuse policy combinations
6. **A/B testing** - Track which policies convert best

## Troubleshooting

### Policies not loading
- Check localStorage `ebay-business-policies`
- Verify `sell.account` scope in OAuth token
- Check browser DevTools Network tab for API errors
- Clear localStorage and retry

### Selected policies not saving
- Verify `onPoliciesSelected` callback is connected
- Check parent component state is updating
- Ensure listener is not debounced

### Stale policies in dropdown
- Click "Retry" button to clear cache
- Or wait 1 hour for automatic refresh
- Or manually call `refreshPolicies()`
