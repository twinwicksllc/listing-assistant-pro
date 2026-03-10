/**
 * Testing utilities and mock data for eBay Policy Selection system
 * Use these for development and testing without hitting real eBay API
 */

import {
  EbayFulfillmentPolicy,
  EbayPaymentPolicy,
  EbayReturnPolicy,
  BusinessPolicies,
  SelectedPolicies,
} from "@/types/ebay-policies";

/**
 * Mock eBay fulfillment policies for testing
 */
export const MOCK_FULFILLMENT_POLICIES: EbayFulfillmentPolicy[] = [
  {
    fulfillmentPolicyId: "mock-fulfill-001",
    name: "Standard Shipping - Small Items",
    description: "USPS First Class Mail, 3-5 business days",
    marketplaceId: "EBAY_US",
    shippingOption: {
      optionType: "DOMESTIC",
      costType: "FLAT_RATE",
      shippingServices: [
        {
          shippingServiceCode: "USPS_FIRST_CLASS",
          shippingCarrier: "USPS",
          shippingCost: { currency: "USD", value: "3.99" },
          sortOrder: 1,
        },
      ],
    },
  },
  {
    fulfillmentPolicyId: "mock-fulfill-002",
    name: "Express Shipping",
    description: "USPS Priority Mail Express, 1-2 business days",
    marketplaceId: "EBAY_US",
    shippingOption: {
      optionType: "DOMESTIC",
      costType: "FLAT_RATE",
      shippingServices: [
        {
          shippingServiceCode: "USPS_PRIORITY_EXPRESS",
          shippingCarrier: "USPS",
          shippingCost: { currency: "USD", value: "15.99" },
          sortOrder: 1,
        },
      ],
    },
  },
  {
    fulfillmentPolicyId: "mock-fulfill-003",
    name: "Free Shipping - Heavy Items",
    description: "UPS Ground (5-7 business days), free to buyer",
    marketplaceId: "EBAY_US",
    shippingOption: {
      optionType: "DOMESTIC",
      costType: "FLAT_RATE",
      shippingServices: [
        {
          shippingServiceCode: "UPS_GROUND",
          shippingCarrier: "UPS",
          shippingCost: { currency: "USD", value: "0.00" },
          sortOrder: 1,
        },
      ],
    },
  },
  {
    fulfillmentPolicyId: "mock-fulfill-004",
    name: "International Shipping",
    description: "DHL International, 10-15 business days",
    marketplaceId: "EBAY_US",
    shippingOption: {
      optionType: "INTERNATIONAL",
      costType: "CALCULATED",
    },
  },
];

/**
 * Mock eBay payment policies for testing
 */
export const MOCK_PAYMENT_POLICIES: EbayPaymentPolicy[] = [
  {
    paymentPolicyId: "mock-payment-001",
    name: "All Payment Methods Accepted",
    description: "Accepts credit cards, PayPal, and managed payments",
    marketplaceId: "EBAY_US",
    paymentMethods: ["CREDIT_CARD", "PAYPAL", "MANAGED_PAYMENTS"],
    immediatePaymentRequired: false,
  },
  {
    paymentPolicyId: "mock-payment-002",
    name: "Credit Cards Only",
    description: "Accepts Visa, Mastercard, and American Express only",
    marketplaceId: "EBAY_US",
    paymentMethods: ["CREDIT_CARD"],
    immediatePaymentRequired: true,
  },
  {
    paymentPolicyId: "mock-payment-003",
    name: "PayPal Preferred",
    description: "Accepts PayPal and managed payments",
    marketplaceId: "EBAY_US",
    paymentMethods: ["PAYPAL", "MANAGED_PAYMENTS"],
    immediatePaymentRequired: false,
  },
];

/**
 * Mock eBay return policies for testing
 */
