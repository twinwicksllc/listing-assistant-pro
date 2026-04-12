/**
 * Example Integration of EbayPolicySelector into AnalyzePage
 * Shows how to integrate policy selection into the eBay listing creation flow
 * 
 * This file demonstrates the suggested integration pattern.
 * To apply to AnalyzePage, merge the relevant sections into the existing component.
 */

import React, { useState } from "react";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import { useEbayPolicies } from "@/hooks/useEbayPolicies";
import { SelectedPolicies } from "@/types/ebay-policies";

/**
 * STEP 1: Add state for selected policies in AnalyzePage
 * 
 * Add to component state:
 */
interface ExampleAnalyzePageState {
  // ... existing state ...
  selectedPolicies: SelectedPolicies;
  showPolicySelector: boolean;
}

/**
 * STEP 2: Update handlePublish to include selected policies in the request
 * 
 * Current code (simplified):
 *   const { data, error } = await supabase.functions.invoke("ebay-publish", {
 *     body: {
 *       action: "create_draft",
 *       userToken: ebayToken,
 *       title, description, listingFormat, listingPrice, // ... other fields
 *     },
 *   });
 * 
 * Updated to include selected policies:
 */
export const examplePublishWithPolicies = async (
  ebayToken: string,
  title: string,
  description: string,
  listingFormat: "FIXED_PRICE" | "AUCTION",
  listingPrice: number,
  selectedPolicies: SelectedPolicies,
  supabase: any
) => {
  // Filter out null policies
  const listingPolicies: Record<string, string> = {};
  if (selectedPolicies.fulfillmentPolicyId) {
    listingPolicies.fulfillmentPolicyId = selectedPolicies.fulfillmentPolicyId;
  }
  if (selectedPolicies.paymentPolicyId) {
    listingPolicies.paymentPolicyId = selectedPolicies.paymentPolicyId;
  }
  if (selectedPolicies.returnPolicyId) {
    listingPolicies.returnPolicyId = selectedPolicies.returnPolicyId;
  }

  const { data, error } = await supabase.functions.invoke("ebay-publish", {
    body: {
      action: "create_draft",
      userToken: ebayToken,
      title,
      description,
      listingFormat,
      listingPrice,
      listingPolicies, // ← Include selected policies here
      // ... other fields (imageUrl, condition, ebayCategoryId, itemSpecifics, etc.)
    },
  });

  return { data, error };
};

/**
 * STEP 3: Example component showing how to use EbayPolicySelector
 */
export const ExamplePolicySelectorIntegration: React.FC<{
  ebayToken: string | null;
  onPoliciesSelected: (policies: SelectedPolicies) => void;
}> = ({ ebayToken, onPoliciesSelected }) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full bg-primary" />
          <h3 className="text-sm font-semibold text-foreground">eBay Business Policies</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Select your shipping, payment, and return policies for this listing.
        </p>
      </div>

      <EbayPolicySelector
        userToken={ebayToken}
        onPoliciesSelected={onPoliciesSelected}
        showDetails={true}
      />
    </div>
  );
};

/**
 * STEP 4: Integration into AnalyzePage - Full Example
 * 
 * This shows the complete integration pattern.
 * 
 * In the AnalyzePage component:
 */

// 1. Add state
interface PolicyState {
  selectedPolicies: SelectedPolicies;
}

// 2. In your component JSX, add the selector before the publish button:
export const AnalyzePagePolicySelectorPlacement = () => {
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });

  const ebayToken = localStorage.getItem("ebay-user-token");

  return (
    <div className="space-y-4">
      {/* Existing pricing section */}
      {/* ... */}

      {/* Add Policy Selector before publish button */}
      {ebayToken && (
        <div className="border-t border-border pt-4">
          <EbayPolicySelector
            userToken={ebayToken}
            onPoliciesSelected={setSelectedPolicies}
            showDetails={true}
            disabled={false} // Set to true during publishing
          />
        </div>
      )}

      {/* Publish button with updated handler */}
      {/* In handlePublish, pass selectedPolicies to the ebay-publish function */}
    </div>
  );
};

/**
 * STEP 5: Backend Integration (ebay-publish Edge Function)
 * 
 * Update the create_draft action handler to accept and use selectedPolicies:
 * 
 * interface PublishRequest {
 *   action: "create_draft";
 *   userToken: string;
 *   title: string;
 *   description: string;
 *   listingFormat: "FIXED_PRICE" | "AUCTION";
 *   listingPrice: number;
 *   imageUrl: string;
 *   condition: string;
 *   ebayCategoryId: string;
 *   itemSpecifics: Record<string, string>;
 *   listingPolicies?: {
 *     fulfillmentPolicyId?: string;
 *     paymentPolicyId?: string;
 *     returnPolicyId?: string;
 *   };
 * }
 * 
 * Then in the offer creation:
 * 
 *   const offerPayload: any = {
 *     listingFormat: req.listingFormat || "FIXED_PRICE",
 *     marketplaceId: "EBAY_US",
 *     sku: skuFromImages,
 *     pricingSummary: {
 *       price: {
 *         currency: "USD",
 *         value: req.listingPrice.toString(),
 *       },
 *     },
 *     // Use provided policies, or fall back to auto-fetched defaults
 *     listingPolicies: req.listingPolicies || {
 *       fulfillmentPolicyId: defaultFulfillmentId,
 *       paymentPolicyId: defaultPaymentId,
 *       returnPolicyId: defaultReturnId,
 *     },
 *     // ... rest of offer fields
 *   };
 */

/**
 * USAGE EXAMPLES
 * 
 * Example 1: Basic usage with callback
 * ────────────────────────────────────────
 * const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({...});
 * 
 * <EbayPolicySelector
 *   userToken={userToken}
 *   onPoliciesSelected={setSelectedPolicies}
 * />
 * 
 * Example 2: With error handling
 * ────────────────────────────────────────
 * const { policies, selectedPolicies, error, loading } = useEbayPolicies(userToken);
 * 
 * if (error?.type === "NO_POLICIES") {
 *   // Prompt user to create policies
 * }
 * if (error?.type === "INVALID_TOKEN") {
 *   // Prompt user to reconnect eBay
 * }
 * 
 * Example 3: Programmatic policy selection
 * ────────────────────────────────────────
 * const { selectPolicy, policies } = useEbayPolicies(userToken);
 * 
 * // Auto-select fastest shipping
 * const fastestPolicy = policies.fulfillment.find(p => 
 *   p.description?.includes("Express")
 * );
 * if (fastestPolicy) {
 *   selectPolicy("fulfillmentPolicyId", fastestPolicy.fulfillmentPolicyId);
 * }
 * 
 * Example 4: Caching and refresh
 * ────────────────────────────────────────
 * const { refreshPolicies, clearCache } = useEbayPolicies(userToken);
 * 
 * // Policies are auto-cached for 1 hour
 * // To refresh: 
 * await refreshPolicies();
 * 
 * // To completely clear:
 * clearCache();
 */

// Export for reference
export { EbayPolicySelector };
