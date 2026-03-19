import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ─── Analytics metrics we want per listing ───────────────────────────────────
const ANALYTICS_METRICS_ARRAY = [
  "LISTING_VIEWS_TOTAL",
  "LISTING_IMPRESSION_TOTAL",
  "CLICK_THROUGH_RATE",
  "SALES_CONVERSION_RATE",
  "TRANSACTION",
];
const ANALYTICS_METRICS = ANALYTICS_METRICS_ARRAY.join(",");

interface AnalyticsSnapshot {
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
}

type AnalyticsMap = Record<string, AnalyticsSnapshot>;

// ─── Fetch analytics for one date window ─────────────────────────────────────
async function fetchAnalyticsForWindow(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  days: number
): Promise<AnalyticsMap> {
  const result: AnalyticsMap = {};
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days);
    // eBay Analytics API requires yyyymmdd format (no hyphens), not yyyy-mm-dd
    const startDateStr = startDate.toISOString().split("T")[0].replace(/-/g, "");
    const endDateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    // Build URL with properly encoded filter parameter
    const url = new URL(`${apiBase}/sell/analytics/v1/traffic_report`);
    url.searchParams.set("dimension", "LISTING");
    url.searchParams.set("filter", `date_range:[${startDateStr}..${endDateStr}]`);
    url.searchParams.set("metric", ANALYTICS_METRICS);

    console.log(`Analytics API (${days}d): Fetching from ${url.toString()}`);
    const trafficResp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!trafficResp.ok) {
      const errText = await trafficResp.text();
      console.warn(`Analytics API error (${days}d): ${trafficResp.status} - ${errText.substring(0, 200)}`);
      return result;
    }

    const trafficData = await trafficResp.json();
    
    // Debug: log the raw metricHeaders structure
    console.log(`Analytics API (${days}d): Raw trafficData keys: ${Object.keys(trafficData).join(", ")}`);
    console.log(`Analytics API (${days}d): metricHeaders is: ${Array.isArray(trafficData.metricHeaders) ? "array" : typeof trafficData.metricHeaders}`);
    if (trafficData.metricHeaders) {
      console.log(`Analytics API (${days}d): First metricHeader: ${JSON.stringify(trafficData.metricHeaders[0]).substring(0, 200)}`);
    }
    
    // Use eBay's metricHeaders if provided, otherwise use our hardcoded order
    // (eBay returns metric values in the same order as requested)
    const metricHeaders: string[] = trafficData.metricHeaders && trafficData.metricHeaders.length > 0
      ? (trafficData.metricHeaders as any[]).map((h: any) => h.name)
      : ANALYTICS_METRICS_ARRAY;
    
    const records = trafficData.records || [];

    console.log(`Analytics API (${days}d): Got ${records.length} records with ${metricHeaders.length} metric headers`);
    
    // Log first record structure for debugging
    if (records.length > 0) {
      console.log(`Analytics API (${days}d): First record structure:`, JSON.stringify(records[0]).substring(0, 300));
    }
    
    for (const record of records) {
      const listingKey = record.dimensionValues?.[0]?.value || "";
      if (!listingKey) {
        console.warn(`Analytics API (${days}d): Record has no dimensionValues[0].value`, record);
        continue;
      }
      const metricValues = record.metricValues || [];
      const getMetric = (name: string): number => {
        const idx = metricHeaders.indexOf(name);
        if (idx < 0 || idx >= metricValues.length) return 0;
        const val = metricValues[idx]?.value;
        const parsed = val ? parseFloat(val) : 0;
        // Log individual metric parsing for first record
        if (listingKey === records[0]?.dimensionValues?.[0]?.value) {
          console.log(`Analytics API (${days}d): Metric ${name} (idx ${idx}): raw="${val}" parsed=${parsed}`);
        }
        return parsed;
      };
      const views = Math.round(getMetric("LISTING_VIEWS_TOTAL"));
      const impressions = Math.round(getMetric("LISTING_IMPRESSION_TOTAL"));
      const ctr = getMetric("CLICK_THROUGH_RATE");
      const conversionRate = getMetric("SALES_CONVERSION_RATE");
      const transactions = Math.round(getMetric("TRANSACTION"));
      
      result[listingKey] = {
        views,
        impressions,
        clickThroughRate: ctr,
        salesConversionRate: conversionRate,
        transactions,
      };
    }
    console.log(`Analytics API (${days}d): Loaded metrics for ${Object.keys(result).length} listings`);
  } catch (e) {
    console.error(`Analytics API error (${days}d, non-fatal):`, e);
  }
  return result;
}

