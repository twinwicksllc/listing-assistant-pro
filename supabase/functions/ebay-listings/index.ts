import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// Fallback: fetch active listings via the Trading API (XML-based, works for all account
// types regardless of SKU format, not affected by Inventory API errorId 25707).
async function fetchListingsViaTradingAPI(
  apiBase: string,
  userToken: string,
  _ebayHeaders: Record<string, string>,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  // Do NOT include <RequesterCredentials> — the IAF-TOKEN header is sufficient
  // and sending both can cause auth errors.
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

  try {
    const resp = await fetch(tradingUrl, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-SITEID": "0",
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": userToken,
      },
      body: xml,
    });

    const xmlText = await resp.text();
    console.log("Trading API response status:", resp.status, "— first 800 chars:", xmlText.substring(0, 800));

    if (!resp.ok) {
      console.error("Trading API HTTP error:", resp.status);
      return new Response(
        JSON.stringify({ listings: [], error: `Trading API error ${resp.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for eBay-level errors inside the XML (HTTP 200 but Ack=Failure)
    if (xmlText.includes("<Ack>Failure</Ack>") || xmlText.includes("<Ack>PartialFailure</Ack>")) {
      const errMsg = xmlText.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
                     xmlText.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ||
                     "Unknown Trading API error";
      console.error("Trading API Ack failure:", errMsg);
      return new Response(
        JSON.stringify({ listings: [], error: `eBay Trading API error: ${errMsg}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Items live inside <ActiveList><ItemArray><Item>...</Item></ItemArray></ActiveList>
    const listings: any[] = [];
    const itemMatches = xmlText.matchAll(/<Item>([\s\S]*?)<\/Item>/g);
    for (const match of itemMatches) {
      const item = match[1];
      const get = (tag: string) => {
        const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : "";
      };
      const listingId = get("ItemID");
      const title = get("Title");
      // CurrentPrice has a currencyID attribute: <CurrentPrice currencyID="USD">29.99</CurrentPrice>
      const priceStr = get("CurrentPrice") || get("BuyItNowPrice") || "0";
      const price = parseFloat(priceStr) || 0;
      const currency = item.match(/<CurrentPrice currencyID="([^"]+)"/)?.[1] || "USD";
      const imageUrl = get("GalleryURL") || get("PictureURL") || "";
      const sku = get("SKU");
      const status = get("ListingStatus") || "ACTIVE";
      const categoryId = get("CategoryID") || "";

      if (listingId) {
        listings.push({
          offerId: null,
          sku: sku || listingId,
          title: title || listingId,
          imageUrl,
          price,
          currency,
          status,
          categoryId,
          listingId,
          views: 0,
          ebayUrl: `https://www.ebay.com/itm/${listingId}`,
        });
      }
    }

    // Log any SKUs with non-alphanumeric characters (the "poisoned" ones)
    const poisonedSkus = listings.filter(l => l.sku && /[^a-zA-Z0-9]/.test(l.sku));
    if (poisonedSkus.length > 0) {
      console.warn("Poisoned SKUs found via Trading API:",
        JSON.stringify(poisonedSkus.map(l => ({ itemId: l.listingId, sku: l.sku, title: l.title }))));
    }

    console.log(`Trading API fallback: loaded ${listings.length} active listings, ${poisonedSkus.length} with non-alphanumeric SKUs`);

    return new Response(
      JSON.stringify({ listings, needsAuth: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Trading API fallback exception:", e);
    return new Response(
      JSON.stringify({ listings: [], error: "Failed to load listings via Trading API fallback" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

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
        console.warn("eBay Inventory API /offer rejected with SKU error — account has legacy listings incompatible with this endpoint. Falling back to Trading API GetMyeBaySelling.");

        // The Inventory API validates the entire account's offer data before applying
        // limit/offset, so even limit=1&offset=0 returns the same error. This account
        // has at least one legacy listing (e.g. SKU-004) that eBay considers invalid
        // but the user cannot edit (e.g. under appeal). We fall back to the Trading API
        // which works for all account types and ignores SKU format constraints.
        return await fetchListingsViaTradingAPI(apiBase, userToken, ebayHeaders, corsHeaders);
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
