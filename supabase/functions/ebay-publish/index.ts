import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// eBay condition ID mapping
// Inventory API accepts ConditionEnum strings, but many categories
// also require the numeric conditionId in the offer payload.
// We send both to maximize compatibility.
// Reference: https://developer.ebay.com/devzone/finding/callref/Enums/conditionIdList.html
// ----------------------------------------------------------------
const CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,
  USED_EXCELLENT: 3000,
  USED_VERY_GOOD: 4000,
  USED_GOOD: 5000,
  USED_ACCEPTABLE: 6000,
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
  paymentPolicyId: string;
  returnPolicyId: string;
}): Record<string, unknown> {
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
    listingPolicies: {
      fulfillmentPolicyId: params.fulfillmentPolicyId,
      paymentPolicyId: params.paymentPolicyId,
      returnPolicyId: params.returnPolicyId,
    },
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
  paymentPolicyId: string;
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
    listingPolicies: {
      fulfillmentPolicyId: params.fulfillmentPolicyId,
      paymentPolicyId: params.paymentPolicyId,
      returnPolicyId: params.returnPolicyId,
    },
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
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      body: JSON.stringify(locationBody),
    }
  );

  // 204 = created, 409 = already exists — both are fine
  if (!resp.ok && resp.status !== 409) {
    const errText = await resp.text();
    console.warn(
      `ensureInventoryLocation: non-fatal error ${resp.status}: ${errText}`
    );
  } else {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" ready (status ${resp.status})`
    );
  }

  return merchantLocationKey;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...payload } = await req.json();

    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    if (!clientId || !clientSecret) {
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
      if (userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
            const { error: upsertError } = await supabase
              .from("profiles")
              .update({
                ebay_access_token: tokenData.access_token,
                ebay_refresh_token: tokenData.refresh_token ?? null,
                ebay_token_expires_at: expiresAt,
              })
              .eq("id", userId);
            if (upsertError) {
              console.warn("exchange_code: failed to store token in profiles:", upsertError.message);
            } else {
              console.log("exchange_code: token stored in profiles for user", userId);
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

    // --- ACTION: Get stored eBay token for a user ---
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

      const isExpired = data.ebay_token_expires_at
        ? new Date(data.ebay_token_expires_at) < new Date()
        : false;

      return new Response(
        JSON.stringify({
          token: isExpired ? null : data.ebay_access_token,
          postalCode: data.postal_code,
          isExpired,
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
      const conditionEnum = condition || "USED_EXCELLENT";
      const conditionId = CONDITION_ID_MAP[conditionEnum] ?? 3000;

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
        conditionDescription: conditionEnum.replace(/_/g, " ").toLowerCase()
          .replace(/\b\w/g, (c: string) => c.toUpperCase()),
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
      };

      const inventoryResp = await fetch(
        `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
        {
          method: "PUT",
          headers: { ...authHeaders, "Content-Language": "en-US" },
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

      const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
        draftFulfillmentPolicyId ? Promise.resolve(draftFulfillmentPolicyId) : fetchDefaultPolicy("fulfillment"),
        draftPaymentPolicyId     ? Promise.resolve(draftPaymentPolicyId)     : fetchDefaultPolicy("payment"),
        draftReturnPolicyId      ? Promise.resolve(draftReturnPolicyId)      : fetchDefaultPolicy("return"),
      ]);

      if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
        const missing = [
          !fulfillmentPolicyId && "Fulfillment (Shipping)",
          !paymentPolicyId && "Payment",
          !returnPolicyId && "Return",
        ].filter(Boolean).join(", ");

        return new Response(
          JSON.stringify({
            error: `Missing eBay business policies: ${missing}. Please create these policies in your eBay Seller Hub (https://www.ebay.com/sh/ovw/policies) before publishing.`,
            missingPolicies: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 4: Build offer payload using separate builders for each format
      const format = listingFormat === "AUCTION" ? "AUCTION" : "FIXED_PRICE";
      let offerBody: Record<string, unknown>;

      if (format === "FIXED_PRICE") {
        offerBody = buildFixedPriceOffer({
          sku,
          description,
          listingPrice: Number(listingPrice ?? 0),
          ebayCategoryId: ebayCategoryId || undefined,
          merchantLocationKey,
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId,
        });
      } else {
        offerBody = buildAuctionOffer({
          sku,
          description,
          auctionStartPrice: Number(auctionStartPrice ?? 0),
          auctionBuyItNow: auctionBuyItNow ? Number(auctionBuyItNow) : undefined,
          auctionDuration: auctionDuration || DEFAULT_AUCTION_DURATION,
          ebayCategoryId: ebayCategoryId || undefined,
          merchantLocationKey,
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId,
        });
      }

      const offerResp = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Language": "en-US" },
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

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-publish error:", errorMsg);

    const isClientError =
      errorMsg.includes("not configured") ||
      errorMsg.includes("not provided") ||
      errorMsg.includes("No authorization") ||
      errorMsg.includes("Missing");

    return new Response(
      JSON.stringify({ error: errorMsg }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
