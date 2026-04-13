import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface OptimizeListing {
  listingId: string;
  title: string;
  currentPrice: number;
  description?: string;
  categoryId?: string | null;
  listingDate?: string | null;
  condition?: string | null;
}

interface MarketData {
  soldCount: number;
  activeCount: number;
  avgSoldPrice: number | null;
  minSoldPrice: number | null;
  maxSoldPrice: number | null;
  avgActivePrice: number | null;
  minActivePrice: number | null;
  maxActivePrice: number | null;
  sellThroughRate: number;
  competitionLevel: "low" | "medium" | "high";
  demandSignal: "weak" | "moderate" | "strong";
}

interface PriceSuggestion {
  suggestedPrice: number | null;
  reasoning: string;
  direction: "lower" | "raise" | "keep";
  confidence: "low" | "medium" | "high";
  estimatedImpact: string;
}

interface TitleSuggestion {
  suggestedTitle: string | null;
  reasoning: string;
  issuesFound: string[];
  confidence: "low" | "medium" | "high";
}

interface DescriptionSuggestion {
  suggestedDescription: string | null;
  reasoning: string;
  issuesFound: string[];
  confidence: "low" | "medium" | "high";
}

export interface OptimizeListingResult {
  listingId: string;
  opportunityScore: number;
  flags: OptimizationFlag[];
  priceSuggestion: PriceSuggestion;
  titleSuggestion: TitleSuggestion;
  descriptionSuggestion: DescriptionSuggestion;
  market: MarketData | null;
}

// ----------------------------------------------------------------
// Get OAuth App Token for Browse API
// ----------------------------------------------------------------
async function getEbayAppToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("eBay API credentials not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  if (!resp.ok) throw new Error(`Failed to get eBay token: ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}

// ----------------------------------------------------------------
// Fetch market data for a listing via keyword-research function
// ----------------------------------------------------------------
async function fetchMarketData(
  title: string,
  categoryId?: string | null,
): Promise<MarketData | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  try {
    // Call the keyword-research function internally
    const resp = await fetch(`${supabaseUrl}/functions/v1/keyword-research`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: title, categoryId }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn(`[optimize-listing] keyword-research error: ${resp.status}`);
      return null;
    }

    let data: any;
    try {
      const respText = await resp.text();
      data = JSON.parse(respText);
    } catch {
      console.warn(`[optimize-listing] keyword-research JSON parse error`);
      return null;
    }
    if (data.error) return null;

    return {
      soldCount: data.soldCount ?? 0,
      activeCount: data.activeCount ?? 0,
      avgSoldPrice: data.avgSoldPrice ?? null,
      minSoldPrice: data.minSoldPrice ?? null,
      maxSoldPrice: data.maxSoldPrice ?? null,
      avgActivePrice: data.avgActivePrice ?? null,
      minActivePrice: data.minActivePrice ?? null,
      maxActivePrice: data.maxActivePrice ?? null,
      sellThroughRate: data.sellThroughRate ?? 0,
      competitionLevel: data.competitionLevel ?? "medium",
      demandSignal: data.demandSignal ?? "moderate",
    };
  } catch (e) {
    console.warn(`[optimize-listing] fetchMarketData error: ${e}`);
    return null;
  }
}

