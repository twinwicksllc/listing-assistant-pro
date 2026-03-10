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
        console.warn("eBay offers bulk call failed with SKU error. Falling back to per-offer fetch to skip bad SKUs. Raw error:", errText);

        // eBay's /offer?limit=N endpoint chokes internally on any stored offer whose SKU
        // contains non-alphanumeric characters (e.g. "SKU-004" with a hyphen).
        // Even inactive/appealed listings that can't be edited still block the bulk call.
        // Solution: fetch limit=1 per offset, silently skip any that error, return the rest.
        const goodOffers: any[] = [];
        const badOffsets: number[] = [];
        const MAX_OFFERS = 200; // safety cap

        for (let i = 0; i < MAX_OFFERS; i++) {
          const r = await fetch(
            `${apiBase}/sell/inventory/v1/offer?limit=1&offset=${i}`,
            { headers: ebayHeaders }
          );
          if (!r.ok) {
            const t = await r.text();
            if (t.includes("SKU")) {
              badOffsets.push(i);
              console.warn(`Skipping offer at offset ${i} — bad SKU (errorId 25707)`);
              continue; // skip this one, keep going
            }
            // Any other error (auth, rate limit, etc.) — stop
            console.warn(`Stopping per-offer fetch at offset ${i}: ${r.status} ${t}`);
            break;
          }
          const d = await r.json();
          const page: any[] = d.offers || [];
          if (page.length === 0) break; // no more offers
          goodOffers.push(...page);
        }

        console.warn(
          `Per-offer fetch complete — loaded ${goodOffers.length} offers, ` +
          `skipped ${badOffsets.length} bad offset(s): [${badOffsets.join(", ")}]`
        );

        // If we got some good offers, process them normally (fall through by returning early
        // only if we got nothing useful)
        if (goodOffers.length === 0) {
          const warning = badOffsets.length > 0
            ? `Your eBay account has ${badOffsets.length} listing(s) with invalid SKUs that are blocking the dashboard (e.g. SKUs with hyphens like "SKU-004"). These listings need to be deleted from eBay before the dashboard can show your active listings.`
            : "No eBay offers found in your account.";
          return new Response(
            JSON.stringify({ listings: [], warning }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // We have good offers — continue processing them below by reassigning and falling through
        // (restructure: build listings from goodOffers directly and return)
        const goodListings = await Promise.all(
          goodOffers.map(async (offer: any) => {
            let product: any = {};
            try {
              const itemResp = await fetch(
                `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`,
                { headers: ebayHeaders }
              );
              if (itemResp.ok) {
                const itemData = await itemResp.json();
                product = itemData.product || {};
              }
            } catch { /* skip */ }
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
              views: 0,
              ebayUrl: offer.listing?.listingId ? `https://www.ebay.com/itm/${offer.listing.listingId}` : null,
            };
          })
        );

        const skippedNote = badOffsets.length > 0
          ? ` (${badOffsets.length} listing(s) with invalid SKUs were skipped)`
          : "";
        return new Response(
          JSON.stringify({
            listings: goodListings,
            needsAuth: false,
            warning: badOffsets.length > 0
              ? `Loaded ${goodListings.length} listing(s). ${badOffsets.length} listing(s) with invalid SKUs (e.g. containing hyphens) were skipped and cannot be shown until removed from eBay.`
              : undefined,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
