/**
 * QUICK START: eBay Business Policy Selection Integration
 * 
 * This guide walks through integrating the policy selector into AnalyzePage
 * in approximately 5 minutes.
 */

// ============================================================================
// STEP 1: Import the component and types
// ============================================================================
// File: src/pages/AnalyzePage.tsx
// Add these imports at the top:

import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import { SelectedPolicies } from "@/types/ebay-policies";

// ============================================================================
// STEP 2: Add state for selected policies
// ============================================================================
// Inside the AnalyzePage component, add this state near other form fields:

const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
  fulfillmentPolicyId: null,
  paymentPolicyId: null,
  returnPolicyId: null,
});

// ============================================================================
// STEP 3: Add the policy selector to the JSX
// ============================================================================
// In the render section, add the component BEFORE the publish button.
// Good location: after the "Listing Format & Price" section, before "Export Listing"

// Insert this JSX:
{ebayToken && (
  <div className="space-y-3">
    <div className="flex items-center gap-1.5">
      <LockOpen className="w-3.5 h-3.5 text-primary" />
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        eBay Policies
      </label>
    </div>
    <EbayPolicySelector
      userToken={ebayToken}
      onPoliciesSelected={setSelectedPolicies}
      showDetails={false}
      disabled={publishing}
    />
  </div>
)}

// ============================================================================
// STEP 4: Update handlePublish to include policies
// ============================================================================
// Modify the POST request body in handlePublish:

const { data, error } = await supabase.functions.invoke("ebay-publish", {
  body: {
    action: "create_draft",
    userToken: ebayToken,
    title,
    description: getDescriptionWithFooter(),
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
    imageUrl: imageUrls[0],
    condition,
    ebayCategoryId,
    itemSpecifics,
    // ADD THIS ↓ to include selected policies:
    listingPolicies: {
      fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
      paymentPolicyId: selectedPolicies.paymentPolicyId,
      returnPolicyId: selectedPolicies.returnPolicyId,
    },
  },
});

// ============================================================================
// STEP 5: Add validation before publishing
// ============================================================================
// Before calling ebay-publish, validate that policies are selected:

const handlePublish = async () => {
  // ... existing checks ...

  // NEW: Check if policies are selected
  if (!selectedPolicies.fulfillmentPolicyId || 
      !selectedPolicies.paymentPolicyId || 
      !selectedPolicies.returnPolicyId) {
    toast.error("Please select all required policies before publishing");
    return;
  }

  // ... rest of publish logic ...
};

// Optional: Disable publish button if policies missing
<button
  onClick={handlePublish}
  disabled={publishing || !selectedPolicies.fulfillmentPolicyId}
  // ... rest of button props
>
  {publishing ? "Publishing..." : "Publish Live to eBay"}
</button>

// ============================================================================
// STEP 6: Update backend to accept policies (OPTIONAL - defaults still work)
// ============================================================================
// File: supabase/functions/ebay-publish/index.ts
// 
// If you want to use user-selected policies instead of auto-fetched defaults,
// update the request handler:
//
// interface CreateDraftRequest {
//   action: "create_draft";
//   userToken: string;
//   title: string;
//   // ... other fields ...
//   listingPolicies?: {
//     fulfillmentPolicyId?: string;
//     paymentPolicyId?: string;
//     returnPolicyId?: string;
//   };
// }
//
// Then in the offer creation, prefer user-selected over defaults:
//
// const offerPayload = {
//   // ...
//   listingPolicies: req.listingPolicies?.fulfillmentPolicyId ? {
//     fulfillmentPolicyId: req.listingPolicies.fulfillmentPolicyId,
//     paymentPolicyId: req.listingPolicies.paymentPolicyId,
//     returnPolicyId: req.listingPolicies.returnPolicyId,
//   } : {
//     fulfillmentPolicyId: defaultFulfillmentId,
//     paymentPolicyId: defaultPaymentId,
//     returnPolicyId: defaultReturnId,
//   },
//   // ...
// };

// ============================================================================
// DONE! Testing checklist:
// ============================================================================

const INTEGRATION_CHECKLIST = `
☐ Added EbayPolicySelector import
☐ Added selectedPolicies state
☐ Rendered <EbayPolicySelector /> in JSX
☐ Updated handlePublish to include listingPolicies
☐ Added validation to check policies are selected
☐ Updated disable state on publish button
☐ (Optional) Updated backend to use selected policies
☐ Tested with connected eBay account
☐ Tested error states (no policies, expired token)
☐ Tested policy selection callbacks
☐ Verified policies are included in API request
`;