// ----------------------------------------------------------------
// Generate price suggestion based on market data
// ----------------------------------------------------------------
function buildPriceSuggestion(
  listing: OptimizeListing,
  market: MarketData,
): PriceSuggestion {
  const { currentPrice } = listing;
  const {
    avgSoldPrice,
    avgActivePrice,
    minActivePrice,
    sellThroughRate,
    competitionLevel,
  } = market;

  // Primary target: avg sold price (most meaningful benchmark)
  // Fallback: avg active price from competitors
  const target = avgSoldPrice ?? avgActivePrice;

  if (!target || target <= 0) {
    return {
      suggestedPrice: null,
      reasoning: "Insufficient market data to suggest a price change.",
      direction: "keep",
      confidence: "low",
      estimatedImpact: "Unknown",
    };
  }

  const pctDiff = ((currentPrice - target) / target) * 100;
  const absPctDiff = Math.abs(pctDiff);

  // If price is within 5% of target, no change needed
  if (absPctDiff <= 5) {
    return {
      suggestedPrice: null,
      reasoning: `Your price ($${currentPrice.toFixed(2)}) is within 5% of the market ${
        avgSoldPrice ? "avg sold" : "avg active"
      } price ($${target.toFixed(2)}). No change needed.`,
      direction: "keep",
      confidence: "high",
      estimatedImpact: "Minimal",
    };
  }

  // Price is too high
  if (pctDiff > 5) {
    // Suggest dropping to ~2% above market avg (still slightly premium)
    const suggested = Math.round(target * 1.02 * 100) / 100;
    const strBoost = sellThroughRate < 0.3 ? "significantly" : "moderately";

    return {
      suggestedPrice: suggested,
      reasoning: `Your price ($${currentPrice.toFixed(2)}) is ${pctDiff.toFixed(0)}% above the ${
        avgSoldPrice ? "avg sold" : "avg active"
      } price ($${target.toFixed(2)}). Lowering to $${suggested.toFixed(2)} should ${strBoost} improve sell speed.${
        competitionLevel === "high" ? " High competition makes pricing competitively critical." : ""
      }`,
      direction: "lower",
      confidence: absPctDiff > 20 ? "high" : "medium",
      estimatedImpact: absPctDiff > 20 ? "+30–50% sell-through" : "+10–20% sell-through",
    };
  }

  // Price is too low — potential underpricing
  const suggested = Math.round(target * 0.98 * 100) / 100;
  return {
    suggestedPrice: suggested,
    reasoning: `Your price ($${currentPrice.toFixed(2)}) is ${Math.abs(pctDiff).toFixed(0)}% below the ${
      avgSoldPrice ? "avg sold" : "avg active"
    } price ($${target.toFixed(2)}). You may be leaving money on the table. Consider raising to $${
      suggested.toFixed(2)
    }.${market.demandSignal === "strong" ? " Strong demand supports a higher price." : ""}`,
    direction: "raise",
    confidence: absPctDiff > 20 ? "high" : "medium",
    estimatedImpact: `+$${(suggested - currentPrice).toFixed(2)} per sale`,
  };
}

