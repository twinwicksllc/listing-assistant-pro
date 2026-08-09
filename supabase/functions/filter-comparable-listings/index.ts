import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ComparableListing {
  itemId: string;
  title: string;
  price: number;
  sellerInfo: {
    name: string;
    rating: number;
    ratingCount: number;
  };
  condition: string;
  shipping: {
    cost: number;
    free: boolean;
    handlingTime: number;
  };
  url: string;
  comparabilityScore: number;
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Extract listing attributes using Gemini AI
// ────────────────────────────────────────────────────────────────────────────
async function extractListingAttributes(
  title: string,
  geminiKey: string,
): Promise<Record<string, string> | null> {
  const prompt = `You are a numismatic expert analyzing eBay coin listings. Extract key attributes from this listing title that affect value comparability.

Title: "${title}"

Return ONLY a JSON object with these fields (use empty string if not found):
{
  "year": "coin year/date (e.g. 1889, 1921-S)",
  "country": "country of origin (e.g. USA, Great Britain)",
  "denomination": "face value (e.g. Morgan Dollar, Peace Dollar, $1)",
  "mintMark": "mint mark if visible (e.g. S, D, CC, O, P)",
  "grade": "grade or condition (e.g. MS-65, XF-40, circulated)",
  "certification": "cert body if present (e.g. PCGS, NGC, ANACS)",
  "specialFeatures": "key dates, varieties, errors etc (e.g. key date, rare variety, VAM)"
}

Examples of critical comparability factors:
- 1889 Philly Morgan ≠ 1889-CC Morgan (different mint = different value)
- MS-65 Morgan ≠ XF-40 Morgan (grade matters enormously)
- 1949-S Franklin ≠ 1949 Franklin (mint mark significant)
- Key dates command premium prices
- Certified vs uncertified can differ significantly

Return ONLY the JSON object, nothing else.`;

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        }),
      },
    );

    if (!resp.ok) {
      console.warn(
        `[filter-comparable-listings] Gemini extraction failed: ${resp.status}`,
      );
      return null;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(
        "[filter-comparable-listings] No JSON found in Gemini response",
      );
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("[filter-comparable-listings] Extraction error:", err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Score competitor comparability using AI
// ────────────────────────────────────────────────────────────────────────────
async function scoreComparability(
  yourAttributes: Record<string, string>,
  competitorTitle: string,
  geminiKey: string,
): Promise<{ score: number; reason: string } | null> {
  const prompt = `You are a numismatic expert comparing coin listings for market comparability.

Your Listing Attributes:
${Object.entries(yourAttributes)
  .map(([k, v]) => `- ${k}: ${v || "(not found)"}`)
  .join("\n")}

Competitor Listing Title: "${competitorTitle}"

Determine if this competitor listing is truly comparable for pricing purposes. Consider:
- Same year/date (or valid comparable range)
- Same country/type
- Same denomination
- Same or very close mint mark
- Similar grade (within 1-2 grades acceptable)
- Same certification status preference

Return ONLY a JSON object:
{
  "score": <0-100, where 100=perfect match, 0=completely different>,
  "reason": "<brief explanation of comparability, e.g. 'Same 1889 Morgan, cert match' or 'Different mint mark CC vs Philly'"
}

Be STRICT: 1889-CC and 1889 Philly are NOT comparable. Different years are NOT comparable.
Only include scores 80+ if truly comparable. Otherwise keep low.

Return ONLY the JSON object.`;

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      },
    );

    if (!resp.ok) {
      console.warn(
        `[filter-comparable-listings] Scoring failed: ${resp.status}`,
      );
      return null;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Number(parsed.score ?? 0),
      reason: String(parsed.reason ?? ""),
    };
  } catch (err) {
    console.error("[filter-comparable-listings] Scoring error:", err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch raw competitor listings from eBay Finding API
// ────────────────────────────────────────────────────────────────────────────
async function fetchRawCompetitors(params: {
  appId: string;
  searchQuery: string;
  categoryId?: string;
  ebayEnv: string;
}): Promise<unknown[]> {
  const { appId, searchQuery, categoryId, ebayEnv } = params;

  const baseUrl =
    ebayEnv === "production"
      ? "https://svcs.ebay.com/services/search/FindingService/v1"
      : "https://svcs.sandbox.ebay.com/services/search/FindingService/v1";

  const queryParams = new URLSearchParams({
    "OPERATION-NAME": "findItemsByKeywords",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    keywords: searchQuery,
    "itemFilter(0).name": "ListingType",
    "itemFilter(0).value": "FixedPrice",
    "itemFilter(1).name": "Condition",
    "itemFilter(1).value(0)": "1000",
    "itemFilter(1).value(1)": "2000",
    "itemFilter(1).value(2)": "2500",
    "itemFilter(1).value(3)": "3000",
    "paginationInput.entriesPerPage": "20",
    "paginationInput.pageNumber": "1",
    sortOrder: "BestMatch",
  });

  if (categoryId) {
    queryParams.set("categoryId", categoryId);
  }

  const url = `${baseUrl}?${queryParams.toString()}`;
  console.log(
    `[filter-comparable-listings] Fetching raw competitors: "${searchQuery}"`,
  );

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    throw new Error(`eBay API error: ${resp.status}`);
  }

  const respText = await resp.text();
  const json = JSON.parse(respText);

  const searchResult =
    json?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0];
  if (!searchResult || searchResult["@count"] === "0") {
    console.log(`[filter-comparable-listings] No results found`);
    return [];
  }

  return searchResult.item ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// Parse eBay seller info from API response
// ────────────────────────────────────────────────────────────────────────────
interface EbayItem {
  itemId?: string[];
  title?: any[];
  sellingStatus?: Array<{ currentPrice?: Array<{ __value__: string }> }>;
  sellerInfo?: Array<{
    sellerUserName?: string[];
    positiveFeedbackPercent?: string[];
    feedbackScore?: string[];
  }>;
  condition?: Array<{ conditionId?: string[] }>;
  shippingInfo?: Array<{ shippingServiceCost?: Array<{ __value__: string }> }>;
  viewItemURL?: string[];
}

function parseEbayItem(item: EbayItem): ComparableListing | null {
  try {
    const itemId = item.itemId?.[0];
    const titleRaw = item.title?.[0];
    const title =
      typeof titleRaw === "string"
        ? titleRaw
        : (titleRaw as any)?.toString?.() || String(titleRaw || "");
    const price = parseFloat(
      item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ ?? "0",
    );
    const sellerName = item.sellerInfo?.[0]?.sellerUserName?.[0] ?? "Unknown";
    const ratingStr = item.sellerInfo?.[0]?.positiveFeedbackPercent?.[0] ?? "0";
    const rating = parseFloat(ratingStr);
    const ratingCount = parseInt(
      item.sellerInfo?.[0]?.feedbackScore?.[0] ?? "0",
    );
    const condition = item.condition?.[0]?.conditionId?.[0] ?? "Unknown";
    const shippingCost = parseFloat(
      item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ ?? "0",
    );
    const url = item.viewItemURL?.[0] ?? "";

    if (!itemId || !title || price <= 0) return null;

    return {
      itemId,
      title,
      price,
      sellerInfo: {
        name: sellerName,
        rating,
        ratingCount,
      },
      condition,
      shipping: {
        cost: shippingCost,
        free: shippingCost === 0,
        handlingTime: 0,
      },
      url,
      comparabilityScore: 0,
      reason: "",
    };
  } catch (err) {
    console.error("[filter-comparable-listings] Parse error:", err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { title, categoryId, userId } = body;

    if (!title) {
      return new Response(JSON.stringify({ error: "title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const ebayAppId = Deno.env.get("EBAY_CLIENT_ID");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    if (!geminiKey || !ebayAppId) {
      return new Response(
        JSON.stringify({ error: "Missing API configuration" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      "[filter-comparable-listings] 1. Extracting listing attributes...",
    );
    const yourAttributes = await extractListingAttributes(title, geminiKey);
    if (!yourAttributes) {
      return new Response(
        JSON.stringify({
          comparable: [],
          reason: "Could not analyze listing attributes",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[filter-comparable-listings] 2. Fetching raw competitors...");
    const rawCompetitors = await fetchRawCompetitors({
      appId: ebayAppId,
      searchQuery: title,
      categoryId,
      ebayEnv,
    });

    if (rawCompetitors.length === 0) {
      return new Response(
        JSON.stringify({
          comparable: [],
          reason: "No competitor listings found",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[filter-comparable-listings] 3. Scoring ${rawCompetitors.length} competitors...`,
    );
    const comparable: ComparableListing[] = [];

    for (const item of rawCompetitors) {
      const parsed = parseEbayItem(item as EbayItem);
      if (!parsed) continue;

      const scoring = await scoreComparability(
        yourAttributes,
        parsed.title,
        geminiKey,
      );
      if (!scoring) continue;

      // Only include if score is 75+
      if (scoring.score >= 75) {
        comparable.push({
          ...parsed,
          comparabilityScore: scoring.score,
          reason: scoring.reason,
        });
      }
    }

    // Sort by score descending, then by price ascending
    comparable.sort((a, b) => {
      if (b.comparabilityScore !== a.comparabilityScore) {
        return b.comparabilityScore - a.comparabilityScore;
      }
      return a.price - b.price;
    });

    // Keep top 15 most comparable
    const topComparable = comparable.slice(0, 15);

    // Log usage if userId provided
    if (userId) {
      try {
        const svc = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } },
        );

        await svc.from("gemini_usage").insert({
          user_id: userId,
          function_name: "filter-comparable-listings",
          model: "gemini-flash-latest",
          prompt_tokens: 0, // Estimate
          completion_tokens: 0,
          total_tokens: 0,
        });
      } catch (logErr) {
        console.warn("[filter-comparable-listings] Usage log failed:", logErr);
      }
    }

    return new Response(
      JSON.stringify({
        comparable: topComparable,
        totalScored: comparable.length,
        reason: `Analyzed ${topComparable.length} truly comparable listings from ${rawCompetitors.length} candidates`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[filter-comparable-listings] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
