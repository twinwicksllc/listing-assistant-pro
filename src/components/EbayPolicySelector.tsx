/**
 * eBay Business Policy Selector Component
 * Provides UI for selecting fulfillment, payment, and return policies
 * with dropdowns, loading states, error messages, and policy details
 */

import React, { useState } from "react";
import { AlertTriangle, RefreshCw, Loader2, ChevronDown, Info } from "lucide-react";
import { useEbayPolicies } from "@/hooks/useEbayPolicies";
import {
  EbayFulfillmentPolicy,
  EbayPaymentPolicy,
  EbayReturnPolicy,
  SelectedPolicies,
} from "@/types/ebay-policies";

interface EbayPolicySelectorProps {
  /**
   * OAuth user token with sell.account scope
   */
  userToken: string | null;

  /**
   * Callback when policies are selected
   * Passes the selected policy IDs
   */
  onPoliciesSelected?: (policies: SelectedPolicies) => void;

  /**
   * Optional: disable user interaction (e.g., during publishing)
   */
  disabled?: boolean;

  /**
   * Optional: show policy details in expanded view
   */
  showDetails?: boolean;

  /**
   * Optional: validation errors for each policy type
   */
  policyErrors?: {
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
  };
}

interface PolicyDropdownProps {
  label: string;
  options: Array<{ id: string; name: string; description?: string }>;
  selectedId: string | null;
  onChange: (id: string | null) => void;
  loading: boolean;
  disabled?: boolean;
  error?: string;
}

/**
 * Format cache age in human-readable format
 */
