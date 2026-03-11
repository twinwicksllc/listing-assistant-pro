/**
 * Custom hook for fetching and managing eBay business policies
 * Handles API calls, caching, and error states
 */

import { useState, useEffect, useCallback } from "react";
import {
  BusinessPolicies,
  SelectedPolicies,
  PolicyFetchError,
  EbayFulfillmentPolicy,
  EbayPaymentPolicy,
  EbayReturnPolicy,
} from "@/types/ebay-policies";

const CACHE_KEY = "ebay-business-policies";
const CACHE_TTL = 86400000; // 24 hours in milliseconds

/**
 * Type definition for cached policy data stored in localStorage
 * Includes the policy data and timestamp for TTL validation
 */
export interface CachedPolicies {
  data: BusinessPolicies;
  timestamp: number;
}

/**
 * Type definition for the return value of useEbayPolicies hook
 */
export interface UseEbayPoliciesReturn {
  policies: BusinessPolicies;
  selectedPolicies: SelectedPolicies;
  selectPolicy: (type: keyof SelectedPolicies, policyId: string | null) => void;
  loading: boolean;
  error: PolicyFetchError | null;
  refreshPolicies: () => Promise<void>;
  clearCache: () => void;
  hasPolicies: boolean;
  cacheAge: number | null; // Age of cache in milliseconds (null if no cache)
}

/**
 * Fetch a specific type of eBay business policy from the Account API
 * @param policyType - Type of policy to fetch (fulfillment, payment, return)
 * @param userToken - OAuth user token with sell.account scope
 * @returns Promise with policy array
 */
async function fetchPolicyType<T>(
  policyType: "fulfillment" | "payment" | "return",
  userToken: string
): Promise<T[]> {
  const policyEndpoint = {
    fulfillment: "fulfillment_policy",
    payment: "payment_policy",
    return: "return_policy",
  }[policyType];

  const response = await fetch(
    `https://api.ebay.com/sell/account/v1/${policyEndpoint}?marketplace_id=EBAY_US`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("INVALID_TOKEN");
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to fetch ${policyType} policies: ${error.message || response.statusText}`);
  }

  const data = await response.json();

  // Extract the policies array from response (key varies: fulfillmentPolicies, paymentPolicies, returnPolicies)
  const policyKey = `${policyType}Policies`;
  return data[policyKey] || [];
}

/**
 * Custom hook to manage eBay business policies
 * Fetches from API, caches in localStorage, provides selection state
 */
export function useEbayPolicies(userToken: string | null) {
  const [policies, setPolicies] = useState<BusinessPolicies>({
    fulfillment: [],
    payment: [],
    return: [],
  });
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PolicyFetchError | null>(null);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  /**
   * Load policies from cache or fetch from API
   */
  const loadPolicies = useCallback(async () => {
    if (!userToken) {
      setError({
        type: "INVALID_TOKEN",
        message: "Not connected to eBay. Please authorize your account.",
        timestamp: Date.now(),
      });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedPolicies = JSON.parse(cached);
        const age = Date.now() - parsed.timestamp;
        if (age < CACHE_TTL) {
          setPolicies(parsed.data);
          setCacheAge(age);
          // Auto-select first of each type if available
          if (parsed.data.fulfillment.length > 0) {
            setSelectedPolicies((prev) => ({
              ...prev,
              fulfillmentPolicyId: parsed.data.fulfillment[0].fulfillmentPolicyId,
            }));
          }
          if (parsed.data.payment.length > 0) {
            setSelectedPolicies((prev) => ({
              ...prev,
              paymentPolicyId: parsed.data.payment[0].paymentPolicyId,
            }));
          }
          if (parsed.data.return.length > 0) {
            setSelectedPolicies((prev) => ({
              ...prev,
              returnPolicyId: parsed.data.return[0].returnPolicyId,
            }));
          }
          setLoading(false);
          return;
        }
      }

      // Fetch all policy types in parallel
      const [fulfillment, payment, returnPolicies] = await Promise.all([
        fetchPolicyType<EbayFulfillmentPolicy>("fulfillment", userToken),
        fetchPolicyType<EbayPaymentPolicy>("payment", userToken),
        fetchPolicyType<EbayReturnPolicy>("return", userToken),
      ]);

      // Check if any policies exist
      if (fulfillment.length === 0 || payment.length === 0 || returnPolicies.length === 0) {
        setError({
          type: "NO_POLICIES",
          message: "Some policy types are not configured. Please create them in eBay Seller Hub.",
          timestamp: Date.now(),
        });
      }

      const newPolicies: BusinessPolicies = { fulfillment, payment, return: returnPolicies };

      // Cache the result with timestamp
      const cacheData: CachedPolicies = { data: newPolicies, timestamp: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      setCacheAge(0); // Freshly cached

      setPolicies(newPolicies);

      // Auto-select first of each type
      setSelectedPolicies({
        fulfillmentPolicyId: fulfillment[0]?.fulfillmentPolicyId || null,
        paymentPolicyId: payment[0]?.paymentPolicyId || null,
        returnPolicyId: returnPolicies[0]?.returnPolicyId || null,
      });
    } catch (err: any) {
      console.error("Failed to load eBay policies:", err);

      let errorType: PolicyFetchError["type"] = "FETCH_ERROR";
      let errorMessage = err.message || "Failed to load policies";

      if (err.message === "INVALID_TOKEN") {
        errorType = "INVALID_TOKEN";
        errorMessage = "eBay session expired. Please reconnect your account.";
      } else if (err.message.includes("Failed to fetch")) {
        errorType = "NETWORK_ERROR";
      }

      setError({
        type: errorType,
        message: errorMessage,
        timestamp: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, [userToken]);

  /**
   * Auto-load policies when component mounts or userToken changes
   */
  useEffect(() => {
    if (userToken) {
      loadPolicies();
    }
  }, [userToken, loadPolicies]);

  /**
   * Clear cache and refetch policies
   */
  const refreshPolicies = useCallback(async () => {
    localStorage.removeItem(CACHE_KEY);
    setCacheAge(null);
    await loadPolicies();
  }, [loadPolicies]);

  /**
   * Update selection for a specific policy type
   */
  const selectPolicy = useCallback(
    (type: keyof SelectedPolicies, policyId: string | null) => {
      setSelectedPolicies((prev) => ({
        ...prev,
        [type]: policyId,
      }));
    },
    []
  );

  /**
   * Clear selected policies, cache, and errors
   */
  const clearCache = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    setPolicies({ fulfillment: [], payment: [], return: [] });
    setSelectedPolicies({
      fulfillmentPolicyId: null,
      paymentPolicyId: null,
      returnPolicyId: null,
    });
    setCacheAge(null);
    setError(null);
  }, []);

  return {
    policies,
    selectedPolicies,
    selectPolicy,
    loading,
    error,
    refreshPolicies,
    clearCache,
    hasPolicies: policies.fulfillment.length > 0 && policies.payment.length > 0 && policies.return.length > 0,
    cacheAge,
  };
}
