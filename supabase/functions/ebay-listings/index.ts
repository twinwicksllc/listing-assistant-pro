import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ─── Analytics metrics we want per listing ───────────────────────────────────
// LISTING_VIEWS_TOTAL         → views (page views on the listing)
// LISTING_IMPRESSION_TOTAL    → impressions (how many times listing appeared in search/browse)
// CLICK_THROUGH_RATE          → ctr  (impressions → listing page clicks, as decimal e.g. 0.045)
// SALES_CONVERSION_RATE       → cvr  (listing views → purchases, as decimal)
// TRANSACTION                 → transactions (completed sales count)
const ANALYTICS_METRICS = [
  "LISTING_VIEWS_TOTAL",
  "LISTING_IMPRESSION_TOTAL",
  "CLICK_THROUGH_RATE",
  "SALES_CONVERSION_RATE",
  "TRANSACTION",
].join(",");

// ─── Fetch multi-metric traffic data from Sell Analytics API ─────────────────
async function fetchAnalyticsData(
  apiBase: string,
  ebayHeaders: Record<string, string>
): Promise<Record<string, {
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
}>> {
  const result: Record<string, {
    views: number;
    impressions: number;
    clickThroughRate: number;
    salesConversionRate: number;
    transactions: number;
  }> = {};

  try {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateRange = `${thirtyDaysAgo.toISOString().split("T")[0]}..${today.toISOString().split("T")[0]}`;

    const trafficResp = await fetch(
      `${apiBase}/sell/analytics/v1/traffic_report?dimension=LISTING&filter=date_range:[${dateRange}]&metric=${ANALYTICS_METRICS}`,
      { headers: ebayHeaders }
    );

    if (!trafficResp.ok) {
      console.warn("Analytics API error:", trafficResp.status);
      return result;
    }

    const trafficData = await trafficResp.json();
    const metricHeaders: string[] = (trafficData.metricHeaders || []).map((h: any) => h.name);
    const records = trafficData.records || [];

    for (const record of records) {
      const listingKey = record.dimensionValues?.[0]?.value || "";
      if (!listingKey) continue;

      const metricValues = record.metricValues || [];
      const getMetric = (name: string): number => {
        const idx = metricHeaders.indexOf(name);
        if (idx < 0 || idx >= metricValues.length) return 0;
        const val = metricValues[idx]?.value;
        return val ? parseFloat(val) : 0;
      };

      result[listingKey] = {
        views: Math.round(getMetric("LISTING_VIEWS_TOTAL")),
        impressions: Math.round(getMetric("LISTING_IMPRESSION_TOTAL")),
        clickThroughRate: getMetric("CLICK_THROUGH_RATE"),
        salesConversionRate: getMetric("SALES_CONVERSION_RATE"),
        transactions: Math.round(getMetric("TRANSACTION")),
      };
    }

    console.log(`Analytics API: loaded metrics for ${Object.keys(result).length} listings`);
  } catch (e) {
    console.error("Analytics API error (non-fatal):", e);
  }

  return result;
}

// ─── Fetch WatchCount + QuestionCount for a batch of listing IDs via GetItem ──
// Used for Inventory API path where these aren't available in the offer data.
async function fetchWatchDataForListings(
  listingIds: string[],
  tradingUrl: string,
  userToken: string
): Promise<Record<string, { watchCount: number; questionCount: number }>> {
  const result: Record<string, { watchCount: number; questionCount: number }> = {};
  if (listingIds.length === 0) return result;

  // Batch in groups of 20 to avoid oversized requests
  const BATCH_SIZE = 20;
  for (let i = 0; i < listingIds.length; i += BATCH_SIZE) {
    const batch = listingIds.slice(i, i + BATCH_SIZE);
    const itemIdXml = batch.map((id) => `<ItemID>${id}</ItemID>`).join("\n");

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${batch[0]}</ItemID>
  <IncludeWatchCount>true</IncludeWatchCount>
  <OutputSelector>ItemID,WatchCount,QuestionCount</OutputSelector>
</GetItemRequest>`;

    // For batching multiple items, we need individual GetItem calls per item
    // OR use GetMultipleItems (Shopping API) — but that doesn't return WatchCount.
    // Trading API GetItem is 1 item per call. We'll call them concurrently.
    const promises = batch.map(async (itemId) => {
      const singleXml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <IncludeWatchCount>true</IncludeWatchCount>
  <OutputSelector>ItemID,WatchCount,QuestionCount</OutputSelector>
</GetItemRequest>`;

      try {
        const resp = await fetch(tradingUrl, {
          method: "POST",
          headers: {
            "X-EBAY-API-CALL-NAME": "GetItem",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
            "X-EBAY-API-SITEID": "0",
            "Content-Type": "text/xml",
            "X-EBAY-API-IAF-TOKEN": userToken,
          },
          body: singleXml,
        });

        if (!resp.ok) return;
        const xmlText = await resp.text();
        const getTag = (tag: string) => xmlText.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || "";

        const watchCount = parseInt(getTag("WatchCount") || "0", 10);
        const questionCount = parseInt(getTag("QuestionCount") || "0", 10);
        result[itemId] = { watchCount: isNaN(watchCount) ? 0 : watchCount, questionCount: isNaN(questionCount) ? 0 : questionCount };
      } catch (e) {
        console.warn(`GetItem failed for ${itemId}:`, e);
      }
    });

    await Promise.all(promises);
  }

  return result;
}

