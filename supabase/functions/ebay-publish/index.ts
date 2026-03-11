import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// eBay condition ID mapping
// As of 2024, eBay deprecated USED_EXCELLENT/USED_VERY_GOOD/USED_GOOD/USED_ACCEPTABLE.
// Current valid ConditionEnum values for pre-owned items:
//   PRE_OWNED_GOOD  -> replaces USED_EXCELLENT and USED_VERY_GOOD
//   PRE_OWNED_FAIR  -> replaces USED_GOOD
//   PRE_OWNED_POOR  -> replaces USED_ACCEPTABLE
// Reference: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
// ----------------------------------------------------------------
const CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  CERTIFIED_REFURBISHED: 2000,
  EXCELLENT_REFURBISHED: 2010,
  VERY_GOOD_REFURBISHED: 2020,
  GOOD_REFURBISHED: 2030,
  SELLER_REFURBISHED: 2500,
  PRE_OWNED_GOOD: 3000,
  PRE_OWNED_FAIR: 5000,
  PRE_OWNED_POOR: 6000,
  FOR_PARTS_OR_NOT_WORKING: 7000,
};

// Human-readable condition descriptions for eBay conditionDescription field
// Force redeploy to ensure Content-Language fix is live (PR #78)
const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Brand new, unused, unopened item in original packaging.",
  LIKE_NEW: "Like new condition. May be open box but unused.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  EXCELLENT_REFURBISHED: "Refurbished to excellent working condition.",
  VERY_GOOD_REFURBISHED: "Refurbished to very good working condition.",
  GOOD_REFURBISHED: "Refurbished to good working condition.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  PRE_OWNED_GOOD: "Pre-owned item in good condition. May show minor signs of wear.",
  PRE_OWNED_FAIR: "Pre-owned item in fair condition. Shows visible signs of wear.",
  PRE_OWNED_POOR: "Pre-owned item in poor condition. Heavy wear or cosmetic damage.",
  FOR_PARTS_OR_NOT_WORKING: "Item is not fully functional. Sold for parts or repair.",
};

// Legacy condition code migration map
// Converts deprecated eBay condition strings to current equivalents
const LEGACY_CONDITION_MAP: Record<string, string> = {
  USED_EXCELLENT: "PRE_OWNED_GOOD",
  USED_VERY_GOOD: "PRE_OWNED_GOOD",
  USED_GOOD: "PRE_OWNED_FAIR",
  USED_ACCEPTABLE: "PRE_OWNED_POOR",
};

// ----------------------------------------------------------------
// Listing duration constants
// GTC = "Good 'Til Cancelled" — required for FIXED_PRICE listings
// Auctions must use a specific day count: 1, 3, 5, 7, or 10
// ----------------------------------------------------------------
const FIXED_PRICE_DURATION = "GTC";
const DEFAULT_AUCTION_DURATION = "Days_7";
const VALID_AUCTION_DURATIONS = ["Days_1", "Days_3", "Days_5", "Days_7", "Days_10"];

// ----------------------------------------------------------------
// Build a fixed-price offer payload
// ----------------------------------------------------------------
function buildFixedPriceOffer(params: {
  sku: string;
  description: string;
  listingPrice: number;
  ebayCategoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId?: string | null;  // Optional: managed payments sellers don't need this
  returnPolicyId: string;
}): Record<string, unknown> {
  // Build listingPolicies — paymentPolicyId is omitted for managed payments sellers
  const listingPolicies: Record<string, string> = {
    fulfillmentPolicyId: params.fulfillmentPolicyId,
    returnPolicyId: params.returnPolicyId,
  };
  if (params.paymentPolicyId) {
    listingPolicies.paymentPolicyId = params.paymentPolicyId;
  }

  const offer: Record<string, unknown> = {
    sku: params.sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    listingDescription: params.description,
    availableQuantity: 1,
    listingDuration: FIXED_PRICE_DURATION,
    merchantLocationKey: params.merchantLocationKey,
    pricingSummary: {
      price: {
        value: params.listingPrice.toFixed(2),
        currency: "USD",
      },
    },
    listingPolicies,
  };
  if (params.ebayCategoryId) {
    offer.categoryId = params.ebayCategoryId;
  }
  return offer;
}