// ─── Fetch all three windows in parallel ─────────────────────────────────────
async function fetchAllAnalytics(
  apiBase: string,
  ebayHeaders: Record<string, string>
): Promise<{ a7: AnalyticsMap; a30: AnalyticsMap; a90: AnalyticsMap }> {
  const [a7, a30, a90] = await Promise.all([
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 7),
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 30),
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 90),
  ]);
  return { a7, a30, a90 };
}

// ─── Merge analytics snapshots onto a listing object ─────────────────────────
function mergeAnalytics(
  listingId: string | null,
  sku: string,
  a7: AnalyticsMap,
  a30: AnalyticsMap,
  a90: AnalyticsMap
) {
  const key = listingId || sku;
  const s7 = a7[key] || a7[listingId || ""] || a7[sku] || null;
  const s30 = a30[key] || a30[listingId || ""] || a30[sku] || null;
  const s90 = a90[key] || a90[listingId || ""] || a90[sku] || null;
  
  // Debug logging - once per merge
  if (s7 || s30 || s90) {
    console.log(`mergeAnalytics: Found analytics for ${listingId || sku}`, {
      views7d: s7?.views, views30d: s30?.views, views90d: s90?.views
    });
  } else if (!listingId && sku) {
    console.warn(`mergeAnalytics: No analytics found for SKU "${sku}"`, {
      a7Keys: Object.keys(a7).slice(0, 3),
      a30Keys: Object.keys(a30).slice(0, 3),
      a90Keys: Object.keys(a90).slice(0, 3),
    });
  }
  
  return {
    // 30d is the "primary" for backward compat fields
    views: s30?.views ?? 0,
    impressions: s30?.impressions ?? 0,
    clickThroughRate: s30?.clickThroughRate ?? 0,
    salesConversionRate: s30?.salesConversionRate ?? 0,
    transactions: s30?.transactions ?? 0,
    // Per-window breakdowns
    views7d: s7?.views ?? 0,
    views30d: s30?.views ?? 0,
    views90d: s90?.views ?? 0,
    impressions7d: s7?.impressions ?? 0,
    impressions30d: s30?.impressions ?? 0,
    impressions90d: s90?.impressions ?? 0,
    transactions7d: s7?.transactions ?? 0,
    transactions30d: s30?.transactions ?? 0,
    transactions90d: s90?.transactions ?? 0,
  };
}

// ─── Fetch WatchCount + QuestionCount via GetItem ────────────────────────────
async function fetchWatchDataForListings(
  listingIds: string[],
  tradingUrl: string,
  userToken: string
): Promise<Record<string, { watchCount: number; questionCount: number }>> {
  const result: Record<string, { watchCount: number; questionCount: number }> = {};
  if (listingIds.length === 0) return result;

  const promises = listingIds.map(async (itemId) => {
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
      result[itemId] = {
        watchCount: isNaN(watchCount) ? 0 : watchCount,
        questionCount: isNaN(questionCount) ? 0 : questionCount,
      };
    } catch (e) {
      console.warn(`GetItem failed for ${itemId}:`, e);
    }
  });

  await Promise.all(promises);
  return result;
}

