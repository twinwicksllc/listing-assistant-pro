import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Table initialization deferred - will be created by category-lookup on first use
async function ensureTableExists() {
  // No-op for now - category-lookup will initialize the table
  return;
}

function parseImageDataUrl(dataUrl: string) {
  const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  return { base64Data, mimeType };
}

function computeNextResetAt(resetDay: number | null): string | null {
  if (!resetDay) return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(resetDay, daysInThisMonth);
  const thisMonthDate = new Date(year, month, clampedDay);

  if (thisMonthDate > now) return thisMonthDate.toISOString();

  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const nm = nextMonth % 12;
  const daysInNextMonth = new Date(nextYear, nm + 1, 0).getDate();
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth)).toISOString();
}

serve(async (req: Request) => {
  // IMPORTANT: Handle OPTIONS preflight first, before anything else
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    console.log("analyze-item: parsing body...");
    // Initialize table in background (non-blocking)
    ensureTableExists().catch((e) => console.warn("Table init error:", e));
    // Parse body first (can only call req.json() once)
    const body = await req.json();
    console.log("analyze-item: body parsed, images count =", body.images?.length);

    // --- Server-side usage limit enforcement ---
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    console.log("analyze-item: authHeader present =", !!authHeader);
    let userId: string | null = null;
    let userEmail: string | null = null;

    if (authHeader) {
      console.log("analyze-item: getting user from auth header...");
      const { data: ud } = await svc.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = ud?.user?.id || null;
      userEmail = ud?.user?.email || null;
      console.log("analyze-item: got user, email =", userEmail);
    } else {
      console.warn("analyze-item: NO Authorization header found!");
      console.warn("analyze-item: available headers:", Array.from(req.headers.keys()));
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin emails always get unlimited access
    const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];
    const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;
    console.log("analyze-item: user email =", userEmail, "isAdmin =", isAdmin);

    // --- eBay Account Gate for Free Users (OQ-1: require eBay for Starter) ---
    // Check subscription status via Stripe to determine tier (skip for admins)
    let tier: "starter" | "pro" | "unlimited" = isAdmin ? "unlimited" : "starter";
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!isAdmin && STRIPE_SECRET_KEY && userEmail) {
      try {
        const { default: Stripe } = await import("https://esm.sh/stripe@18.5.0");
        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
        const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
        if (customers.data.length > 0) {
          const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
          if (subs.data.length > 0) {
            const productId = subs.data[0].items.data[0].price.product;
            if (productId === "prod_U70aT1KvuI2uDx") {
              tier = "unlimited";
            } else if (productId === "prod_U6zUiC1SYuPrGU") {
              tier = "pro";
            }
          }
        }
      } catch (stripeErr) {
        console.error("Stripe check failed, defaulting to free tier:", stripeErr);
      }
    }

    // eBay account gate for Starter users
    if (tier === "starter") {
      const { data: profile } = await svc
        .from("profiles")
        .select("ebay_access_token")
        .eq("id", userId)
        .single();

      if (!profile?.ebay_access_token) {
        return new Response(
          JSON.stringify({
            error: "ebay_account_required",
            message: "Connect an eBay account to start generating listings.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // --- Per-Org Rolling-Window Quota (OQ-4, OQ-2: anchor at account creation) ---
    let orgId: string | null = null;
    let orgResetDay: number | null = null;
    let currentUsageCount = 0;

    if (tier === "starter") {
      const { data: orgMember } = await svc
        .from("org_members")
        .select("org_id, organizations(free_tier_reset_day)")
        .eq("user_id", userId)
        .limit(1);

      if (orgMember && orgMember.length > 0) {
        orgId = orgMember[0].org_id;
        orgResetDay = (orgMember[0].organizations as any)?.free_tier_reset_day ?? null;
      }
    }

    // Compute rolling-window start for Starter; calendar month for Pro/Unlimited
    let windowStart: string;
    if (tier === "starter") {
      if (orgResetDay) {
        const { data: wsData, error: wsErr } = await svc
          .rpc("get_free_tier_window_start", { p_reset_day: orgResetDay });
        windowStart = wsData ? new Date(wsData).toISOString() : new Date().toISOString();
      } else {
        // Fresh start for NULL reset_day (existing users pre-migration)
        windowStart = new Date().toISOString();
      }
    } else {
      // Pro/Unlimited: calendar month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      windowStart = startOfMonth.toISOString();
    }

    // Count per-org usage for Starter; per-user for Pro/Unlimited
    if (tier !== "unlimited") {
      let countQuery = svc
        .from("usage_tracking")
        .select("*", { count: "exact", head: true })
        .eq("action_type", "ai_analysis")
        .gte("created_at", windowStart);

      if (tier === "starter" && orgId) {
        countQuery = countQuery.eq("org_id", orgId);
      } else if (tier === "pro") {
        countQuery = countQuery.eq("user_id", userId);
      }

      const { count, error: countErr } = await countQuery;

      const ANALYSIS_LIMIT = tier === "pro" ? 50 : 6; // OQ-10: 6 not 5
      currentUsageCount = count ?? 0;

      if (countErr) {
        console.error("Usage count query failed:", countErr);
      } else if (currentUsageCount >= ANALYSIS_LIMIT) {
        const upgradeMsg = tier === "pro"
          ? `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Unlimited for no limits.`
          : `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Pro or Unlimited for more.`;
        const resetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;
        return new Response(
          JSON.stringify({
            error: upgradeMsg,
            creditsUsed: currentUsageCount,
            creditsRemaining: 0,
            creditsResetAt: resetAt,
            tier,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // --- End usage limit enforcement ---

    // --- Fetch live spot prices from shared DB cache ---
    let spotGold = 5200, spotSilver = 89, spotPlatinum = 2200;
    try {
      const { data: spotData, error: spotErr } = await svc
        .from("spot_price_cache")
        .select("gold, silver, platinum, fetched_at")
        .eq("id", 1)
        .single();

      if (!spotErr && spotData) {
        const ageMinutes = (Date.now() - new Date(spotData.fetched_at).getTime()) / 60000;
        if (ageMinutes < 720) {
          // Use DB cache if less than 12 hours old (spot-prices function refreshes every 12 hours)
          spotGold = Number(spotData.gold) || spotGold;
          spotSilver = Number(spotData.silver) || spotSilver;
          spotPlatinum = Number(spotData.platinum) || spotPlatinum;
        } else {
          // Cache is stale — trigger a refresh via spot-prices function
          const spotResp = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/spot-prices`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            }
          );
          if (spotResp.ok) {
            const spotJson = await spotResp.json();
            spotGold = spotJson.spotPrices?.gold || spotGold;
            spotSilver = spotJson.spotPrices?.silver || spotSilver;
            spotPlatinum = spotJson.spotPrices?.platinum || spotPlatinum;
          }
        }
      }
    } catch (spotFetchErr) {
      console.warn("Spot price fetch failed, using fallback:", spotFetchErr);
    }
    // --- End spot prices ---

    // --- Fetch competitor prices (actual sold listings) for market analysis ---
    let competitorData: any = null;
    const title: string = body.title || "";
    const yourPrice: number = body.yourPrice || 0;
    
    if (title && userId) {
      try {
        console.log("analyze-item: fetching competitor prices for item analysis...");
        const competitorResp = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-competitor-search`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId,
              title,
              yourPrice,
            }),
          }
        );

        if (competitorResp.ok) {
          competitorData = await competitorResp.json();
          console.log("analyze-item: competitor data retrieved", {
            competitorCount: competitorData?.competitorCount,
            avgPrice: competitorData?.avgPrice,
            minPrice: competitorData?.minPrice,
            maxPrice: competitorData?.maxPrice,
            fromCache: competitorData?.fromCache,
          });
        } else {
          console.warn("analyze-item: competitor search failed:", competitorResp.status);
        }
      } catch (compErr) {
        console.warn("analyze-item: competitor fetch error (non-blocking):", compErr);
      }
    }
    // --- End competitor prices ---

    // Support both single image (legacy) and multiple images
    const imageList: string[] = body.images ?? (body.imageBase64 ? [body.imageBase64] : []);
    const voiceNote: string = body.voiceNote || "";

    if (imageList.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const systemPrompt = `You are a professional Numismatist and eBay Listing Expert. Your task is to analyze coin/bullion photos and generate a listing via the \`create_listing\` tool.

### CORE OPERATING RULES
1. HOLISTIC ANALYSIS: Treat all uploaded images as a single item.
2. ZERO SPECULATION: Use ONLY visible evidence + factual numismatic data. If a mint mark or date is not visible, state "uncertain" or "not visible."
3. NO NUMERICAL GRADING: For uncertified coins, use ONLY descriptive terms (e.g., "Circulated," "Excellent Luster"). Numerical grades (MS-65, etc.) are strictly forbidden unless the coin is in a PCGS, NGC, ANACS, ICG, CAC, or ICCS slab.
4. EBAY COMPLIANCE: Title must be ≤ 80 chars. Do not use hype words like "L@@K."

### IDENTIFICATION & DESCRIPTION
- Identify: Year, Series, Denomination, Mint Mark, Metal, Weight (Troy Oz), and Producer.
- Key Dates: Highlight rarity (e.g., 1893-S Morgan, 1916-D Mercury).
- Condition Mapping:
  - MS-60+ or Slabbed -> NEW
  - AU/XF -> USED_EXCELLENT
  - VF -> USED_VERY_GOOD
  - F/VG -> USED_GOOD
  - G -> USED_ACCEPTABLE
  - Damaged/Holed -> FOR_PARTS_OR_NOT_WORKING

### DATA FORMATTING (STRICT)
- Fineness: Decimal only (e.g., "0.999").
- Grade: Space-separated (e.g., "MS 65"). Omit Grade field if uncertified.
- Denomination: "50C" or "$1" only.
- Item Specifics: Use bare keys (e.g., "Year", not "C:Year").

### CATEGORY ROUTING (Priority IDs)
- Morgan Dollars: 39464 | Peace Dollars: 11980 | Silver Bars/Rounds: 39489
- Barber Half: 11971 | Liberty Walking Half: 41099 | Eisenhower: 11981
- Gold Bars: 178906 | Silver Eagle: 41111 | Wheat Penny: 39455
- World Coins: 45243 (Required: Materials sourced from = Issuing Country).
- VERIFICATION: If confidence <95% or not listed above, use \`google_search\` for "eBay leaf category ID [Item Name]".

### PRICING LOGIC
- Floor: (Melt Value * 1.19) to cover eBay fees (approx 16%).
- Premium: 1.05-1.15x for generic bullion; 1.5x+ for themes/key dates.
- metalWeightOz: Express in TROY OUNCES only.
- Current spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${spotPlatinum.toFixed(2)}/oz
${competitorData && !competitorData.error
  ? `- MARKET DATA (${competitorData.competitorCount || 0} similar sold): avg $${(competitorData.avgPrice || 0).toFixed(2)}, range $${(competitorData.minPrice || 0).toFixed(2)}-$${(competitorData.maxPrice || 0).toFixed(2)}, median $${(competitorData.medianPrice || 0).toFixed(2)}. USE AS PRIMARY PRICING REFERENCE.`
  : `- No recent sold comps available. Use melt floor and category premiums.`}

Use the \`create_listing\` tool to return the final structured data.`;


    // Build content array with all images + text prompt
    const contentParts: any[] = imageList.map((img) => {
      const { base64Data, mimeType } = parseImageDataUrl(img);
      return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      };
    });

    let userText = `I've provided ${imageList.length} photo${imageList.length > 1 ? "s" : ""} of the same item from different angles. Analyze all photos together to identify the item precisely, generate a title and description, extract eBay item specifics, determine the correct eBay category ID, and provide pricing based on recent sold comps and melt value (if precious metal).`;

    if (voiceNote) {
      userText += `\n\nSELLER'S VOICE NOTE (treat as authoritative — override visual assessment where applicable):
The seller recorded the following about this item. Follow these rules:
- If the seller mentions specific flaws NOT visible in photos: include them in description and adjust grade/condition downward accordingly.
- If the seller mentions cleaning, damage, repairs, or alterations: disclose in description and lower condition.
- If the seller mentions provenance, purchase history, or authentication details: include in description.
- If the seller mentions packaging, accessories, certificates, or extras: note them in description.
- If the seller's assessment contradicts your visual grade (e.g., they say "heavily worn" but photos look better): trust the seller.

Seller's note: "${voiceNote}"`;
    }

    contentParts.push({
      type: "text",
      text: userText,
    });

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: contentParts },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_listing",
                description: "Generates a structured eBay listing payload for coins and collectibles.",
                parameters: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "SEO-optimized eBay title, max 80 chars. Format: [Year] [Country] [Denomination] [Series/Design] [Metal] [Weight] [Condition/Grade]",
                    },
                    categoryId: {
                      type: "string",
                      description: "Key IDs: Gold Bars/Rounds=178906, Silver Bars/Rounds=39489, Other Silver Bullion=3361, Ancient Coins=532, Medieval Coins=173685, Eisenhower Dollars=11981, Morgan Dollars=39464, Peace Dollars=11980, Barber Half=11971, Liberty Walking Half=41099, Kennedy Half=41102, Franklin Half=11973, Silver Eagle=41111, Wheat Penny=39455, Copper Rounds=166679, Gold Eagle=40166, Gold Buffalo=40167, US Proof Sets=41109, US Mint Sets=526, World Coins=45243.",
                    },
                    condition: {
                      type: "string",
                      enum: ["NEW", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"],
                    },
                    description: { type: "string" },
                    price: {
                      type: "object",
                      properties: {
                        amount: { type: "number" },
                        currency: { type: "string", default: "USD" },
                      },
                      required: ["amount"],
                    },
                    itemSpecifics: {
                      type: "object",
                      properties: {
                        Certification: { type: "string", enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"] },
                        Grade: { type: "string", description: "Only if NOT Uncertified. Format: 'MS 65'" },
                        Year: { type: "string" },
                        "Mint Location": { type: "string" },
                        Denomination: { type: "string" },
                        Composition: { type: "string", enum: ["Gold", "Silver", "Platinum", "Palladium", "Copper", "Nickel", "Steel", "Zinc", "Brass", "Aluminum", "Bimetallic", "Copper-Nickel", "Bronze"] },
                        Fineness: { type: "string" },
                        "Strike Type": { type: "string", enum: ["Business", "Proof", "Proof-Like", "Satin"] },
                        Variety: { type: "string", description: "VAM number (e.g., 'VAM-1A')" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated", "Unknown"] },
                        "Mint Mark": { type: "string" },
                        "Brand/Mint": { type: "string" },
                        "Country of Origin": { type: "string" },
                        "Materials sourced from": { type: "string" },
                        "Precious Metal Content per Unit": { type: "string" },
                      },
                      required: ["Certification", "Year", "Composition"],
                      additionalProperties: true,
                    },
                    pricingNotes: { type: "string" },
                    isSlabbed: { type: "boolean" },
                    metalType: { type: "string", enum: ["gold", "silver", "platinum", "none"] },
                    metalWeightOz: { type: "number" },
                  },
                  required: ["title", "categoryId", "condition", "description", "price", "itemSpecifics", "isSlabbed"],
                  additionalProperties: false,
                },
              },
            },
            {
              type: "function",
              function: {
                name: "google_search",
                description: "Search Google for eBay category IDs, coin specifications, or other research. Use when uncertain about a coin's correct eBay category ID.",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Search query (e.g., 'eBay category ID Kennedy Half Dollar 1964', 'copper round eBay category bullion')",
                    },
                  },
                  required: ["query"],
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "create_listing" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const usage = data.usage;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    // Log Gemini token usage (reuse svc and userId from above)
    try {
      await svc.from("gemini_usage").insert({
        user_id: userId,
        function_name: "analyze-item",
        model: "gemini-flash-latest",
        prompt_tokens: usage?.prompt_tokens || 0,
        completion_tokens: usage?.completion_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
      });
    } catch (logErr) {
      console.error("Failed to log gemini usage:", logErr);
    }

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured listing data");
    }

    const listing = JSON.parse(toolCall.function.arguments);

    // Normalize new schema field names to legacy equivalents for frontend compatibility
    if (listing.categoryId && !listing.ebayCategoryId) {
      listing.ebayCategoryId = listing.categoryId;
    }
    if (listing.price?.amount !== undefined && listing.priceMin === undefined) {
      listing.priceMin = listing.price.amount;
      listing.priceMax = listing.price.amount;
    }

    if (listing.title && listing.title.length > 80) {
      // Truncate at last complete word within 80 chars to avoid cutting mid-word
      listing.title = listing.title.substring(0, 80).replace(/\s+\S*$/, "").trim();
    }

    // --- Build suggestedCategories (dedupe, backfill names via exact DB lookup) ---
    try {
      const { buildSuggestedCategories } = await import("./_helpers/suggestedCategories.ts");
      listing.suggestedCategories = await buildSuggestedCategories(listing, svc);
    } catch (suggestErr) {
      console.warn("Failed to build suggestedCategories:", suggestErr);
      // keep whatever AI returned
    }
    // --- end suggestedCategories processing ---

    // --- Server-side melt value enforcement ---
    let meltValue: number | null = null;
    if (listing.metalType && listing.metalType !== "none" && listing.metalWeightOz > 0) {
      const spotPrice =
        listing.metalType === "gold" ? spotGold :
        listing.metalType === "silver" ? spotSilver :
        listing.metalType === "platinum" ? spotPlatinum : 0;
      if (spotPrice > 0) {
        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value PLUS eBay fees.
        // ~13.25% FVF + ~2.9% payment processing = ~16% total fees. Use 1.19x for margin.
        const feeAdjustedFloor = parseFloat((meltValue * 1.19).toFixed(2));
        if (listing.priceMin < feeAdjustedFloor) {
          console.warn(`priceMin ${listing.priceMin} below fee-adjusted melt floor ${feeAdjustedFloor} (melt: ${meltValue}) — correcting`);
          listing.priceMin = feeAdjustedFloor;
          // Also bump priceMax if it's somehow below the floor
          if (listing.priceMax < feeAdjustedFloor) {
            listing.priceMax = parseFloat((feeAdjustedFloor * 1.1).toFixed(2));
          }
        }
      }
    }
    // --- End melt value enforcement ---

    // Track this analysis for rate limiting (increment usage counter)
    // OQ-4: Insert org_id for per-org quotas (or NULL for non-Starter users)
    try {
      await svc.from("usage_tracking").insert({
        user_id: userId,
        action_type: "ai_analysis",
        org_id: tier === "starter" ? orgId : null,
      });
    } catch (trackErr) {
      console.error("Failed to track usage:", trackErr);
    }

    // --- Apply Starter-tier field allowlist (OQ-1: broad tier) ---
    const FREE_TIER_ALLOWED_FIELDS = new Set([
      "title", "description", "condition", "conditionDescription",
      "ebayCategoryId", "suggestedCategories",
      "itemSpecifics",
      "suggestedGrade", "packageWeightAndSize",
      // Locked to paid: priceMin, priceMax, meltValue, spotPrices, pricingNotes, gradingRationale, competitors
    ]);

    let responsePayload = { ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } };
    if (tier === "starter") {
      responsePayload = Object.fromEntries(
        Object.entries(responsePayload).filter(([k]) => FREE_TIER_ALLOWED_FIELDS.has(k))
      );
      // Also scrub grading rationale if nested
      if ((responsePayload as any).itemSpecifics?.gradingRationale) {
        delete (responsePayload as any).itemSpecifics.gradingRationale;
      }
    }

    // --- Annotate all responses with credit metadata ---
    const creditsUsed = currentUsageCount + 1;
    const creditsRemaining = tier === "starter"
      ? Math.max(0, 6 - creditsUsed)
      : tier === "pro"
        ? Math.max(0, 50 - creditsUsed)
        : null;
    const creditsResetAt = tier === "starter" ? computeNextResetAt(orgResetDay) : null;

    const finalResponse = {
      ...responsePayload,
      _meta: {
        tier,
        creditsUsed: creditsUsed,
        creditsRemaining: creditsRemaining,
        creditsResetAt: creditsResetAt,
      },
    };

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-item error:", e);
    if (e instanceof Error) {
      console.error("Error message:", e.message);
      console.error("Error stack:", e.stack);
    }
    const errorMsg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