const formatCacheAge = (ageMs: number | null): string => {
  if (ageMs === null) return "Never";
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * Individual policy dropdown selector with description tooltip
 */
const PolicyDropdown: React.FC<PolicyDropdownProps> = ({
  label,
  options,
  selectedId,
  onChange,
  loading,
  disabled = false,
  error,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const selectedPolicy = options.find((o) => o.id === selectedId);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={`text-xs font-medium uppercase tracking-wide ${
          error ? "text-destructive" : "text-muted-foreground"
        }`}>
          {label}
          {error && <span className="text-destructive ml-1">*</span>}
        </label>
        {selectedPolicy?.description && (
          <button
            type="button"
            onClick={() => setShowTooltip(!showTooltip)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="relative">
        <select
          value={selectedId || ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={loading || disabled || options.length === 0}
          className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
            error
              ? "border-destructive focus:ring-destructive/50"
              : "border-border focus:ring-ring"
          }`}
        >
          <option value="">
            {loading ? "Loading policies..." : "Select a policy"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </div>

      {/* Description tooltip */}
      {showTooltip && selectedPolicy?.description && (
        <div className="bg-muted/70 rounded-lg p-2.5 border border-border text-[11px] text-foreground leading-snug">
          {selectedPolicy.description}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

/**
 * Main eBay Policy Selector Component
 * Integrates all three policy types with consistent UX
 */
export const EbayPolicySelector: React.FC<EbayPolicySelectorProps> = ({
  userToken,
  onPoliciesSelected,
  disabled = false,
  showDetails = false,
  policyErrors = {},
}) => {
  const { policies, selectedPolicies, selectPolicy, loading, error, refreshPolicies, hasPolicies, cacheAge } =
    useEbayPolicies(userToken);

  React.useEffect(() => {
    if (onPoliciesSelected && hasPolicies) {
      onPoliciesSelected(selectedPolicies);
    }
  }, [selectedPolicies, onPoliciesSelected, hasPolicies]);

  if (!userToken) {
    return (
      <div className="bg-accent/30 rounded-lg p-4 border border-accent/50 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-accent-foreground flex-shrink-0 mt-0.5" />
          <div className="text-xs text-accent-foreground">
            <p className="font-medium">eBay account not connected</p>
            <p className="text-[11px] mt-1 opacity-90">Connect your eBay account in Settings to select policies.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 py-6">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your eBay business policies…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg p-4 border space-y-3 ${
        error.type === "NO_POLICIES"
          ? "bg-orange-500/10 border-orange-500/30"
          : "bg-destructive/10 border-destructive/30"
      }`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
            error.type === "NO_POLICIES" ? "text-orange-500" : "text-destructive"
          }`} />
          <div className="flex-1">
            <p className={`text-xs font-medium ${
              error.type === "NO_POLICIES" ? "text-orange-600" : "text-destructive"
            }`}>
              {error.type === "INVALID_TOKEN" ? "Session Expired" : "Policy Loading Error"}
            </p>
            <p className="text-[11px] mt-1 text-muted-foreground">{error.message}</p>
            <div className="flex gap-2 mt-2.5">
              {error.type === "INVALID_TOKEN" && (
                <a
                  href="/settings?tab=integrations"
                  className="text-[11px] text-primary hover:underline font-medium"
                >
                  Reconnect eBay
                </a>
              )}
              {error.type === "NO_POLICIES" && (
                <a
                  href="https://www.ebay.com/sh/ovw/policies"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline font-medium"
                >
                  Create Policies in Seller Hub
                </a>
              )}
              <button
                onClick={refreshPolicies}
                className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
              >
                <RefreshCw className="w-2.5 h-2.5" /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasPolicies) {
    return (
      <div className="bg-secondary/50 rounded-lg p-4 border border-border space-y-2 text-center">
        <p className="text-xs font-medium text-foreground">No policies configured</p>
        <p className="text-[11px] text-muted-foreground">
          Create business policies in your eBay Seller Hub before publishing listings.
        </p>
        <a
          href="https://www.ebay.com/sh/ovw/policies"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium mt-2"
        >
          Open eBay Seller Hub
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Fulfillment Policy Dropdown */}
        <PolicyDropdown
          label="Shipping Policy"
          options={policies.fulfillment.map((p) => ({
            id: p.fulfillmentPolicyId,
            name: p.name,
            description: p.description,
          }))}
          selectedId={selectedPolicies.fulfillmentPolicyId}
          onChange={(id) => selectPolicy("fulfillmentPolicyId", id)}
          loading={loading}
          disabled={disabled}
          error={policyErrors.fulfillmentPolicyId}
        />

        {/* Payment Policy Dropdown */}
        <PolicyDropdown
          label="Payment Policy"
          options={policies.payment.map((p) => ({
            id: p.paymentPolicyId,
            name: p.name,
            description: p.description,
          }))}
          selectedId={selectedPolicies.paymentPolicyId}
          onChange={(id) => selectPolicy("paymentPolicyId", id)}
          loading={loading}
          disabled={disabled}
          error={policyErrors.paymentPolicyId}
        />

        {/* Return Policy Dropdown */}
        <PolicyDropdown
          label="Return Policy"
          options={policies.return.map((p) => ({
            id: p.returnPolicyId,
            name: p.name,
            description: p.description,
          }))}
          selectedId={selectedPolicies.returnPolicyId}
          onChange={(id) => selectPolicy("returnPolicyId", id)}
          loading={loading}
          disabled={disabled}
          error={policyErrors.returnPolicyId}
        />
      </div>

      {/* Detailed Policy Info (optional expanded view) */}
      {showDetails && (
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
          {selectedPolicies.fulfillmentPolicyId && (
            <PolicyDetailCard
              policy={policies.fulfillment.find((p) => p.fulfillmentPolicyId === selectedPolicies.fulfillmentPolicyId)}
              type="Shipping"
            />
          )}
          {selectedPolicies.paymentPolicyId && (
            <PolicyDetailCard
              policy={policies.payment.find((p) => p.paymentPolicyId === selectedPolicies.paymentPolicyId)}
              type="Payment"
            />
          )}
          {selectedPolicies.returnPolicyId && (
            <PolicyDetailCard
              policy={policies.return.find((p) => p.returnPolicyId === selectedPolicies.returnPolicyId)}
              type="Return"
            />
          )}
        </div>
      )}

      {/* Cache status and refresh button */}
      <div className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          Cached {formatCacheAge(cacheAge)}
        </p>
        <button
          onClick={refreshPolicies}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Force refresh policies from eBay"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Selection summary */}
      <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg p-2.5">
        ✓ Policies selected for listing. These will be applied when you publish.
      </div>
    </div>
  );
};

/**
 * Detail card showing expanded policy information
 */
interface PolicyDetailCardProps {
  policy?: EbayFulfillmentPolicy | EbayPaymentPolicy | EbayReturnPolicy;
  type: "Shipping" | "Payment" | "Return";
}

const PolicyDetailCard: React.FC<PolicyDetailCardProps> = ({ policy, type }) => {
  if (!policy) return null;

  return (
    <div className="rounded-lg bg-muted/50 p-2.5 space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground uppercase">{type}</p>
      <p className="text-xs font-medium text-foreground line-clamp-2">{policy.name}</p>
      {policy.description && (
        <p className="text-[10px] text-muted-foreground line-clamp-2">{policy.description}</p>
      )}
    </div>
  );
};