// ─── Trading API fallback ─────────────────────────────────────────────────────
async function fetchListingsViaTradingAPI(
  apiBase: string,
  userToken: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

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
      return new Response(
        JSON.stringify({ listings: [], error: `Trading API error ${resp.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (xmlText.includes("<Ack>Failure</Ack>") || xmlText.includes("<Ack>PartialFailure</Ack>")) {
      const errMsg = xmlText.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
                     xmlText.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ||
                     "Unknown Trading API error";
      return new Response(
        JSON.stringify({ listings: [], error: `eBay Trading API error: ${errMsg}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const activeListMatch = xmlText.match(/<ActiveList[^>]*>([\s\S]*?)<\/ActiveList>/);
    if (!activeListMatch) {
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

      const quantity = parseInt(get("Quantity") || "0", 10);
      const quantitySold = parseInt(get("QuantitySold") || "0", 10);
      const quantityAvailable = quantity - quantitySold;

      const isCompletedOrEnded = listingStatus === "Completed" || listingStatus === "Ended";
      const isSingleQtySold = quantity === 1 && quantitySold >= 1;
      const isGenuinelyActive = quantityAvailable > 0 && !isCompletedOrEnded && !isSingleQtySold;

      if (listingId && isGenuinelyActive) {
        const watchCount = parseInt(get("WatchCount") || "0", 10);
        const questionCount = parseInt(get("QuestionCount") || "0", 10);

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
          ebayUrl: `https://www.ebay.com/itm/${listingId}`,
          quantity: quantityAvailable,
          format: get("ListingType") === "Chinese" ? "AUCTION" : "FIXED_PRICE",
          condition: get("ConditionDisplayName") || "",
          listingDate: get("StartTime") || null,
          watchCount: isNaN(watchCount) ? 0 : watchCount,
          questionCount: isNaN(questionCount) ? 0 : questionCount,
          // Analytics — filled below
          views: 0, views7d: 0, views30d: 0, views90d: 0,
          impressions: 0, impressions7d: 0, impressions30d: 0, impressions90d: 0,
          clickThroughRate: 0, salesConversionRate: 0,
          transactions: 0, transactions7d: 0, transactions30d: 0, transactions90d: 0,
        });
      }
    }

    // Fetch all three analytics windows in parallel
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    };
    const { a7, a30, a90 } = await fetchAllAnalytics(apiBase, ebayHeaders);

    // Build EPN affiliate links
    const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      const baseUrl = `https://www.ebay.com/itm/${listingId}`;
      if (!epnCampaignId) return baseUrl;
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${epnCampaignId}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
    };

    const finalListings = listings.map((l) => ({
      ...l,
      ...mergeAnalytics(l.listingId, l.sku, a7, a30, a90),
      ebayUrl: buildEbayUrl(l.listingId),
    }));

    console.log(`Trading API fallback: loaded ${finalListings.length} active listings`);

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
        return await fetchListingsViaTradingAPI(apiBase, userToken, corsHeaders);
      }

      return new Response(
        JSON.stringify({ listings: [], error: `eBay API error ${offersResp.status}: ${errText}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const offersData = await offersResp.json();
    const offers = offersData.offers || [];
    console.log(`ebay-listings: Fetched ${offers.length} offers from eBay Inventory API`);

    // Fetch inventory item details for each offer
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
          // Stats placeholder
          views: 0, views7d: 0, views30d: 0, views90d: 0,
          impressions: 0, impressions7d: 0, impressions30d: 0, impressions90d: 0,
          clickThroughRate: 0, salesConversionRate: 0,
          transactions: 0, transactions7d: 0, transactions30d: 0, transactions90d: 0,
          watchCount: 0,
          questionCount: 0,
        };
      })
    );

    const tradingUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/ws/api.dll"
      : "https://api.ebay.com/ws/api.dll";

    // Fetch watch data and all three analytics windows in parallel
    const listingIds = listings.map((l: any) => l.listingId).filter(Boolean) as string[];
    console.log(`ebay-listings: Found ${listingIds.length} listings with IDs for analytics lookup: ${listingIds.slice(0, 3).join(", ")}${listingIds.length > 3 ? "..." : ""}`);
    
    const [watchMap, { a7, a30, a90 }] = await Promise.all([
      fetchWatchDataForListings(listingIds, tradingUrl, userToken),
      fetchAllAnalytics(apiBase, ebayHeaders),
    ]);
    
    console.log(`ebay-listings: Analytics merge - a7 ${Object.keys(a7).length} items, a30 ${Object.keys(a30).length} items, a90 ${Object.keys(a90).length} items`);

    const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      const baseUrl = `https://www.ebay.com/itm/${listingId}`;
      if (!epnCampaignId) return baseUrl;
      return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${epnCampaignId}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
    };

    const enrichedListings = listings.map((l: any) => {
      const w = l.listingId ? (watchMap[l.listingId] || null) : null;
      return {
        ...l,
        ...mergeAnalytics(l.listingId, l.sku, a7, a30, a90),
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