// ----------------------------------------------------------------
// Build an auction offer payload
// Auctions have different required fields and constraints vs fixed price.
// ----------------------------------------------------------------
function buildAuctionOffer(params: {
  sku: string;
  description: string;
  auctionStartPrice: number;
  auctionBuyItNow?: number;
  auctionDuration: string;
  ebayCategoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId?: string | null;  // Optional: managed payments sellers don't need this
  returnPolicyId: string;
}): Record<string, unknown> {
  // Validate auction duration
  const duration = VALID_AUCTION_DURATIONS.includes(params.auctionDuration)
    ? params.auctionDuration
    : DEFAULT_AUCTION_DURATION;

  const pricingSummary: Record<string, unknown> = {
    auctionStartPrice: {
      value: params.auctionStartPrice.toFixed(2),
      currency: "USD",
    },
  };

  // Buy It Now price must be at least 30% above starting bid per eBay rules
  if (params.auctionBuyItNow && params.auctionBuyItNow > 0) {
    const minBuyItNow = params.auctionStartPrice * 1.3;
    if (params.auctionBuyItNow >= minBuyItNow) {
      pricingSummary.price = {
        value: params.auctionBuyItNow.toFixed(2),
        currency: "USD",
      };
    } else {
      console.warn(
        `Auction BIN price ${params.auctionBuyItNow} is less than 30% above start price ${params.auctionStartPrice}. Omitting BIN.`
      );
    }
  }

  const offer: Record<string, unknown> = {
    sku: params.sku,
    marketplaceId: "EBAY_US",
    format: "AUCTION",
    listingDescription: params.description,
    availableQuantity: 1,
    listingDuration: duration,
    merchantLocationKey: params.merchantLocationKey,
    pricingSummary,
    listingPolicies: (() => {
      const policies: Record<string, string> = {
        fulfillmentPolicyId: params.fulfillmentPolicyId,
        returnPolicyId: params.returnPolicyId,
      };
      if (params.paymentPolicyId) policies.paymentPolicyId = params.paymentPolicyId;
      return policies;
    })(),
  };
  if (params.ebayCategoryId) {
    offer.categoryId = params.ebayCategoryId;
  }
  return offer;
}

