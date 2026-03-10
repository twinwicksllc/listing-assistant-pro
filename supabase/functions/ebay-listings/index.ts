import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userToken } = await req.json();

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    console.log("ebay-listings: env =", ebayEnv, "token prefix =", userToken ? userToken.substring(0, 20) + "..." : "NONE");
    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    if (!userToken) {
      return new Response(
        JSON.stringify({ listings: [], needsAuth: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Note: `status` is NOT a documented query param for GET /offer — do not add it.
    // The only valid filters are: sku, format, marketplace_id, limit, offset.
    console.log("ebay-listings: calling", `${apiBase}/sell/inventory/v1/offer?limit=100`);

    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    };

    const offersResp = await fetch(
      `${apiBase}/sell/inventory/v1/offer?limit=100`,
      { headers: ebayHeaders }
    );

    if (offersResp.status === 401) {
      return new Response(
        JSON.stringify({ listings: [], needsAuth: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!offersResp.ok) {
      const errText = await offersResp.text();
      console.error("eBay offers error:", offersResp.status, errText);
      
      // Return needsAuth for any auth-related error so frontend clears the token
      if (offersResp.status === 401 || offersResp.status === 403) {
        return new Response(
          JSON.stringify({ listings: [], needsAuth: true, debug: `eBay API ${offersResp.status}: ${errText}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Check if this is a SKU validation error - scan inventory items to identify the bad SKU(s)
      if (offersResp.status === 400 && errText.includes("SKU")) {
        console.warn("eBay account has SKU validation issues. Attempting inventory scan to identify bad SKUs. Raw error:", errText);

        // Try to enumerate all inventory items and check each SKU for non-alphanumeric characters.
        // eBay's definition: ONLY letters and digits are valid (no hyphens, underscores, spaces, etc.)
        const badSkus: string[] = [];
        let totalItemsScanned = 0;
        let scanError: string | null = null;
        try {
          let offset = 0;
          const limit = 100;
          let keepGoing = true;
          while (keepGoing) {
            const itemsResp = await fetch(
              `${apiBase}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
              { headers: ebayHeaders }
            );
            if (!itemsResp.ok) {
              const errBody = await itemsResp.text();
              scanError = `inventory_item scan failed: ${itemsResp.status} ${errBody}`;
              console.warn(scanError);
              break;
            }
            const itemsData = await itemsResp.json();
            const items: any[] = itemsData.inventoryItems || [];
            totalItemsScanned += items.length;
            for (const item of items) {
              const sku: string = item.sku || "";
              // Strictly alphanumeric only — no hyphens, underscores, spaces, etc.
              if (sku.length === 0 || sku.length > 50 || !/^[a-zA-Z0-9]+$/.test(sku)) {
                badSkus.push(sku);
              }
            }
            const total = itemsData.total || 0;
            offset += items.length;
            keepGoing = items.length === limit && offset < total;
          }
        } catch (scanErr) {
          scanError = String(scanErr);
          console.warn("Inventory scan exception:", scanErr);
        }

        console.warn(`SKU scan complete — scanned ${totalItemsScanned} inventory items, bad SKUs: [${badSkus.join(", ")}]${scanError ? ` (scan error: ${scanError})` : ""}`);

        let warning: string;
        if (badSkus.length > 0) {
          const skuList = badSkus.map(s => `"${s}"`).join(", ");
          warning = `Your eBay inventory contains ${badSkus.length} listing(s) with invalid SKUs: ${skuList}. Go to eBay Seller Hub → Inventory, search for each one, and either delete the listing or edit its SKU to use only letters and numbers (no spaces or special characters). After fixing, wait a few minutes and reconnect.`;
        } else if (scanError) {
          warning = "Your eBay account has listings with invalid SKUs, but we couldn't identify them automatically. Go to eBay Seller Hub → Inventory and look for listings whose SKU contains spaces, slashes, or other special characters, then delete or fix them.";
        } else if (totalItemsScanned === 0) {
          // No inventory items at all — the bad SKU must be in an offer without an inventory item
          // (created via classic eBay seller flow, not the Inventory API)
          warning = "eBay returned a SKU validation error but no Inventory API items were found in your account. Your existing eBay listings were likely created through the classic seller flow. Please go to eBay Seller Hub → Listings and end/delete any old listings that have non-alphanumeric characters in their SKU field, then reconnect.";
        } else {
          // Items scanned, none flagged — the bad SKU may contain only hyphens or underscores
          warning = `Scanned ${totalItemsScanned} inventory items — no strictly-invalid SKUs found, but eBay is still rejecting the request. Please go to eBay Seller Hub → Inventory and look for any listings whose SKU contains hyphens, underscores, or other non-alphanumeric characters, then delete or fix them.`;
        }

        return new Response(
          JSON.stringify({ listings: [], warning }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // For other errors, return error details instead of throwing (avoids 500)
      return new Response(
        JSON.stringify({ listings: [], error: `eBay API error ${offersResp.status}: ${errText}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const offersData = await offersResp.json();
    const offers = offersData.offers || [];

    // For each offer, try to get the inventory item details
    const listings = await Promise.all(
      offers.map(async (offer: any) => {
        let product: any = {};
        try {
          const itemResp = await fetch(
            `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`,
            { headers: ebayHeaders }
          );
          if (itemResp.ok) {
            const itemData = await itemResp.json();
            product = itemData.product || {};
          } else if (itemResp.status === 400 || itemResp.status === 404) {
            // SKU is invalid or inventory item doesn't exist - skip it
            console.warn(`Skipping inventory fetch for SKU "${offer.sku}": ${itemResp.status}`);
          } else {
            // Log other errors but don't fail
            const errText = await itemResp.text();
            console.warn(`Inventory fetch error for SKU "${offer.sku}": ${itemResp.status} ${errText}`);
          }
        } catch (err) {
          // Network error or parsing error - skip silently
          console.warn(`Error fetching inventory for SKU "${offer.sku}":`, err);
        }

        return {
          offerId: offer.offerId,
          sku: offer.sku,
          title: product.title || offer.sku,
          imageUrl: product.imageUrls?.[0] || "",
          price: parseFloat(offer.pricingSummary?.price?.value || "0"),
          currency: offer.pricingSummary?.price?.currency || "USD",
          status: offer.status || "UNKNOWN",
          categoryId: offer.categoryId || "",
          listingId: offer.listing?.listingId || null,
        };
      })
    );

    // Try to get traffic data via Sell Analytics API
    let trafficMap: Record<string, number> = {};
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dateRange = `${thirtyDaysAgo.toISOString().split("T")[0]}..${today.toISOString().split("T")[0]}`;
      const trafficResp = await fetch(
        `${apiBase}/sell/analytics/v1/traffic_report?dimension=LISTING&filter=date_range:[${dateRange}]&metric=LISTING_VIEWS_TOTAL`,
        { headers: ebayHeaders }
      );

      if (trafficResp.ok) {
        const trafficData = await trafficResp.json();
        const records = trafficData.records || [];
        for (const record of records) {
          const listingKey = record.dimensionValues?.[0]?.value || "";
          const views = record.metricValues?.[0]?.value || "0";
          trafficMap[listingKey] = parseInt(views, 10);
        }
      }
    } catch (e) {
      console.error("Traffic API error (non-fatal):", e);
    }

    // Build EPN affiliate link helper
    const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      const baseUrl = `https://www.ebay.com/itm/${listingId}`;
      if (!epnCampaignId) return baseUrl;
      // eBay Partner Network rover link format
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${epnCampaignId}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
    };

    // Merge traffic data and EPN links
    const enrichedListings = listings.map((l: any) => ({
      ...l,
      views: trafficMap[l.listingId] || trafficMap[l.sku] || 0,
      ebayUrl: buildEbayUrl(l.listingId),
    }));

    return new Response(
      JSON.stringify({ listings: enrichedListings, needsAuth: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-listings error:", errorMsg);
    console.error("Full error:", e);
    const isProduction = Deno.env.get("ENVIRONMENT") === "production";
    return new Response(
      JSON.stringify({ 
        listings: [], 
        error: `Server error: ${errorMsg}`,
        debug: !isProduction ? String(e) : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
