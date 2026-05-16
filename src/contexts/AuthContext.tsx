import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// ─── 4-Tier Plan Configuration ─────────────────────────────────────────────
// Stripe product/price IDs — update starter/pro TODOs if IDs change.
export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    publishLimit: 6,
    analysisLimit: 6,
    hasAiEnhancement: false,
    hasVoiceNotes: false,
    hasMeltProtection: false,
    hasListingAnalytics: false,
    hasOrgFeature: false,
    hasCogsTra cking: false,
  },
  starter: {
    name: "Starter",
    price: 19,
    publishLimit: 25,
    analysisLimit: 25,
    priceId: "price_1T8lVU4bX0d1SiThMDayhDj5",   // TODO: confirm or replace
    productId: "prod_U6zUiC1SYuPrGU",              // TODO: confirm or replace
    hasAiEnhancement: true,   // basic AI enhancement
    hasVoiceNotes: false,
    hasMeltProtection: false,
    hasListingAnalytics: false,
    hasOrgFeature: false,
    hasCogsTra cking: false,
  },
  pro: {
    name: "Pro",
    price: 49,
    publishLimit: 200,
    analysisLimit: 200,
    priceId: "price_1T8mZ84bX0d1SiThFgvRubiN",    // TODO: confirm or replace
    productId: "prod_U70aT1KvuI2uDx",              // TODO: confirm or replace
    hasAiEnhancement: true,   // full AI enhancement
    hasVoiceNotes: true,
    hasMeltProtection: true,
    hasListingAnalytics: true,
    hasOrgFeature: false,
    hasCogsTra cking: true,    // COGS tracking + Profit Report
  },
  shop: {
    name: "Shop",
    price: 99,
    publishLimit: 1200,       // soft threshold
    analysisLimit: 1200,      // soft threshold
    priceId: "price_1TXYjd4bX0d1SiThDb4YQhjR",
    productId: "prod_UWbxnGJYfqTrLz",
    hasAiEnhancement: true,   // full AI enhancement
    hasVoiceNotes: true,
    hasMeltProtection: true,
    hasListingAnalytics: true,
    hasOrgFeature: true,
    hasCogsTra cking: true,    // COGS tracking + Profit Report
  },
} as const;