// ============================================================================
// Component API Reference
// ============================================================================

/*
<EbayPolicySelector
  // Required: OAuth user token with sell.account scope
  userToken={ebayToken}
  
  // Callback: fires when user selects policies
  onPoliciesSelected={(policies) => setSelectedPolicies(policies)}
  
  // Optional: disable dropdowns during publishing
  disabled={publishing}
  
  // Optional: show expanded policy details below dropdowns
  showDetails={false}
/>
*/

// ============================================================================
// Hook API Reference (if accessing policies directly)
// ============================================================================

/*
import { useEbayPolicies } from "@/hooks/useEbayPolicies";

const {
  policies,              // { fulfillment: [...], payment: [...], return: [...] }
  selectedPolicies,      // { fulfillmentPolicyId, paymentPolicyId, returnPolicyId }
  selectPolicy,          // (type, id) => void
  loading,               // boolean
  error,                 // PolicyFetchError | null
  refreshPolicies,       // () => Promise<void>
  clearCache,            // () => void
  hasPolicies,           // boolean - all 3 types available
} = useEbayPolicies(userToken);
*/

// ============================================================================
// Mock Data for Development
// ============================================================================

// Use mock data if you don't have a real eBay account:
// Import from: src/test/ebay-policies.test.ts
// 
// import { 
//   MOCK_BUSINESS_POLICIES,
//   MOCK_DEFAULT_SELECTED 
// } from "@/test/ebay-policies.test.ts";

// ============================================================================
// Troubleshooting
// ============================================================================

const TROUBLESHOOTING = {
  "Policies not loading": [
    "1. Verify eBay is connected (check localStorage for 'ebay-user-token')",
    "2. Ensure OAuth token has 'sell.account' scope",
    "3. Check browser DevTools Network tab for API errors",
    "4. Verify user has policies configured in eBay Seller Hub",
  ],

  "Policies loaded but selections not working": [
    "1. Verify onPoliciesSelected callback is provided",
    "2. Check that setSelectedPolicies state is updating",
    "3. Open DevTools Console and run: localStorage.getItem('ebay-business-policies')",
  ],

  "Publish fails with policy error": [
    "1. Verify all three policy types are selected (not null)",
    "2. Check that policy IDs are valid strings",
    "3. Ensure backend is expecting listingPolicies parameter",
    "4. Check eBay API error response for specific policy issue",
  ],

  "Same policies appearing multiple times": [
    "1. Check eBay Seller Hub - you may have duplicate policy names",
    "2. Clear localStorage cache: localStorage.remove('ebay-business-policies')",
    "3. Refresh page and re-fetch policies",
  ],

  "Token expired error": [
    "1. User needs to reconnect eBay via Settings",
    "2. Or click 'Reconnect eBay' link in error message",
    "3. Component will automatically refresh policies after reconnection",
  ],
};

// ============================================================================
// Files Summary
// ============================================================================

const FILES_CREATED = {
  "src/types/ebay-policies.ts": "TypeScript interfaces for all policy types",
  "src/hooks/useEbayPolicies.ts": "Custom hook for fetching & caching policies",
  "src/components/EbayPolicySelector.tsx": "Main React UI component",
  "src/components/EbayPolicySelectorIntegration.md": "Integration examples",
  "src/test/ebay-policies.test.ts": "Mock data & testing utilities",
  "EBAY_POLICY_SELECTION_GUIDE.md": "Complete documentation",
  "QUICKSTART.md": "This file - quick integration guide",
};

// ============================================================================
// Support
// ============================================================================

const SUPPORT = `
For issues or questions:
1. Check the full documentation: EBAY_POLICY_SELECTION_GUIDE.md
2. Run test scenarios: import { runAllTests } from '@/test/ebay-policies.test'
3. Check browser DevTools for API errors
4. Verify eBay Seller Hub has policies configured
5. Test with mock data first: MOCK_BUSINESS_POLICIES
`;

export default {
  INTEGRATION_CHECKLIST,
  TROUBLESHOOTING,
  FILES_CREATED,
  SUPPORT,
};