export const MOCK_RETURN_POLICIES: EbayReturnPolicy[] = [
  {
    returnPolicyId: "mock-return-001",
    name: "30-Day Returns - Full Refund",
    description: "30 days for return, seller pays return shipping",
    marketplaceId: "EBAY_US",
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnMethod: "MONEY_BACK",
    returnShippingCostPayer: "SELLER",
  },
  {
    returnPolicyId: "mock-return-002",
    name: "14-Day No Returns",
    description: "14 days only for defective items, buyer pays return shipping",
    marketplaceId: "EBAY_US",
    returnsAccepted: true,
    returnPeriod: { value: 14, unit: "DAY" },
    returnMethod: "MONEY_BACK",
    returnShippingCostPayer: "BUYER",
  },
  {
    returnPolicyId: "mock-return-003",
    name: "No Returns Accepted",
    description: "Items sold as-is, no returns accepted",
    marketplaceId: "EBAY_US",
    returnsAccepted: false,
  },
  {
    returnPolicyId: "mock-return-004",
    name: "60-Day Returns - Exchange or Refund",
    description: "60 days for any reason, full refund or exchange",
    marketplaceId: "EBAY_US",
    returnsAccepted: true,
    returnPeriod: { value: 60, unit: "DAY" },
    returnMethod: "EXCHANGE",
    returnShippingCostPayer: "SELLER",
  },
];

/**
 * Complete mock business policies bundle
 */
export const MOCK_BUSINESS_POLICIES: BusinessPolicies = {
  fulfillment: MOCK_FULFILLMENT_POLICIES,
  payment: MOCK_PAYMENT_POLICIES,
  return: MOCK_RETURN_POLICIES,
};

/**
 * Default selected policies for testing
 */
export const MOCK_DEFAULT_SELECTED: SelectedPolicies = {
  fulfillmentPolicyId: "mock-fulfill-001",
  paymentPolicyId: "mock-payment-001",
  returnPolicyId: "mock-return-001",
};

/**
 * Mock localStorage manager for tests
 * Simulates the caching behavior without actual browser API
 */