// ─── Trading API fallback ─────────────────────────────────────────────────────
async function fetchListingsViaTradingAPI(
  apiBase: string,
  userToken: string,
  _ebayHeaders: Record<string, string>,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  // GetMyeBaySelling with WatchCount included
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <SoldList><Include>false</Include></SoldList>
  <UnsoldList><Include>false</Include></UnsoldList>
  <ScheduledList><Include>false</Include></ScheduledList>
  <IncludeWatchCount>true</IncludeWatchCount>
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

    const activeListMatch = xmlText.match(/<ActiveList[^>]*>([\s\S]*?)<\/ActiveList>/);
    if (!activeListMatch) {
      console.warn("No ActiveList container found in Trading API response");
      return new Response(
        JSON.stringify({ listings: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const listings: any[] = [];
    const activeListContent = activeListMatch[1];
    const itemMatches = activeListContent.matchAll(/<Item>([\s\S]*?)<\/Item>/g);

    for (const match of itemMatches) {
      const item = match[1];
      const get = (tag: string) => {
        const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : "";
      };

      const listingId = get("ItemID");
      const title = get("Title");
      const priceStr = get("CurrentPrice") || get("BuyItNowPrice") || "0";
      const price = parseFloat(priceStr) || 0;
      const currency = item.match(/<CurrentPrice currencyID="([^"]+)"/)?.[1] || "USD";
      const imageUrl = get("GalleryURL") || get("PictureURL") || "";
      const sku = get("SKU");
      const categoryId = get("CategoryID") || "";

      const listingStatus = get("ListingStatus");

      const quantityStr = get("Quantity");
      const quantitySoldStr = get("QuantitySold");
      const quantity = quantityStr ? parseInt(quantityStr, 10) : 0;
      const quantitySold = quantitySoldStr ? parseInt(quantitySoldStr, 10) : 0;
      const quantityAvailable = quantity - quantitySold;

      const isCompletedOrEnded = listingStatus === "Completed" || listingStatus === "Ended";
      const isSingleQtySold = quantity === 1 && quantitySold >= 1;
      const isGenuinelyActive = quantityAvailable > 0 && !isCompletedOrEnded && !isSingleQtySold;

      if (listingId && isGenuinelyActive) {
        const listingDate = get("StartTime") || null;
        const listingType = get("ListingType") || "FixedPriceItem";
        const conditionName = get("ConditionDisplayName") || "";

        // Parse WatchCount and QuestionCount from Trading API response
        const watchCountStr = get("WatchCount");
        const watchCount = watchCountStr ? parseInt(watchCountStr, 10) : 0;
        const questionCountStr = get("QuestionCount");
        const questionCount = questionCountStr ? parseInt(questionCountStr, 10) : 0;

        console.log(`Trading API item: ItemID=${listingId}, Title="${title}", SKU="${sku}", Status=${listingStatus}, Qty=${quantityAvailable}, Watches=${watchCount}`);

        listings.push({
          offerId: null,
          sku: sku || listingId,
          title: title || listingId,
          imageUrl,
          price,
          currency,
          status: "Active",
          categoryId,
          listingId,
          views: 0,       // filled by Analytics API below
          impressions: 0,
          clickThroughRate: 0,
          salesConversionRate: 0,
          transactions: 0,
          watchCount: isNaN(watchCount) ? 0 : watchCount,
          questionCount: isNaN(questionCount) ? 0 : questionCount,
          ebayUrl: `https://www.ebay.com/itm/${listingId}`,
          quantity: quantityAvailable,
          format: listingType === "Chinese" ? "AUCTION" : "FIXED_PRICE",
          condition: conditionName,
          listingDate,
        });
      } else if (listingId) {
        if (quantityAvailable <= 0) {
          console.log(`Skipping sold-out item: ItemID=${listingId}, Title="${title}", Qty available: ${quantityAvailable}`);
        } else if (isCompletedOrEnded) {
          console.log(`Skipping completed/ended item: ItemID=${listingId}, Title="${title}", Status: ${listingStatus}`);
        } else if (isSingleQtySold) {
          console.log(`Skipping single-qty sold item: ItemID=${listingId}, Title="${title}", Qty: ${quantity}, Sold: ${quantitySold}`);
        }
      }
    }

    // Fetch analytics for all listing IDs
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    };
    const analyticsMap = await fetchAnalyticsData(apiBase, ebayHeaders);

    // Merge analytics into listings
    const enriched = listings.map((l) => {
      const a = analyticsMap[l.listingId] || analyticsMap[l.sku] || null;
      return {
        ...l,
        views: a?.views ?? l.views,
        impressions: a?.impressions ?? l.impressions,
        clickThroughRate: a?.clickThroughRate ?? l.clickThroughRate,
        salesConversionRate: a?.salesConversionRate ?? l.salesConversionRate,
        transactions: a?.transactions ?? l.transactions,
      };
    });

    // Build EPN affiliate links
    const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      const baseUrl = `https://www.ebay.com/itm/${listingId}`;
      if (!epnCampaignId) return baseUrl;
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${epnCampaignId}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
    };

    const finalListings = enriched.map((l) => ({ ...l, ebayUrl: buildEbayUrl(l.listingId) }));

    const poisonedSkus = finalListings.filter(l => l.sku && /[^a-zA-Z0-9]/.test(l.sku));
    if (poisonedSkus.length > 0) {
      console.warn("Poisoned SKUs found via Trading API:",
        JSON.stringify(poisonedSkus.map(l => ({ itemId: l.listingId, sku: l.sku, title: l.title }))));
    }

    console.log(`Trading API fallback: loaded ${finalListings.length} active listings, ${poisonedSkus.length} with non-alphanumeric SKUs`);

    return new Response(
      JSON.stringify({ listings: finalListings, needsAuth: false }),
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

      if (offersResp.status === 401 || offersResp.status === 403) {
        return new Response(
          JSON.stringify({ listings: [], needsAuth: true, debug: `eBay API ${offersResp.status}: ${errText}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (offersResp.status === 400 && errText.includes("SKU")) {
        console.warn("eBay Inventory API /offer rejected with SKU error — falling back to Trading API.");
        return await fetchListingsViaTradingAPI(apiBase, userToken, ebayHeaders, corsHeaders);
      }

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
            console.warn(`Skipping inventory fetch for SKU "${offer.sku}": ${itemResp.status}`);
          } else {
            const errText = await itemResp.text();
            console.warn(`Inventory fetch error for SKU "${offer.sku}": ${itemResp.status} ${errText}`);
          }
        } catch (err) {
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
          quantity: offer.availableQuantity ?? 1,
          format: offer.format || "FIXED_PRICE",
          condition: offer.condition || "",
          listingDate: offer.listing?.publishedDate || null,
          // Stats — filled below
          views: 0,
          impressions: 0,
          clickThroughRate: 0,
          salesConversionRate: 0,
          transactions: 0,
          watchCount: 0,
          questionCount: 0,
        };
      })
    );

    // Fetch WatchCount for Inventory API listings via Trading API GetItem
    const tradingUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/ws/api.dll"
      : "https://api.ebay.com/ws/api.dll";

    const listingIds = listings.map((l: any) => l.listingId).filter(Boolean) as string[];
    const watchMap = await fetchWatchDataForListings(listingIds, tradingUrl, userToken);

    // Fetch multi-metric analytics
    const analyticsMap = await fetchAnalyticsData(apiBase, ebayHeaders);

    // Build EPN affiliate link helper
    const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      const baseUrl = `https://www.ebay.com/itm/${listingId}`;
      if (!epnCampaignId) return baseUrl;
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${epnCampaignId}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
    };

    // Merge all data
    const enrichedListings = listings.map((l: any) => {
      const a = analyticsMap[l.listingId] || analyticsMap[l.sku] || null;
      const w = l.listingId ? (watchMap[l.listingId] || null) : null;
      return {
        ...l,
        views: a?.views ?? 0,
        impressions: a?.impressions ?? 0,
        clickThroughRate: a?.clickThroughRate ?? 0,
        salesConversionRate: a?.salesConversionRate ?? 0,
        transactions: a?.transactions ?? 0,
        watchCount: w?.watchCount ?? 0,
        questionCount: w?.questionCount ?? 0,
        ebayUrl: buildEbayUrl(l.listingId),
      };
    });

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