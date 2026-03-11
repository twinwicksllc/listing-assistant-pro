/**
 * eBay Business Policy TypeScript Interfaces
 * Represents the policy objects returned from eBay Account API
 */

export interface EbayFulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  shippingOption?: {
    optionType: "DOMESTIC" | "INTERNATIONAL";
    costType: "FLAT_RATE" | "CALCULATED";
    shippingServices?: Array<{
      shippingServiceCode: string;
      shippingCarrier: string;
      shippingCost?: {
        currency: string;
        value: string;
      };
      sortOrder: number;
    }>;
  };
}

export interface EbayPaymentPolicy {
  paymentPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  paymentMethods?: string[];
  immediatePaymentRequired?: boolean;
}

export interface EbayReturnPolicy {
  returnPolicyId: string;
  name: string;
  description?: string;
  marketplaceId: string;
  returnsAccepted: boolean;
  returnPeriod?: {
    value: number;
    unit: "DAY" | "MONTH" | "YEAR";
  };
  returnMethod?: "REPLACEMENT" | "MONEY_BACK" | "EXCHANGE";
  returnShippingCostPayer?: "BUYER" | "SELLER";
}

export interface BusinessPolicies {
  fulfillment: EbayFulfillmentPolicy[];
  payment: EbayPaymentPolicy[];
  return: EbayReturnPolicy[];
}

export interface SelectedPolicies {
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
}

export interface PolicyFetchError {
  type: "FETCH_ERROR" | "INVALID_TOKEN" | "NO_POLICIES" | "NETWORK_ERROR";
  message: string;
  timestamp: number;
}
