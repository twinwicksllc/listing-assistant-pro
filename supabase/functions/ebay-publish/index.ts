import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// Listing duration constants
// GTC = "Good 'Til Cancelled" — required for FIXED_PRICE listings
// Auctions must use a specific day count: 1, 3, 5, 7, or 10
// ----------------------------------------------------------------
const FIXED_PRICE_DURATION = "GTC";
const DEFAULT_AUCTION_DURATION = "Days_7";

// ----------------------------------------------------------------
// Ensure an eBay inventory location exists for the seller.
// If one already exists with the given key, this is a no-op (PUT is idempotent).
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
    // Non-fatal: we still return the key and let the offer creation attempt proceed.
    // eBay may already have a location configured under a different key.
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

      console.log("get_auth_url: ruName =", ruName, "authUrl =", authUrl);

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
        console.error("exchange_code: Missing required config: EBAY_RUNAME and EBAY_REDIRECT_URI");
        throw new Error("eBay callback URI not configured. Contact admin to set EBAY_RUNAME or EBAY_REDIRECT_URI.");
      }

      console.log(
        "exchange_code: code =",
        code?.substring(0, 20) + "...",
        "ruName =",
        ruName,
        "environment =",
        ebayEnv
      );

      if (!clientId || !clientSecret) {
        console.error("exchange_code: Missing eBay credentials in environment");
        throw new Error("eBay API credentials not configured. Contact admin.");
      }

      const credentials = btoa(`${clientId}:${clientSecret}`);

      console.log("exchange_code: POSTing to", tokenUrl, "with grant_type=authorization_code");

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

      console.log("exchange_code: response status =", resp.status, resp.statusText);

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("eBay token exchange error - status:", resp.status);
        console.error("eBay error response:", txt);

        let errorMsg = txt;
        try {
          const json = JSON.parse(txt);
          errorMsg = json.error_description || json.error || txt;
        } catch {
          // Not JSON, use raw text
        }

        throw new Error(`eBay token exchange failed (${resp.status}): ${errorMsg}`);
      }

      const tokenData = await resp.json();

      if (!tokenData.access_token) {
        console.error("exchange_code: No access_token in response. Response:", tokenData);
        throw new Error("eBay returned no access token. Authorization code may have expired or been reused.");
      }

      console.log(
        "exchange_code: Successfully obtained access_token (expires in",
        tokenData.expires_in,
        "seconds)"
      );

      // --- Store token server-side in Supabase profiles table ---
      // This avoids exposing the token in localStorage (XSS risk).
      // We store it only if a userId was provided (authenticated call).
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

      // Check if token is expired
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

    // --- ACTION: Create draft listing via Inventory API ---
    if (action === "create_draft") {
      const {
        userToken,
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

      // eBay Partner Network campaign ID for affiliate revenue tracking
      const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";

      // Helper: build EPN rover affiliate link from a listing ID
      const buildAffiliateUrl = (listingId: string): string => {
        const baseUrl = `https://www.ebay.com/itm/${listingId}`;
        if (!epnCampaignId) return baseUrl;
        return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${encodeURIComponent(epnCampaignId)}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
      };

      // Use a UUID-based SKU to avoid any account-level SKU validation conflicts
      const sku = `LA-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

      // Build eBay-formatted item specifics (aspects)
      const aspects: Record<string, string[]> = {};
      if (itemSpecifics && typeof itemSpecifics === "object") {
        for (const [key, value] of Object.entries(itemSpecifics)) {
          if (value && typeof value === "string" && value.trim()) {
            aspects[key] = [value.trim()];
          }
        }
      }

      // Step 1: Create/update inventory item
      const inventoryBody: any = {
        product: {
          title,
          description,
          imageUrls: imageUrl ? [imageUrl] : [],
        },
        // ConditionEnum string values are correct for the Inventory API
        // (numeric IDs are only for the Trading API / File Exchange CSV)
        condition: condition || "USED_EXCELLENT",
        availability: {
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      };

      // Add aspects (item specifics) to the product
      if (Object.keys(aspects).length > 0) {
        inventoryBody.product.aspects = aspects;
      }

      const inventoryResp = await fetch(
        `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "Content-Language": "en-US",
          },
          body: JSON.stringify(inventoryBody),
        }
      );

      if (!inventoryResp.ok) {
        const errText = await inventoryResp.text();
        console.error("eBay inventory error:", inventoryResp.status, errText);
        throw new Error(`Failed to create inventory item: ${inventoryResp.status} - ${errText}`);
      }

      // Step 2: Ensure inventory location exists (required for publishing)
      // merchantLocationKey is required in the offer payload per eBay Inventory API spec.
      // We auto-create a "default-location" using the seller's postal code.
      const effectivePostalCode = postalCode || "10001"; // fallback to NYC if not set
      const merchantLocationKey = await ensureInventoryLocation(
        apiBase,
        userToken,
        effectivePostalCode
      );

      // Step 3: Fetch user's default business policies from eBay Account API.
      const authHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      };

      const fetchDefaultPolicy = async (policyType: string): Promise<string | null> => {
        const resp = await fetch(
          `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
          { headers: authHeaders }
        );
        if (!resp.ok) {
          console.warn(`Could not fetch ${policyType} policies:`, resp.status, await resp.text());
          return null;
        }
        const data = await resp.json();
        const policies = data[`${policyType}Policies`] || data[`${policyType}Policy`] || [];
        if (Array.isArray(policies) && policies.length > 0) {
          console.log(`Using ${policyType} policy: ${policies[0].name} (${policies[0][`${policyType}PolicyId`]})`);
          return policies[0][`${policyType}PolicyId`] || null;
        }
        console.warn(`No ${policyType} policies found on this account`);
        return null;
      };

      // Use draft-level policy IDs if provided, otherwise auto-fetch the first available
      const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
        draftFulfillmentPolicyId ? Promise.resolve(draftFulfillmentPolicyId) : fetchDefaultPolicy("fulfillment"),
        draftPaymentPolicyId     ? Promise.resolve(draftPaymentPolicyId)     : fetchDefaultPolicy("payment"),
        draftReturnPolicyId      ? Promise.resolve(draftReturnPolicyId)      : fetchDefaultPolicy("return"),
      ]);

      // All three policy IDs are required by eBay to publish a listing
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

      // Step 4: Create offer
      // Determine format and listing duration
      // - FIXED_PRICE listings MUST use "GTC" (Good 'Til Cancelled)
      // - AUCTION listings MUST use a specific day count: 1, 3, 5, 7, or 10
      const format = listingFormat === "AUCTION" ? "AUCTION" : "FIXED_PRICE";
      const listingDuration =
        format === "AUCTION"
          ? (auctionDuration || DEFAULT_AUCTION_DURATION)
          : FIXED_PRICE_DURATION;

      // Validate auction duration value
      const validAuctionDurations = ["Days_1", "Days_3", "Days_5", "Days_7", "Days_10"];
      if (format === "AUCTION" && !validAuctionDurations.includes(listingDuration)) {
        return new Response(
          JSON.stringify({
            error: `Invalid auction duration "${listingDuration}". Must be one of: ${validAuctionDurations.join(", ")}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const offerBody: any = {
        sku,
        marketplaceId: "EBAY_US",
        format,
        listingDescription: description,
        availableQuantity: 1,
        // listingDuration is required by eBay Inventory API
        // Fixed price: "GTC" | Auction: "Days_1", "Days_3", "Days_5", "Days_7", "Days_10"
        listingDuration,
        // merchantLocationKey is required for publishing — references the seller's inventory location
        merchantLocationKey,
        listingPolicies: {
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId,
        },
      };

      // Set pricing based on format
      if (format === "FIXED_PRICE") {
        offerBody.pricingSummary = {
          price: {
            value: String(listingPrice ?? 0),
            currency: "USD",
          },
        };
      } else {
        // Auction: starting bid required; optional Buy It Now price
        offerBody.pricingSummary = {
          auctionStartPrice: {
            value: String(auctionStartPrice ?? 0),
            currency: "USD",
          },
        };
        if (auctionBuyItNow && auctionBuyItNow > 0) {
          offerBody.pricingSummary.price = {
            value: String(auctionBuyItNow),
            currency: "USD",
          };
        }
      }

      // Set eBay category ID
      if (ebayCategoryId) {
        offerBody.categoryId = ebayCategoryId;
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
        // Return offerId even if publish failed so we can debug
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
      const affiliateUrl = listingId ? buildAffiliateUrl(listingId) : null;

      console.log(`Successfully published listing: listingId=${listingId}, offerId=${offerId}, sku=${sku}`);

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

    // --- ACTION: Bulk publish multiple drafts ---
    // Uses sequential publishing with proper error tracking per item.
    // Note: eBay's bulkPublishOffer endpoint requires offers to already exist.
    // Our flow creates inventory item + offer + publishes in one shot per item,
    // so true bulk is not applicable here without a two-phase approach.
    // This action provides a server-side loop to avoid client-side sequential calls.
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
          // Re-invoke this same function with create_draft action for each draft
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
    console.error("Full error details:", e);

    const isClientError =
      errorMsg.includes("not configured") ||
      errorMsg.includes("not provided") ||
      errorMsg.includes("No authorization") ||
      errorMsg.includes("Missing");

    return new Response(
      JSON.stringify({
        error: errorMsg,
        status: isClientError ? 400 : 500,
      }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});