import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
      // EBAY_RUNAME is the RuName from eBay Developer Portal (used in OAuth authorize URL)
      // EBAY_REDIRECT_URI is the actual callback URL (https://lister.teckstart.com/ebay/callback)
      // If EBAY_RUNAME is not set, fall back to EBAY_REDIRECT_URI for backwards compatibility
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
      const { code } = payload;
      if (!code) throw new Error("No authorization code provided");

      // For token exchange, eBay also expects the RuName (same value used in authorize URL)
      const ruName = Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) {
        console.error("exchange_code: Missing required config: EBAY_RUNAME and EBAY_REDIRECT_URI");
        throw new Error("eBay callback URI not configured. Contact admin to set EBAY_RUNAME or EBAY_REDIRECT_URI.");
      }

      console.log("exchange_code: code =", code?.substring(0, 20) + "...", "ruName =", ruName, "environment =", ebayEnv);

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
        
        // Try to extract meaningful error from eBay response
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

      console.log("exchange_code: Successfully obtained access_token (expires in", tokenData.expires_in, "seconds)");

      return new Response(
        JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Create draft listing via Inventory API ---
    if (action === "create_draft") {
      const { userToken, title, description, priceMin, imageUrl, condition, ebayCategoryId, itemSpecifics } = payload;
      if (!userToken) throw new Error("No eBay user token provided");

      // eBay Partner Network campaign ID for affiliate revenue tracking
      const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";

      // Helper: build EPN rover affiliate link from a listing ID
      const buildAffiliateUrl = (listingId: string): string => {
        const baseUrl = `https://www.ebay.com/itm/${listingId}`;
        if (!epnCampaignId) return baseUrl;
        return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${encodeURIComponent(epnCampaignId)}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
      };

      const sku = `LISTING-${Date.now()}`;

      // Build eBay-formatted item specifics (nameValueList)
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

      // Step 2: Create offer (draft listing)
      const offerBody: any = {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        listingDescription: description,
        availableQuantity: 1,
        pricingSummary: {
          price: {
            value: String(priceMin),
            currency: "USD",
          },
        },
        listingPolicies: {},
      };

      // Set eBay category ID
      if (ebayCategoryId) {
        offerBody.categoryId = ebayCategoryId;
      }

      const offerResp = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(offerBody),
      });

      if (!offerResp.ok) {
        const errText = await offerResp.text();
        console.error("eBay offer error:", offerResp.status, errText);
        throw new Error(`Failed to create offer: ${offerResp.status} - ${errText}`);
      }

      const offerData = await offerResp.json();

      // Build affiliate link if the offer already has a listingId (published immediately)
      // or store the offerId so the frontend can construct it once the listing goes live
      const listingId = offerData.listing?.listingId || null;
      const affiliateUrl = listingId ? buildAffiliateUrl(listingId) : null;

      return new Response(
        JSON.stringify({
          success: true,
          offerId: offerData.offerId,
          sku,
          listingId,
          affiliateUrl,
          message: "Draft listing created on eBay",
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
    
    // Return 400 for client errors (configuration issues, bad input, etc)
    // Return 500 only for unexpected server errors
    const isClientError = errorMsg.includes("not configured") || 
                         errorMsg.includes("not provided") ||
                         errorMsg.includes("No authorization") ||
                         errorMsg.includes("Missing");
    
    return new Response(
      JSON.stringify({ 
        error: errorMsg,
        status: isClientError ? 400 : 500
      }),
      { 
        status: isClientError ? 400 : 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
