import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseImageDataUrl(dataUrl: string) {
  const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  return { base64Data, mimeType };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("analyze-item: parsing body...");
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

    // Count this month's AI analyses from usage_tracking
    if (tier !== "unlimited") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count, error: countErr } = await svc
        .from("usage_tracking")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("action_type", "ai_analysis")
        .gte("created_at", startOfMonth.toISOString());

      const ANALYSIS_LIMIT = tier === "pro" ? 50 : 5;
      const currentCount = count ?? 0;

      if (countErr) {
        console.error("Usage count query failed:", countErr);
      } else if (currentCount >= ANALYSIS_LIMIT) {
        const upgradeMsg = tier === "pro"
          ? `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Unlimited for no limits.`
          : `Monthly analysis limit reached (${ANALYSIS_LIMIT}). Upgrade to Pro or Unlimited for more.`;
        return new Response(
          JSON.stringify({ error: upgradeMsg }),
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

    const systemPrompt = `You are an expert eBay listing analyst, professional numismatist, and collectibles grader specializing in coins, bullion, precious metals, and general collectibles.

You will receive one or more photos of the SAME item from different angles. Analyze ALL images holistically as a single listing subject.

CRITICAL: Use ONLY what is visible in the photos plus reasonable, factual item identification inferences. Do NOT invent, guess, or assume details (e.g., mint marks, weight, purity, denomination, certification numbers, or edition size) that are not visibly supported by the images or standard for that exact identified item. If key details are not visible, state "not visible" or "uncertain."

1. ITEM IDENTIFICATION
Identify the item as precisely as possible. Determine the item type, series, year, denomination, metal content, purity/fineness, mint/manufacturer, country, variety/edition, and certification details (if slabbed).

2. EBAY TITLE (Strictly ≤ 80 characters)
Create ONE SEO-optimized title. Include when applicable: Year, mint/brand, denomination/weight, metal, purity, coin/bar/round type, grade/certification, and key series name. Exclude filler words, hype (e.g., "L@@K"), and unnecessary punctuation. Use standard eBay abbreviations where necessary to save space.

3. ITEM DESCRIPTION
Write a concise, professional, factual description covering:
- Exact item identification.
- Physical condition based strictly on visible evidence (obverse, reverse, edge, holder/packaging).
- Metal content, purity, weight, and dimensions (if visible or reliably inferable).
- Mint marks, varieties, notable features, and authentication notes.

4. GRADING & CONDITION MAPPING

A. Slabbed Coins (Certified)
Set isSlabbed to true ONLY if the item is visibly in a certified grading holder (e.g., PCGS, NGC). Use the exact grade shown on the holder. Condition: CERTIFIED_REFURBISHED.

B. Unslabbed Coins/Collectibles (Visual Grading)
Set isSlabbed to false. Perform a conservative visual grade assessment evaluating: wear on high points, luster presence/breaks, strike sharpness, contact marks/scratches, cleaning/environmental damage, and mint mark clarity. Assign a conservative Sheldon-scale grade (e.g., MS-63, AU-55, XF-45, VF-30) and provide a gradingRationale referencing visible evidence. If photos are insufficient, give a conservative range and explain why.

Condition Code Mapping (output as the "condition" field):
- MS-60 to MS-70 → NEW
- AU-50 to AU-58 → EXCELLENT_REFURBISHED
- XF-40 to XF-45 → EXCELLENT_REFURBISHED
- VF-20 to VF-35 → VERY_GOOD_REFURBISHED
- F-12 to VF-12 → GOOD_REFURBISHED
- VG-8 to VG-10 → GOOD_REFURBISHED
- G-4 to G-6 → FOR_PARTS_OR_NOT_WORKING
- FR or lower → FOR_PARTS_OR_NOT_WORKING
NEVER use "LIKE_NEW" or "PRE_OWNED_*" — these are invalid for coin categories.

5. STRUCTURED ITEM SPECIFICS
Extract structured fields mapped to eBay's required specifics. Always include a "Type" field.

For bullion (bars, rounds, ingots): Type, Shape, Metal, Fineness, Precious Metal Content per Unit, Year, Country/Region of Manufacture, Manufacturer/Mint, Series/Theme, Denomination, Modified Item.
For coins: Type, Year, Denomination, Grade, Circulated/Uncirculated, Coin Type, Mint Location, Country/Region of Manufacture, Composition, Certification, Strike Type, Fineness, Precious Metal Content per Unit.
For non-coin collectibles: Type, Brand, Model, Material, Color, Size, Country/Region of Manufacture, Franchise/Theme/Character, Year.
Omit fields that cannot be confidently determined.

6. CATEGORY ROUTING
Primary Rule: Precious metal content ALWAYS overrides theme/brand (e.g., a Disney silver bar goes to Bullion, not Toys).
Shape Rules for Bullion:
- Bar/Ingot/Round (non-legal-tender) → Bars & Rounds subcategory.
- Legal tender coin → Bullion Coins subcategory.
- Named US coinage series → Specific US Coins subcategory.

Select the most specific ID from this list:
US Coins: 39482 (Morgan), 39483 (Peace), 41111 (Silver Eagle), 39484 (Eisenhower), 164743 (State Quarters), 11116 (Lincoln Cent), 39481 (Walking Liberty), 40156 (Kennedy Half), 40166 (Gold Eagle), 40167 (Gold Buffalo), 253 (US Coins General).
World Coins: 45243.
Bullion (Coins // Bars & Rounds): Silver (261068 // 261069), Gold (261064 // 261071), Platinum (261070 // 261072), Palladium (261073).

7. PRICING GUIDANCE
Price the EXACT item first using this hierarchy: 1. Exact sold comps 2. Same series/mint 3. Key date/rarity premium 4. Grade-adjusted melt floor.

Melt Value Floor: priceMin must NEVER fall below the melt value for precious metals.
Current live spot prices: Gold $${spotGold.toFixed(2)}/oz | Silver $${spotSilver.toFixed(2)}/oz | Platinum $${spotPlatinum.toFixed(2)}/oz

Premium multipliers:
- Generic bullion (plain bar/round, no theme) → 1.05x–1.15x melt
- Popular themes (Disney, Star Wars, sports teams) → 1.5x–4x melt
- Key dates / high-grade certified coins → significant numismatic premium

Return pricingNotes explaining exactly which comparables or logic you used.

Return your analysis using the provided tool.`;

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
      userText += `\n\nIMPORTANT — The seller recorded the following voice note about the item's condition, flaws, or special features. You MUST incorporate this information into the item description and condition assessment:\n\n"${voiceNote}"`;
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
          model: "gemini-2.0-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: contentParts },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_listing",
                description:
                  "Create an eBay listing with title, description, item specifics, category, and price range",
                parameters: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description:
                        "eBay listing title, max 80 characters, SEO-optimized",
                    },
                    description: {
                      type: "string",
                      description:
                        "Professional item description with condition, details, and metal content if applicable",
                    },
                    priceMin: {
                      type: "number",
                      description:
                        "Minimum suggested price in USD. For precious metals: never below melt value. Based on lowest recent sold comp for this specific item or series.",
                    },
                    priceMax: {
                      type: "number",
                      description:
                        "Maximum suggested price in USD. Based on highest recent sold comp for this specific item in this condition. Factor in key date, rarity, theme, and grade premiums.",
                    },
                    pricingNotes: {
                      type: "string",
                      description:
                        "Brief explanation of how you priced this item: what specific comparables or logic you used (e.g., 'Recent eBay solds for 2025 Niue Disney series bars averaged $145-$180. Limited mintage of 250 supports upper range. Melt floor: $89.')",
                    },
                    metalType: {
                      type: "string",
                      enum: ["gold", "silver", "platinum", "none"],
                      description:
                        "Primary precious metal type if the item contains precious metals, or 'none'",
                    },
                    metalWeightOz: {
                      type: "number",
                      description:
                        "Total precious metal weight in troy ounces. Set to 0 if not a precious metal item.",
                    },
                    ebayCategoryId: {
                      type: "string",
                      description:
                        "The most specific eBay category ID for this item (e.g., '41111' for American Silver Eagles)",
                    },
                    suggestedCategories: {
                      type: "array",
                      description: "Top 3 most relevant eBay category suggestions for this item, ordered by best match first. The first entry should match ebayCategoryId.",
                      items: {
                        type: "object",
                        properties: {
                          categoryId: { type: "string", description: "eBay category ID" },
                          categoryName: { type: "string", description: "Human-readable full category path (e.g., 'Coins & Paper Money > Bullion > Silver > Rounds & Medallions')" },
                          reason: { type: "string", description: "One-sentence reason why this category fits (e.g., 'Best match for silver rounds from foreign mints')" },
                        },
                        required: ["categoryId", "categoryName", "reason"],
                      },
                      minItems: 1,
                      maxItems: 3,
                    },
                    itemSpecifics: {
                      type: "object",
                      description: "Key-value pairs of eBay item specifics. Populate ALL applicable fields.",
                      properties: {
                        // --- Type field required by eBay for coin/bullion categories ---
                        Type: { type: "string", description: "Product type for eBay category matching (e.g., 'Bullion Coin', 'Bar', 'Round', 'Medal', 'Coin')" },
                        
                        // --- Universal precious metals fields (coins AND bullion) ---
                        Year: { type: "string", description: "Year of manufacture/minting (e.g., '2025')" },
                        Metal: { type: "string", description: "Primary precious metal (e.g., 'Silver', 'Gold', 'Platinum', 'Palladium')" },
                        Fineness: { type: "string", description: "Fineness/purity of the metal (e.g., '0.999', '0.9999', '0.925')" },
                        Composition: { type: "string", description: "Full composition description (e.g., '.999 Fine Silver', '90% Silver, 10% Copper')" },
                        "Precious Metal Content per Unit": { type: "string", description: "Metal weight per piece (e.g., '1 Troy oz', '1/2 Troy oz', '1/4 Troy oz', '1 g')" },
                        "Country/Region of Manufacture": { type: "string", description: "Country that issued or manufactured the item" },

                        // --- Bullion-specific fields ---
                        Shape: { type: "string", description: "Physical form of the bullion: 'Bar', 'Round', 'Ingot', 'Coin', 'Medal', 'Wafer'" },
                        "Manufacturer/Mint": { type: "string", description: "Who made/minted the item (e.g., 'New Zealand Mint', 'Perth Mint', 'APMEX', 'Scottsdale Mint')" },
                        Series: { type: "string", description: "Series or theme name (e.g., 'Disney', 'Star Wars', 'Marvel', 'Pokemon')" },
                        "Modified Item": { type: "string", description: "Whether item has been modified from original — almost always 'No'" },
                        Denomination: { type: "string", description: "Face value denomination if any (e.g., '2 Dollars', '1 Dollar', '5 Dollars')" },
                        Mintage: { type: "string", description: "Total mintage/edition size if known or visible (e.g., '250', '5000', 'Limited Edition')" },

                        // --- Coin-specific fields ---
                        "Coin/Bullion Type": { type: "string", description: "Specific coin type (e.g., 'American Silver Eagle', 'Morgan Dollar', 'Canadian Maple Leaf')" },
                        "Mint Location": { type: "string", description: "Mint facility (e.g., 'Philadelphia', 'Denver', 'San Francisco', 'West Point')" },
                        "Mint Mark": { type: "string", description: "Mint mark on the coin (e.g., 'P', 'D', 'S', 'W', 'CC', 'O', 'None')" },
                        Grade: { type: "string", description: "Coin grade using Sheldon scale or 'Ungraded' (e.g., 'MS-65', 'VF-30', 'AU-55')" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated"], description: "Whether the coin has been circulated" },
                        Certification: { type: "string", enum: ["PCGS", "NGC", "ANACS", "ICG", "Uncertified"], description: "Grading service certification" },
                        "Strike Type": { type: "string", enum: ["Business Strike", "Proof", "Reverse Proof", "Burnished", "Satin Finish"], description: "Type of strike" },
                        // --- Non-coin/bullion items ---
                        Brand: { type: "string", description: "Brand name for non-coin items" },
                        Material: { type: "string", description: "Material for non-coin items" },
                      },
                      additionalProperties: true,
                    },
                    condition: {
                      type: "string",
                      enum: ["NEW", "LIKE_NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "CERTIFIED_REFURBISHED", "EXCELLENT_REFURBISHED", "VERY_GOOD_REFURBISHED", "GOOD_REFURBISHED", "SELLER_REFURBISHED", "PRE_OWNED_GOOD", "PRE_OWNED_FAIR", "PRE_OWNED_POOR", "FOR_PARTS_OR_NOT_WORKING"],
                      description: "eBay item condition. For coins/bullion: use NEW (uncirculated/MS), CERTIFIED_REFURBISHED (slabbed), EXCELLENT_REFURBISHED (AU/XF), VERY_GOOD_REFURBISHED (VF), GOOD_REFURBISHED (F/VG), or FOR_PARTS_OR_NOT_WORKING (G or poor). DO NOT use LIKE_NEW or PRE_OWNED_* for coins — they are not valid for eBay coin categories. For electronics/general items: use any condition that accurately reflects the item's state.",
                    },
                    suggestedGrade: {
                      type: "string",
                      description: "Sheldon scale grade for unslabbed coins (e.g., 'MS-63', 'AU-55', 'VF-30'). Set to null or empty string for non-coin items or already-slabbed coins.",
                    },
                    gradingRationale: {
                      type: "string",
                      description: "Detailed explanation of why this grade was assigned, referencing specific visual evidence (wear, luster, strikes, marks). Empty for non-coin items.",
                    },
                    isSlabbed: {
                      type: "boolean",
                      description: "True if the coin is already in a certified grading slab (PCGS, NGC, etc.)",
                    },
                  },
                  required: ["title", "description", "priceMin", "priceMax", "pricingNotes", "metalType", "metalWeightOz", "ebayCategoryId", "suggestedCategories", "itemSpecifics", "condition", "suggestedGrade", "gradingRationale", "isSlabbed"],
                  additionalProperties: false,
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
        model: "gemini-2.0-flash",
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

    if (listing.title && listing.title.length > 80) {
      listing.title = listing.title.substring(0, 80);
    }

    // --- Server-side melt value enforcement ---
    let meltValue: number | null = null;
    if (listing.metalType && listing.metalType !== "none" && listing.metalWeightOz > 0) {
      const spotPrice =
        listing.metalType === "gold" ? spotGold :
        listing.metalType === "silver" ? spotSilver :
        listing.metalType === "platinum" ? spotPlatinum : 0;
      if (spotPrice > 0) {
        meltValue = parseFloat((spotPrice * listing.metalWeightOz).toFixed(2));
        // Enforce: priceMin must never be below melt value
        if (listing.priceMin < meltValue) {
          console.warn(`priceMin ${listing.priceMin} below melt value ${meltValue} — correcting`);
          listing.priceMin = meltValue;
          // Also bump priceMax if it's somehow below melt
          if (listing.priceMax < meltValue) {
            listing.priceMax = parseFloat((meltValue * 1.1).toFixed(2));
          }
        }
      }
    }
    // --- End melt value enforcement ---

    return new Response(JSON.stringify({ ...listing, meltValue, spotPrices: { gold: spotGold, silver: spotSilver, platinum: spotPlatinum } }), {
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
