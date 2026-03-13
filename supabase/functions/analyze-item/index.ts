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

5. STRUCTURED ITEM SPECIFICS — BARE KEYS (NO C: PREFIX)
ALL aspect keys in itemSpecifics must use BARE key names — no "C:" prefix. The eBay Inventory API expects plain keys like Fineness, Grade, Year, Certification. The C: prefix only exists in eBay's internal Category Tree taxonomy and must NEVER appear in listing payloads.

ASPECT VALUE FORMATS (strictly enforced):
- Fineness: decimal format ONLY → "0.999", "0.9999", "0.925", "0.900" (NOT "999 fine", "99.9%", "999/1000")
- Grade: space-separated format → "MS 65", "AU 55", "VF 30" (NOT "MS-65", "MS65")
- Denomination (half dollar series): exactly "50C" (NOT "Half Dollar", "50 Cents", "$0.50")
- Denomination (dollar series): exactly "$1" (NOT "One Dollar", "1 Dollar", "$1.00")
- Circulated/Uncirculated: exactly "Circulated", "Uncirculated", or "Unknown"
- Certification: exactly one of "Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"
- Strike Type: exactly one of "Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"
- Shape (bullion): exactly "Bar" or "Round"
- Composition: exactly one of "Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel"

For bullion (bars, rounds, ingots): Type, Shape, Metal, Fineness, Precious Metal Content per Unit, Year, Country of Origin, Brand/Mint, Denomination, Modified Item.
For coins: Type, Year, Denomination, Grade, Circulated/Uncirculated, Mint Location, Country of Origin, Composition, Certification, Strike Type, Fineness, Precious Metal Content per Unit.
For non-coin collectibles: Type, Brand, Material, Color, Size, Country of Origin, Year.
Omit fields that cannot be confidently determined.

6. CATEGORY ROUTING
Primary Rule: Precious metal content ALWAYS overrides theme/brand (e.g., a Disney silver bar goes to Bullion, not Toys).
Shape Rules for Bullion:
- Bar/Ingot/Round (non-legal-tender) → Bars & Rounds subcategory.
- Legal tender coin → Bullion Coins subcategory.
- Named US coinage series → Specific US Coins subcategory.

CORRECT eBay Category IDs — use EXACTLY these values:

PRIORITY CATEGORIES (seller's primary inventory — match these first):
  Gold Bars & Rounds:          178906
  Silver Bars & Rounds:         39489
  Other Silver Bullion:          3361
  Ancient Coins:                  532
  Medieval Coins:              173685
  Eisenhower Dollars (1971-78): 11981
  Morgan Dollars (1878-1921):   39464
  Peace Dollars (1921-35):      11980
  Barber Half Dollars (1892-1915): 11971
  Liberty Walking Half Dollars (1916-47): 41099

FIXED ASPECTS for priority coin categories (do NOT override these — they are enforced server-side):
  Morgan Dollars (39464):          Composition="Silver", Fineness="0.900", Denomination="$1"
  Peace Dollars (11980):           Composition="Silver", Fineness="0.900", Denomination="$1"
  Barber Half Dollars (11971):     Composition="Silver", Fineness="0.900", Denomination="50C"
  Liberty Walking Half (41099):    Composition="Silver", Fineness="0.900", Denomination="50C"
  Gold Bars & Rounds (178906):     Composition="Gold"
  Silver Bars & Rounds (39489):    Composition="Silver"
  Other Silver Bullion (3361):     Composition="Silver"

REQUIRED ASPECTS for priority coin categories (always include these):
  Eisenhower, Morgan, Peace, Barber, Liberty Walking → Certification, Circulated/Uncirculated
  Other Silver Bullion (3361)                        → Certification (default: "Uncertified")

OTHER US COINS (use when no priority category matches):
  American Silver Eagle: 41111
  Kennedy Half Dollar:   40156
  Franklin Half Dollar:  40157
  State Quarters:       164743
  Lincoln Cent:          11116
  American Gold Eagle:   40166
  American Gold Buffalo: 40167
  Susan B. Anthony:      40160
  Sacagawea/Native American Dollar: 40158
  Presidential Dollar:   40159
  Mercury Dime:          40151
  Roosevelt Dime:        40150
  Buffalo Nickel:        40153
  Jefferson Nickel:      40152
  Indian Head Cent:      40154
  Lincoln Wheat Cent:    40155
  Washington Quarter:    40149
  $20 Double Eagle:      40161
  $10 Eagle:             40162
  $5 Half Eagle:         40163
  $2.50 Quarter Eagle:   40164
  $1 Gold:               40165
  US Coins General:        253

WORLD COINS: 45243
BULLION — Coins // Bars & Rounds:
  Silver:   261068 // 261069
  Gold:     261064 // 261071
  Platinum: 261070 // 261072
  Palladium: 261073

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
                        "The most specific eBay category ID. Priority categories: Gold Bars/Rounds=178906, Silver Bars/Rounds=39489, Other Silver Bullion=3361, Ancient Coins=532, Medieval Coins=173685, Eisenhower Dollars=11981, Morgan Dollars=39464, Peace Dollars=11980, Barber Half Dollars=11971, Liberty Walking Half=41099. Other: Silver Eagle=41111, Kennedy Half=40156, Gold Eagle=40166, Gold Buffalo=40167, US Coins General=253, World Coins=45243.",
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
                      description: "Key-value pairs of eBay item specifics. ALL coin/bullion aspect keys MUST use the 'C:' prefix (e.g., 'C:Fineness', 'C:Grade'). Exception: Type, Brand, Material, Color, Size, Mintage, Series, Modified Item, Mint Mark do NOT get C: prefix.",
                      properties: {
                        // --- Metadata fields (not sent as eBay aspects, used for listing context) ---
                        Type: { type: "string", description: "Product type (e.g., 'Bullion Coin', 'Bar', 'Round', 'Medal', 'Coin')" },
                        Series: { type: "string", description: "Series or theme name (e.g., 'Disney', 'Star Wars')" },
                        "Modified Item": { type: "string", description: "Whether item has been modified — almost always 'No'" },
                        Mintage: { type: "string", description: "Total mintage/edition size if known (e.g., '250', '5000')" },
                        "Mint Mark": { type: "string", description: "Mint mark on the coin (e.g., 'P', 'D', 'S', 'W', 'CC', 'O', 'None')" },
                        Brand: { type: "string", description: "Brand name for non-coin items" },
                        Material: { type: "string", description: "Material for non-coin items" },

                        // --- eBay aspect fields — BARE keys, NO C: prefix ---
                        Year: { type: "string", description: "Year of manufacture/minting (e.g., '2025')" },
                        Metal: { type: "string", description: "Primary precious metal (e.g., 'Silver', 'Gold', 'Platinum', 'Palladium')" },
                        Fineness: { type: "string", description: "Fineness as decimal ONLY: '0.999', '0.9999', '0.9675', '0.925', '0.900' — never '999 fine' or '99.9%'" },
                        Composition: { type: "string", enum: ["Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel", "Steel", "Zinc"], description: "Metal composition — must match allowed values exactly" },
                        "Precious Metal Content per Unit": { type: "string", description: "Metal weight per piece (e.g., '1 Troy oz', '1/2 Troy oz', '1/4 Troy oz', '1 g')" },
                        "Country of Origin": { type: "string", description: "Country that issued or manufactured the item" },
                        Grade: { type: "string", description: "Coin grade with SPACE separator: 'MS 65', 'AU 55', 'VF 30' — never 'MS-65' or 'MS65'" },
                        Denomination: { type: "string", description: "Face value: half-dollar series use '50C'; dollar series use '$1'; other denominations as shown on coin" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated", "Unknown"], description: "Circulation status — must be exactly one of the three allowed values" },
                        Certification: { type: "string", enum: ["Uncertified", "PCGS", "NGC", "ANACS", "ICG", "CAC"], description: "Grading certification — default to 'Uncertified' if no slab visible" },
                        "Strike Type": { type: "string", enum: ["Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte"], description: "Type of strike — use 'Business' for standard circulation strikes" },
                        Shape: { type: "string", enum: ["Bar", "Round"], description: "Bullion physical form — must be exactly 'Bar' or 'Round'" },
                        "Mint Location": { type: "string", description: "Mint facility (e.g., 'Philadelphia', 'Denver', 'San Francisco', 'West Point', 'Carson City', 'New Orleans')" },
                        "Brand/Mint": { type: "string", description: "Who made/minted bullion (e.g., 'New Zealand Mint', 'Perth Mint', 'APMEX', 'Scottsdale Mint')" },
                        "KM Number": { type: "string", description: "Krause-Mishler catalog number for ancient/medieval/world coins" },
                        Era: { type: "string", description: "Historical era for ancient/medieval coins (e.g., 'Byzantine', 'Roman Imperial', 'Medieval')" },
                        "Cleaned/Uncleaned": { type: "string", description: "Whether ancient/medieval coin has been cleaned" },
                        Provenance: { type: "string", description: "Known provenance or collection history for ancient/medieval coins" },
                        Variety: { type: "string", description: "Die variety or VAM designation if known" },
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