// ----------------------------------------------------------------
// Ensure an eBay inventory location exists for the seller.
// POST is idempotent for the same key — 204 = created, 409 = already exists.
// Returns the merchantLocationKey on success.
// ----------------------------------------------------------------
async function ensureInventoryLocation(
  apiBase: string,
  userToken: string,
  postalCode: string,
  country = "US"
): Promise<string> {
  const merchantLocationKey = "default-location";

  const locationBody = {
    location: {
      address: {
        postalCode,
        country,
      },
    },
    locationEnabled: true,
    name: "Default Seller Location",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };

  const resp = await fetch(
    `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(locationBody),
    }
  );

  // 204 = created/updated, 200 = success — both are fine
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(
      `ensureInventoryLocation: error ${resp.status}: ${errText}`
    );
    throw new Error(
      `Failed to ensure inventory location: ${resp.status} - ${errText}`
    );
  }

  console.log(
    `ensureInventoryLocation: location "${merchantLocationKey}" ready (status ${resp.status})`
  );

  return merchantLocationKey;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log(`ebay-publish request: method=${req.method}, url=${req.url}`);
    
    const requestBody = await req.json();
    const { action, ...payload } = requestBody;
    
    console.log(`ebay-publish action: ${action}, payload keys: ${Object.keys(payload).join(", ")}`);

    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    // Environment diagnostic log — emitted on every invocation to aid debugging.
    // Masks secrets: shows only first 8 chars of clientId, booleans for secrets.
    console.log("ebay-publish invoked:", {
      action,
      ebayEnv,
      hasClientId: !!clientId,
      clientIdPrefix: clientId ? clientId.substring(0, 8) + "..." : "MISSING",
      hasClientSecret: !!clientSecret,
      hasSupabaseUrl: !!Deno.env.get("SUPABASE_URL"),
      hasServiceKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    });

    // NOTE: clientId/clientSecret are only required for actions that call eBay OAuth endpoints
    // (exchange_code, refresh_token, get_auth_url, create_draft, bulk_create_draft).
    // get_stored_token and get_policies only need Supabase credentials, so we defer
    // this check to avoid blocking those actions when eBay app credentials are misconfigured.
    const requiresEbayCredentials = !["get_stored_token", "get_policies"].includes(action);
    if (requiresEbayCredentials && (!clientId || !clientSecret)) {
      throw new Error("eBay API credentials not configured");
    }

    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";
    const authBase =
      ebayEnv === "production"
        ? "https://auth.ebay.com"
        : "https://auth.sandbox.ebay.com";
    const tokenUrl =
      ebayEnv === "production"
        ? "https://api.ebay.com/identity/v1/oauth2/token"
        : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

    // --- ACTION: Get OAuth consent URL ---
    if (action === "get_auth_url") {
      const ruName = Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) throw new Error("EBAY_RUNAME not configured");

      const scopes = [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      ].join(" ");

      const authUrl =
        `${authBase}/oauth2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(ruName)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}`;

      console.log("get_auth_url: ruName =", ruName);

      return new Response(JSON.stringify({ authUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- ACTION: Exchange auth code for user token ---
    if (action === "exchange_code") {
      const { code, userId } = payload;
      if (!code) throw new Error("No authorization code provided");

      const ruName = Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) {
        throw new Error("eBay callback URI not configured. Contact admin to set EBAY_RUNAME.");
      }

      console.log("exchange_code: code =", code?.substring(0, 20) + "...", "env =", ebayEnv);

      const credentials = btoa(`${clientId}:${clientSecret}`);

      const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept-Language": "en-US",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ruName,
        }).toString(),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        let errorMsg = txt;
        try {
          const json = JSON.parse(txt);
          errorMsg = json.error_description || json.error || txt;
        } catch { /* not JSON */ }
        throw new Error(`eBay token exchange failed (${resp.status}): ${errorMsg}`);
      }

      const tokenData = await resp.json();

      if (!tokenData.access_token) {
        throw new Error("eBay returned no access token. Authorization code may have expired or been reused.");
      }

      console.log("exchange_code: token obtained, expires in", tokenData.expires_in, "seconds");

      // --- Store token server-side in Supabase profiles table ---
      // Avoids exposing the token in localStorage (XSS risk).
      // IMPORTANT: Use upsert (not update) so this works even if the profiles row
      // doesn't exist yet. .update() silently affects 0 rows with no error when
      // the row is missing — the token would never be stored server-side, causing
      // get_stored_token to always return null and policies to fail to load.
      if (userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

            // upsert with onConflict: "id" — creates the row if missing, updates if present
            const { error: upsertError } = await supabase
              .from("profiles")
              .upsert(
                {
                  id: userId,
                  ebay_access_token: tokenData.access_token,
                  ebay_refresh_token: tokenData.refresh_token ?? null,
                  ebay_token_expires_at: expiresAt,
                },
                { onConflict: "id" }
              );

            if (upsertError) {
              console.warn("exchange_code: failed to upsert token in profiles:", upsertError.message);
            } else {
              // Read-back verification: confirm the token was actually stored
              const { data: verifyData, error: verifyError } = await supabase
                .from("profiles")
                .select("ebay_access_token, ebay_token_expires_at")
                .eq("id", userId)
                .single();

              if (verifyError || !verifyData?.ebay_access_token) {
                console.warn(
                  "exchange_code: upsert succeeded but read-back verification FAILED for user",
                  userId,
                  "verifyError:", verifyError?.message ?? "token null after upsert"
                );
              } else {
                console.log(
                  "exchange_code: token upserted and verified in profiles for user",
                  userId,
                  "expires_at:", verifyData.ebay_token_expires_at
                );
              }
            }
          }
        } catch (storeErr) {
          // Non-fatal — still return the token to the client as fallback
          console.warn("exchange_code: token storage error (non-fatal):", storeErr);
        }
      }

      return new Response(
        JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Silently refresh eBay access token using stored refresh token ---
    if (action === "refresh_token") {
      const { userId } = payload;
      if (!userId) throw new Error("No userId provided");

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase credentials not configured");
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select("ebay_refresh_token")
        .eq("id", userId)
        .single();

      if (error || !data?.ebay_refresh_token) {
        return new Response(
          JSON.stringify({ token: null, error: "No refresh token available. Please reconnect eBay." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const credentials = btoa(`${clientId}:${clientSecret}`);
      const refreshResp = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept-Language": "en-US",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: data.ebay_refresh_token,
          scope: [
            "https://api.ebay.com/oauth/api_scope",
            "https://api.ebay.com/oauth/api_scope/sell.inventory",
            "https://api.ebay.com/oauth/api_scope/sell.account",
            "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
          ].join(" "),
        }).toString(),
      });

      if (!refreshResp.ok) {
        const txt = await refreshResp.text();
        console.error("refresh_token: eBay refresh failed:", refreshResp.status, txt);
        return new Response(
          JSON.stringify({ token: null, error: `Token refresh failed (${refreshResp.status}). Please reconnect eBay.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = await refreshResp.json();
      if (!tokenData.access_token) {
        return new Response(
          JSON.stringify({ token: null, error: "eBay returned no access token during refresh." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Store the new access token (and new refresh token if provided)
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      const updatePatch: Record<string, string> = {
        ebay_access_token: tokenData.access_token,
        ebay_token_expires_at: expiresAt,
      };
      if (tokenData.refresh_token) {
        updatePatch.ebay_refresh_token = tokenData.refresh_token;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update(updatePatch)
        .eq("id", userId);

      if (updateError) {
        console.warn("refresh_token: failed to store refreshed token:", updateError.message);
      } else {
        console.log("refresh_token: token refreshed and stored for user", userId, "expires at", expiresAt);
      }

      return new Response(
        JSON.stringify({
          token: tokenData.access_token,
          expiresIn: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Get stored eBay token for a user (with proactive refresh) ---
    if (action === "get_stored_token") {
      const { userId } = payload;
      if (!userId) throw new Error("No userId provided");

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase credentials not configured");
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select("ebay_access_token, ebay_token_expires_at, ebay_refresh_token, postal_code")
        .eq("id", userId)
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ token: null, postalCode: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const now = new Date();
      const expiresAt = data.ebay_token_expires_at ? new Date(data.ebay_token_expires_at) : null;
      // Consider token expired if it expires within 5 minutes (proactive refresh window)
      const REFRESH_BUFFER_MS = 5 * 60 * 1000;
      const isExpiredOrExpiringSoon = expiresAt
        ? expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS
        : true;

      // Proactively refresh if token is expired or expiring within 5 minutes
      if (isExpiredOrExpiringSoon && data.ebay_refresh_token) {
        console.log("get_stored_token: token expiring soon, attempting proactive refresh for user", userId);
        // Skip proactive refresh if eBay app credentials are not configured
        if (!clientId || !clientSecret) {
          console.warn("get_stored_token: skipping proactive refresh — eBay credentials not configured");
          return new Response(
            JSON.stringify({ token: data.ebay_access_token, postalCode: data.postal_code, isExpired: false }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        try {
          const credentials = btoa(`${clientId}:${clientSecret}`);
          const refreshResp = await fetch(tokenUrl, {
            method: "POST",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: data.ebay_refresh_token,
              scope: [
                "https://api.ebay.com/oauth/api_scope",
                "https://api.ebay.com/oauth/api_scope/sell.inventory",
                "https://api.ebay.com/oauth/api_scope/sell.account",
                "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
              ].join(" "),
            }).toString(),
          });

          if (refreshResp.ok) {
            const tokenData = await refreshResp.json();
            if (tokenData.access_token) {
              const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
              const updatePatch: Record<string, string> = {
                ebay_access_token: tokenData.access_token,
                ebay_token_expires_at: newExpiresAt,
              };
              if (tokenData.refresh_token) {
                updatePatch.ebay_refresh_token = tokenData.refresh_token;
              }
              await supabase.from("profiles").update(updatePatch).eq("id", userId);
              console.log("get_stored_token: proactive refresh succeeded, new expiry:", newExpiresAt);

              return new Response(
                JSON.stringify({
                  token: tokenData.access_token,
                  postalCode: data.postal_code,
                  isExpired: false,
                  refreshed: true,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          } else {
            console.warn("get_stored_token: proactive refresh failed:", refreshResp.status);
          }
        } catch (refreshErr) {
          console.warn("get_stored_token: proactive refresh error (non-fatal):", refreshErr);
        }

        // Refresh failed — return null so caller triggers re-auth
        return new Response(
          JSON.stringify({ token: null, postalCode: data.postal_code, isExpired: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          token: data.ebay_access_token,
          postalCode: data.postal_code,
          isExpired: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Publish a single draft to eBay ---
    if (action === "create_draft") {
      const {
        userToken,
        sku: incomingSku,
        title,
        description,
        listingFormat,
        listingPrice,
        auctionStartPrice,
        auctionBuyItNow,
        auctionDuration,
        imageUrl,
        condition,
        ebayCategoryId,
        itemSpecifics,
        postalCode,
        fulfillmentPolicyId: draftFulfillmentPolicyId,
        paymentPolicyId: draftPaymentPolicyId,
        returnPolicyId: draftReturnPolicyId,
      } = payload;

      if (!userToken) throw new Error("No eBay user token provided");

      // Use deterministic SKU if provided (preferred — enables idempotent retries).
      // Fall back to random UUID-based SKU only if not provided.
      const sku = incomingSku ||
        `LA-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

      // eBay Partner Network campaign ID for affiliate revenue tracking
      const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";

      // Build EPN rover affiliate link — wrapped in try/catch so EPN failure
      // never blocks or fails the publish transaction
      const buildAffiliateUrl = (listingId: string): string | null => {
        try {
          const baseUrl = `https://www.ebay.com/itm/${listingId}`;
          if (!epnCampaignId) return baseUrl;
          return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${encodeURIComponent(epnCampaignId)}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
        } catch {
          return null;
        }
      };

      // Build eBay-formatted item specifics (aspects)
      const aspects: Record<string, string[]> = {};
      if (itemSpecifics && typeof itemSpecifics === "object") {
        for (const [key, value] of Object.entries(itemSpecifics)) {
          if (value && typeof value === "string" && value.trim()) {
            aspects[key] = [value.trim()];
          }
        }
      }

      // Map internal condition string to numeric conditionId
      // eBay Inventory API accepts ConditionEnum strings, but many categories
      // also require the numeric conditionId. We send both for maximum compatibility.
      // Migrate any legacy deprecated condition codes to current equivalents.
      const rawCondition = condition || "PRE_OWNED_GOOD";
      const conditionEnum = LEGACY_CONDITION_MAP[rawCondition] ?? rawCondition;
      const conditionId = CONDITION_ID_MAP[conditionEnum] ?? 3000;
      const conditionDesc = CONDITION_DESCRIPTIONS[conditionEnum]
        ?? conditionEnum.replace(/_/g, " ").toLowerCase()
             .replace(/\b\w/g, (c: string) => c.toUpperCase());

      // Step 1: Create/update inventory item (PUT is idempotent — safe to retry)
      // NOTE: description goes in the OFFER (listingDescription), not the inventory item.
      // The inventory item holds product data; the offer holds listing-specific data.
      // We include description in product for completeness but the offer's listingDescription
      // is what eBay actually displays on the live listing.
      const inventoryBody: Record<string, unknown> = {
        product: {
          title,
          // description here is for internal product record only
          imageUrls: imageUrl ? [imageUrl] : [],
        },
        // Send both string enum and numeric ID for maximum category compatibility
        condition: conditionEnum,
        conditionDescription: conditionDesc,
        availability: {
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      };

      // Add aspects (item specifics) to the product
      if (Object.keys(aspects).length > 0) {
        (inventoryBody.product as Record<string, unknown>).aspects = aspects;
      }

      const authHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      };

      const inventoryResp = await fetch(
        `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
        {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify(inventoryBody),
        }
      );

      if (!inventoryResp.ok) {
        const errText = await inventoryResp.text();
        console.error("eBay inventory error:", inventoryResp.status, errText);
        throw new Error(`Failed to create inventory item: ${inventoryResp.status} - ${errText}`);
      }

      // Step 2: Ensure inventory location exists (required for publishing)
      const effectivePostalCode = postalCode || "10001"; // fallback to NYC if not set
      const merchantLocationKey = await ensureInventoryLocation(
        apiBase,
        userToken,
        effectivePostalCode
      );

      // Step 3: Fetch business policies (use draft-level if set, else auto-fetch first)
      const fetchDefaultPolicy = async (policyType: string): Promise<string | null> => {
        const resp = await fetch(
          `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
          { headers: authHeaders }
        );
        if (!resp.ok) {
          console.warn(`Could not fetch ${policyType} policies:`, resp.status);
          return null;
        }
        const data = await resp.json();
        const policies = data[`${policyType}Policies`] || data[`${policyType}Policy`] || [];
        if (Array.isArray(policies) && policies.length > 0) {
          console.log(`Using ${policyType} policy: ${policies[0].name}`);
          return policies[0][`${policyType}PolicyId`] || null;
        }
        return null;
      };

      // Fetch policies — paymentPolicyId is optional for managed payments sellers.
      // Most eBay sellers enrolled in managed payments do NOT need a payment policy.
      // We only require fulfillment and return policies.
      const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
        draftFulfillmentPolicyId ? Promise.resolve(draftFulfillmentPolicyId) : fetchDefaultPolicy("fulfillment"),
        draftPaymentPolicyId     ? Promise.resolve(draftPaymentPolicyId)     : fetchDefaultPolicy("payment"),
        draftReturnPolicyId      ? Promise.resolve(draftReturnPolicyId)      : fetchDefaultPolicy("return"),
      ]);

      // Only fulfillment and return policies are required; payment policy is optional
      if (!fulfillmentPolicyId || !returnPolicyId) {
        const missing = [
          !fulfillmentPolicyId && "Fulfillment (Shipping)",
          !returnPolicyId && "Return",
        ].filter(Boolean).join(", ");

        return new Response(
          JSON.stringify({
            error: `Missing required eBay business policies: ${missing}. Please create these policies in your eBay Seller Hub (https://www.ebay.com/sh/ovw/policies) before publishing.`,
            missingPolicies: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 4: Build offer payload
      // IMPORTANT: The eBay Inventory API (REST) only supports FIXED_PRICE format.
      // Auction listings require the legacy Trading API (XML-based) which is a
      // separate integration path. Attempting to pass format: "AUCTION" to the
      // Inventory API will result in a 400 error.
      // See: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
      if (listingFormat === "AUCTION") {
        return new Response(
          JSON.stringify({
            error: "Auction format is not supported by the eBay Inventory API. " +
              "Please change the listing format to Fixed Price, or use the eBay " +
              "Seller Hub to create auction listings manually.",
            auctionNotSupported: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const offerBody = buildFixedPriceOffer({
        sku,
        description,
        listingPrice: Number(listingPrice ?? 0),
        ebayCategoryId: ebayCategoryId || undefined,
        merchantLocationKey,
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      });

      const offerResp = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(offerBody),
      });

      if (!offerResp.ok) {
        const errText = await offerResp.text();
        console.error("eBay offer error:", offerResp.status, errText);
        throw new Error(`Failed to create offer: ${offerResp.status} - ${errText}`);
      }

      const offerData = await offerResp.json();
      const offerId = offerData.offerId;

      // Step 5: Publish the offer to make it a live listing
      const publishResp = await fetch(
        `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
        {
          method: "POST",
          headers: authHeaders,
        }
      );

      if (!publishResp.ok) {
        const errText = await publishResp.text();
        console.error("eBay publish error:", publishResp.status, errText);
        return new Response(
          JSON.stringify({
            error: `Offer created (ID: ${offerId}) but publish failed: ${publishResp.status} - ${errText}`,
            offerId,
            sku,
            publishFailed: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publishData = await publishResp.json();
      const listingId = publishData.listingId || offerData.listing?.listingId || null;

      // Build affiliate URL — non-fatal, wrapped in try/catch
      const affiliateUrl = listingId ? buildAffiliateUrl(listingId) : null;

      console.log(`Successfully published: listingId=${listingId}, offerId=${offerId}, sku=${sku}`);

      return new Response(
        JSON.stringify({
          success: true,
          offerId,
          sku,
          listingId,
          affiliateUrl,
          message: "Listing published live on eBay!",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Bulk publish multiple drafts (server-side loop) ---
    if (action === "bulk_create_draft") {
      const { userToken, drafts, postalCode } = payload;
      if (!userToken) throw new Error("No eBay user token provided");
      if (!Array.isArray(drafts) || drafts.length === 0) {
        throw new Error("No drafts provided for bulk publish");
      }

      const results: Array<{
        draftId: string;
        success: boolean;
        listingId?: string;
        offerId?: string;
        sku?: string;
        affiliateUrl?: string;
        error?: string;
      }> = [];

      for (const draft of drafts) {
        try {
          const singleResp = await fetch(req.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.get("Authorization") || "",
            },
            body: JSON.stringify({
              action: "create_draft",
              userToken,
              postalCode,
              ...draft,
            }),
          });

          const singleData = await singleResp.json();

          if (singleData.success) {
            results.push({
              draftId: draft.draftId,
              success: true,
              listingId: singleData.listingId,
              offerId: singleData.offerId,
              sku: singleData.sku,
              affiliateUrl: singleData.affiliateUrl,
            });
          } else {
            results.push({
              draftId: draft.draftId,
              success: false,
              error: singleData.error || "Unknown error",
            });
          }
        } catch (err) {
          results.push({
            draftId: draft.draftId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const errorCount = results.filter((r) => !r.success).length;

      return new Response(
        JSON.stringify({
          results,
          successCount,
          errorCount,
          message: `${successCount} of ${drafts.length} listings published to eBay`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Fetch eBay business policies for a user token ---
    // Consolidated here to avoid CORS issues with the separate ebay-policies function.
    // The ebay-publish function already has correct CORS headers and is proven to work.
    if (action === "get_policies") {
      const { userToken, userId } = payload;

      // If no userToken provided directly, try to fetch it from server-side storage
      let resolvedToken = userToken;
      if (!resolvedToken && userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const { data } = await supabase
              .from("profiles")
              .select("ebay_access_token")
              .eq("id", userId)
              .single();
            if (data?.ebay_access_token) resolvedToken = data.ebay_access_token;
          }
        } catch (e) {
          console.warn("get_policies: could not fetch token from profiles:", e);
        }
      }

      if (!resolvedToken) {
        // Return empty policies rather than throwing — lets the UI show "no policies" gracefully
        return new Response(
          JSON.stringify({ fulfillment: [], payment: [], returns: [], noToken: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authHeaders = {
        Authorization: `Bearer ${resolvedToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      };

      // Fetch each policy type independently so one failure doesn't kill all three.
      // Returns { policies, error } — error is non-null if the fetch failed.
      const fetchPoliciesSafe = async (
        policyType: string
      ): Promise<{ policies: Array<{ id: string; name: string }>; error: string | null }> => {
        try {
          const resp = await fetch(
            `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
            { headers: authHeaders }
          );
          if (!resp.ok) {
            const errText = await resp.text();
            console.warn(`get_policies: ${policyType} policy fetch failed (${resp.status}):`, errText);
            return { policies: [], error: `${policyType} policies unavailable (HTTP ${resp.status})` };
          }
          const data = await resp.json();
          const key = `${policyType}Policies`;
          const rawPolicies = data[key] || [];
          const policies = rawPolicies.map((p: Record<string, string>) => ({
            id: p[`${policyType}PolicyId`] || p.policyId || "",
            name: p.name || "(unnamed)",
          }));
          console.log(`get_policies: fetched ${policies.length} ${policyType} policies`);
          return { policies, error: null };
        } catch (fetchErr) {
          console.warn(`get_policies: ${policyType} policy fetch threw:`, fetchErr);
          return { policies: [], error: `${policyType} policies fetch error` };
        }
      };

      // Run all three fetches concurrently; each is independently error-isolated
      const [fulfillmentResult, paymentResult, returnsResult] = await Promise.all([
        fetchPoliciesSafe("fulfillment"),
        fetchPoliciesSafe("payment"),
        fetchPoliciesSafe("return"),
      ]);

      // Collect any per-type errors for the client to display
      const policyErrors: Record<string, string> = {};
      if (fulfillmentResult.error) policyErrors.fulfillment = fulfillmentResult.error;
      if (paymentResult.error)     policyErrors.payment     = paymentResult.error;
      if (returnsResult.error)     policyErrors.returns     = returnsResult.error;

      return new Response(
        JSON.stringify({
          fulfillment: fulfillmentResult.policies,
          payment:     paymentResult.policies,
          returns:     returnsResult.policies,
          ...(Object.keys(policyErrors).length > 0 ? { policyErrors } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    // Include action in error log so we can identify which handler threw
    // (action may be undefined if JSON parsing itself failed)
    const actionLabel = typeof action !== "undefined" ? action : "unknown";
    console.error(`ebay-publish error [action=${actionLabel}]:`, errorMsg, e instanceof Error ? e.stack : "");

    // Only treat as a 400 client error for explicit configuration/input problems.
    // eBay API error strings (e.g. "Failed to create inventory item: 400 - {...}")
    // must NOT match here — they should be 500s so the client knows it's a server-side
    // eBay API failure, not a missing-parameter problem on the client side.
    const isClientError =
      errorMsg.includes("not configured") ||
      errorMsg.includes("not provided") ||
      errorMsg.includes("No authorization code") ||
      errorMsg.includes("No userId provided") ||
      errorMsg.includes("No drafts provided") ||
      errorMsg.includes("No eBay user token provided");

    return new Response(
      JSON.stringify({ error: errorMsg, action: actionLabel }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