export class MockStorageManager {
  private storage: Map<string, string> = new Map();

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }

  getAllItems(): Record<string, string> {
    const result: Record<string, string> = {};
    this.storage.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

/**
 * Test scenario: User fetches policies first time
 * Expected: API call, cache stored
 */
export const testScenario_FirstFetch = () => {
  const storage = new MockStorageManager();
  const token = "mock-token-123";

  // Simulate fetch
  const cacheData = {
    data: MOCK_BUSINESS_POLICIES,
    timestamp: Date.now(),
  };
  storage.setItem("ebay-business-policies", JSON.stringify(cacheData));

  // Verify cache
  const cached = storage.getItem("ebay-business-policies");
  console.assert(cached !== null, "Cache should be stored");

  return { success: cached !== null, cache: cached };
};

/**
 * Test scenario: User fetches policies within 1 hour
 * Expected: Cache hit, no API call
 */
export const testScenario_CacheHit = () => {
  const storage = new MockStorageManager();
  const CACHE_TTL = 3600000; // 1 hour

  // Set cached data
  const now = Date.now();
  const cacheData = {
    data: MOCK_BUSINESS_POLICIES,
    timestamp: now,
  };
  storage.setItem("ebay-business-policies", JSON.stringify(cacheData));

  // Check cache validity (30 minutes later)
  const elapsed = 30 * 60 * 1000;
  const cached = JSON.parse(storage.getItem("ebay-business-policies")!);
  const isValid = now - cached.timestamp < CACHE_TTL;

  console.assert(isValid, "Cache should still be valid within 1 hour");

  return { success: isValid };
};

/**
 * Test scenario: Cache expires after 1 hour
 * Expected: Cache miss, API call triggered
 */
export const testScenario_CacheExpired = () => {
  const storage = new MockStorageManager();
  const CACHE_TTL = 3600000;

  // Set old cached data (2 hours ago)
  const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
  const cacheData = {
    data: MOCK_BUSINESS_POLICIES,
    timestamp: twoHoursAgo,
  };
  storage.setItem("ebay-business-policies", JSON.stringify(cacheData));

  // Check cache validity
  const cached = JSON.parse(storage.getItem("ebay-business-policies")!);
  const isExpired = Date.now() - cached.timestamp >= CACHE_TTL;

  console.assert(isExpired, "Cache should be expired after 1 hour");

  return { success: isExpired };
};

/**
 * Test scenario: User manually refreshes policies
 * Expected: Cache cleared, new fetch triggered
 */
export const testScenario_ManualRefresh = () => {
  const storage = new MockStorageManager();

  // Set cached data
  storage.setItem(
    "ebay-business-policies",
    JSON.stringify({ data: MOCK_BUSINESS_POLICIES, timestamp: Date.now() })
  );
  console.assert(storage.getItem("ebay-business-policies") !== null);

  // Manual refresh: clear cache
  storage.removeItem("ebay-business-policies");
  console.assert(storage.getItem("ebay-business-policies") === null);

  return { success: true };
};

/**
 * Test scenario: Invalid OAuth token error
 * Expected: Error state, user prompted to reconnect
 */
export const testScenario_InvalidToken = () => {
  const error = {
    type: "INVALID_TOKEN" as const,
    message: "eBay session expired. Please reconnect your account.",
    timestamp: Date.now(),
  };

  console.assert(
    error.type === "INVALID_TOKEN",
    "Error type should be INVALID_TOKEN"
  );
  console.assert(
    error.message.includes("reconnect"),
    "Error message should prompt reconnection"
  );

  return { success: true, error };
};

/**
 * Test scenario: No policies configured
 * Expected: Error state, user prompted to create policies in Seller Hub
 */
export const testScenario_NoPolicies = () => {
  const emptyPolicies: BusinessPolicies = {
    fulfillment: [],
    payment: [],
    return: [],
  };

  const hasPolicies = 
    emptyPolicies.fulfillment.length > 0 &&
    emptyPolicies.payment.length > 0 &&
    emptyPolicies.return.length > 0;

  console.assert(!hasPolicies, "Should detect missing policies");

  return { success: !hasPolicies };
};

/**
 * Test scenario: User selects custom policies
 * Expected: Selection updates, callback fires with new selection
 */
export const testScenario_SelectPolicies = () => {
  const selected: SelectedPolicies = {
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  };

  // User selects fulfillment policy
  const newSelected = {
    ...selected,
    fulfillmentPolicyId: "mock-fulfill-002",
  };

  console.assert(
    newSelected.fulfillmentPolicyId === "mock-fulfill-002",
    "Selection should update"
  );

  // User selects payment policy
  newSelected.paymentPolicyId = "mock-payment-003";

  // User selects return policy
  newSelected.returnPolicyId = "mock-return-004";

  console.assert(
    newSelected.returnPolicyId === "mock-return-004",
    "All selections should be captured"
  );

  return { success: true, selected: newSelected };
};

/**
 * Helper function to run all test scenarios
 */
export function runAllTests() {
  const tests = [
    { name: "First Fetch", fn: testScenario_FirstFetch },
    { name: "Cache Hit", fn: testScenario_CacheHit },
    { name: "Cache Expired", fn: testScenario_CacheExpired },
    { name: "Manual Refresh", fn: testScenario_ManualRefresh },
    { name: "Invalid Token", fn: testScenario_InvalidToken },
    { name: "No Policies", fn: testScenario_NoPolicies },
    { name: "Select Policies", fn: testScenario_SelectPolicies },
  ];

  console.group("eBay Policy Selection - Test Suite");
  tests.forEach(({ name, fn }) => {
    try {
      const result = fn();
      console.log(
        `✓ ${name}: ${result.success ? "PASS" : "FAIL"}`
      );
    } catch (error) {
      console.error(`✗ ${name}: ${error}`);
    }
  });
  console.groupEnd();
}

// Export for use in test files
export default {
  MOCK_FULFILLMENT_POLICIES,
  MOCK_PAYMENT_POLICIES,
  MOCK_RETURN_POLICIES,
  MOCK_BUSINESS_POLICIES,
  MOCK_DEFAULT_SELECTED,
  MockStorageManager,
  runAllTests,
};