// ----------------------------------------------------------------
// Generate title suggestions based on analysis
// ----------------------------------------------------------------
function buildTitleSuggestion(
  title: string,
  market: MarketData,
): TitleSuggestion {
  const issues: string[] = [];
  const words = title.trim().split(/\s+/);
  const titleLen = title.length;

  // Check length
  if (titleLen < 30) {
    issues.push(
      "Title is too short — eBay gives you 80 characters, use them for better search visibility",
    );
  } else if (titleLen > 80) {
    issues.push(
      "Title exceeds eBay's 80-character limit — it will be truncated",
    );
  }

  // Check for all caps
  if (title === title.toUpperCase() && titleLen > 10) {
    issues.push(
      "Avoid ALL CAPS — it looks spammy and may reduce click-through rate",
    );
  }

  // Check for excessive punctuation/symbols
  const symbolCount = (title.match(/[!@#$%^&*()_+=\[\]{};':"\\|,.<>?]/g) || []).length;
  if (symbolCount > 3) {
    issues.push(
      "Too many special characters — keep punctuation minimal for better readability",
    );
  }

  // Check for filler words
  const fillerWords = [
    "lot",
    "nice",
    "rare",
    "vintage",
    "beautiful",
    "amazing",
    "wow",
    "look",
  ];
  const foundFillers = fillerWords.filter((w) => title.toLowerCase().includes(w));
  if (foundFillers.length > 0) {
    issues.push(
      `Vague filler words detected ("${
        foundFillers.join('", "')
      }"): replace with specific attributes (year, grade, mint mark, color, size, etc.)`,
    );
  }

  // Check for missing key descriptors based on demand
  if (market.competitionLevel === "high" && words.length < 8) {
    issues.push(
      "In a high-competition category, longer titles with more keywords help you stand out in search",
    );
  }

  // Build suggestion
  let suggestedTitle: string | null = null;
  let reasoning = "";

  if (issues.length === 0) {
    reasoning = "Your title looks well-optimized. No major changes needed.";
  } else if (issues.length <= 2) {
    reasoning = `Minor improvements possible: ${issues.length} issue(s) detected.`;
    // Provide a cleaned-up version
    let improved = title.trim();
    // Fix excessive caps (convert to title case if all caps)
    if (improved === improved.toUpperCase() && improved.length > 10) {
      improved = improved.replace(
        /\b\w+/g,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      );
    }
    // If too short, note what to add
    if (titleLen < 40) {
      reasoning += ` Consider adding: condition, key specifications, brand, or model number to reach 60–80 characters.`;
    }
    suggestedTitle = improved !== title ? improved : null;
  } else {
    reasoning =
      `Multiple optimizations needed: ${issues.length} issues detected. Address these to improve search ranking.`;
  }

  return {
    suggestedTitle,
    reasoning,
    issuesFound: issues,
    confidence: issues.length === 0 ? "high" : issues.length <= 2 ? "medium" : "low",
  };
}

// ----------------------------------------------------------------
// Generate description suggestions via LLM (Deno)
// ----------------------------------------------------------------
async function buildDescriptionSuggestion(
  listing: OptimizeListing,
): Promise<DescriptionSuggestion> {
  const currentDesc = listing.description || "";

  // If no description or too short to meaningfully optimize, skip LLM call
  if (!currentDesc || currentDesc.length < 50) {
    return {
      suggestedDescription: null,
      reasoning: "No description to optimize. Add more detail to build buyer trust and improve search ranking.",
      issuesFound: [],
      confidence: "low",
    };
  }

  const issues: string[] = [];

  if (currentDesc.includes("<div") && currentDesc.includes("style=")) {
    issues.push("Description contains heavy HTML styling — many mobile buyers prefer clean, fast-loading text");
  }

  // Check for "wall of text" (long paragraphs without line breaks or bullets)
  const paragraphs = currentDesc.split(/\n\s*\n/);
  const longParagraph = paragraphs.find((p) => p.length > 500);
  if (
    longParagraph &&
    !currentDesc.includes("<li>") &&
    !currentDesc.includes("* ")
  ) {
    issues.push(
      "Description looks like a 'wall of text' — use bullet points and line breaks for better readability",
    );
  }

  // If no issues detected, don't force an optimization
  if (issues.length === 0) {
    return {
      suggestedDescription: null,
      reasoning: "Your description looks well-structured.",
      issuesFound: [],
      confidence: "high",
    };
  }

  // Core improvement logic via LLM — only called if we have issues to fix
  let suggestedDescription: string | null = null;
  const reasoning = "AI has restructured your description with better visual hierarchy, bullet points, and clear sections.";

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY not set");

    // Call Gemini to optimize the description
    const prompt =
      `You are an eBay listing expert. Re-write the following item description to be professional, compelling, and easy to read. 
IMPORTANT RULES:
1. Use bullet points for key features and what is included.
2. Break up long paragraphs into short, 1-2 sentence sections.
3. Use a clear structure: Overview, Key Details, Condition, and Shipping/Handling.
4. Keep it in plain text or very simple HTML (no complex styles).
5. DO NOT invent facts not present in the original text, but do fix spelling/grammar.

CURRENT DESCRIPTION:
"${currentDesc}"

Respond ONLY with the optimized description text.`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (resp.ok) {
      const data = await resp.json();
      suggestedDescription = data.candidates?.[0]?.content?.parts?.[0]?.text ||
        null;
      if (suggestedDescription) {
        reasoning =
          "AI has restructured your description with better visual hierarchy, bullet points, and clear sections.";
      }
    }
  } catch (e) {
    console.error("[optimize-listing] description AI error:", e);
    reasoning = "Could not generate AI suggestion at this time.";
  }

  return {
    suggestedDescription,
    reasoning,
    issuesFound: issues,
    confidence: suggestedDescription ? "medium" : "low",
  };
}

// ----------------------------------------------------------------
// Calculate opportunity score (0-100)
// ----------------------------------------------------------------
function calcOpportunityScore(
  listing: OptimizeListing,
  market: MarketData,
  titleIssues: number,
): number {
  const { currentPrice } = listing;
  const target = market.avgSoldPrice ?? market.avgActivePrice;

  // Price gap component (0-40 points)
  let priceGapScore = 0;
  if (target && target > 0) {
    const pctDiff = Math.abs((currentPrice - target) / target);
    priceGapScore = Math.min(pctDiff * 200, 40); // 20% gap → 40 pts
  }

  // Staleness component (0-30 points)
  let staleScore = 0;
  if (listing.listingDate) {
    const daysActive = Math.floor(
      (Date.now() - new Date(listing.listingDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    staleScore = Math.min((daysActive / 90) * 30, 30); // 90 days → 30 pts
  }

  // STR gap component (0-20 points)
  const strGapScore = (1 - market.sellThroughRate) * 20;

  // Title issues component (0-10 points)
  const titleScore = Math.min(titleIssues * 3, 10);

  return Math.round(priceGapScore + staleScore + strGapScore + titleScore);
}

// ----------------------------------------------------------------
// Determine flags for the listing
// ----------------------------------------------------------------
function buildFlags(
  listing: OptimizeListing,
  market: MarketData,
  priceSuggestion: PriceSuggestion,
  titleIssues: number,
): string[] {
  const flags: string[] = [];

  if (priceSuggestion.direction === "lower") flags.push("overpriced");
  if (priceSuggestion.direction === "raise") flags.push("underpriced");

  if (listing.listingDate) {
    const daysActive = Math.floor(
      (Date.now() - new Date(listing.listingDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (daysActive >= 30) flags.push("stale");
  }

  if (titleIssues >= 2) flags.push("poor_title");

  return flags;
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const listing = body as OptimizeListing;

    if (!listing.listingId || !listing.title || listing.currentPrice == null) {
      return new Response(
        JSON.stringify({
          error: "listingId, title, and currentPrice are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[optimize-listing] Analyzing listing ${listing.listingId}: "${listing.title}" @ $${listing.currentPrice}`,
    );

    // Fetch market data (calls keyword-research internally)
    const market = await fetchMarketData(listing.title, listing.categoryId);

    if (!market) {
      // Return a minimal response with no suggestions if market data unavailable
      return new Response(
        JSON.stringify({
          listingId: listing.listingId,
          opportunityScore: 0,
          flags: [],
          priceSuggestion: {
            suggestedPrice: null,
            reasoning: "Market data temporarily unavailable. Try again in a moment.",
            direction: "keep",
            confidence: "low",
            estimatedImpact: "Unknown",
          },
          titleSuggestion: {
            suggestedTitle: null,
            reasoning: "Market data unavailable — title analysis requires market context.",
            issuesFound: [],
            confidence: "low",
          },
          descriptionSuggestion: {
            suggestedDescription: null,
            reasoning: "Market data unavailable — description analysis skipped.",
            issuesFound: [],
            confidence: "low",
          },
          market: null,
          noData: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build suggestions
    const priceSuggestion = buildPriceSuggestion(listing, market);
    const titleSuggestion = buildTitleSuggestion(listing.title, market);
    const descriptionSuggestion = await buildDescriptionSuggestion(listing);
    const opportunityScore = calcOpportunityScore(
      listing,
      market,
      titleSuggestion.issuesFound.length,
    );
    const flags = buildFlags(
      listing,
      market,
      priceSuggestion,
      titleSuggestion.issuesFound.length,
    );

    console.log(
      `[optimize-listing] Done: score=${opportunityScore}, flags=[${
        flags.join(",")
      }], priceDir=${priceSuggestion.direction}`,
    );

    return new Response(
      JSON.stringify({
        listingId: listing.listingId,
        opportunityScore,
        flags,
        priceSuggestion,
        titleSuggestion,
        descriptionSuggestion,
        market,
        noData: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[optimize-listing] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
