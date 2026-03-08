import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const body = await req.json();

    // Support both single image (legacy) and multiple images
    const imageList: string[] = body.images ?? (body.imageBase64 ? [body.imageBase64] : []);
    const voiceNote: string = body.voiceNote || "";

    if (imageList.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert eBay listing creator AND professional coin grader specializing in coins, bullion, precious metals, and general collectibles.

You will receive one or more photos of the SAME item taken from different angles. Analyze ALL photos together to build a comprehensive understanding.

When analyzing, you MUST:

1. **Identify the item** precisely — brand, model, year, material, condition details visible across all photos.

2. **eBay Title** (EXACTLY 80 characters or fewer): Create a professional, SEO-optimized eBay title. Include key identifiers: brand/mint, year, denomination/weight, metal content (if applicable), condition grade, and important keywords buyers search for. Use standard eBay abbreviations where appropriate.

3. **Item Description**: Write a professional, detailed description covering:
   - Exact identification of the item
   - Physical condition based on visible details from ALL provided photos
   - Metal content and purity (for coins/bullion)
   - Weight and dimensions if determinable
   - Any mint marks, varieties, or notable features
   - Authentication notes if relevant
   - Reference details visible in different photos (obverse, reverse, edge, etc.)

4. **Coin/Collectible Grading** (CRITICAL for unslabbed coins/collectibles):
   If the item is a coin or collectible that is NOT already in a certified grading slab (PCGS, NGC, etc.), you MUST perform a detailed visual grade assessment:
   - **Wear analysis**: Examine high points (cheekbone, eagle breast feathers, hair details, etc.) for signs of friction, flatness, or loss of detail.
   - **Luster assessment**: Evaluate original mint luster — is it full cartwheel luster, partial, or absent? Look for breaks in luster on high points.
   - **Strike quality**: Assess sharpness of design details, especially on weakly-struck areas typical for the coin type.
   - **Surface marks**: Note contact marks, bag marks, hairlines, scratches, or cleaning evidence.
   - **Eye appeal**: Overall visual impression — toning, color, cleanliness.
   - **Mint mark**: Identify and note the mint mark position and clarity.
   
   Assign a Sheldon scale grade (e.g., "MS-63", "AU-55", "VF-30", "XF-45"). Be conservative — grade what you can see. If the coin IS in a slab, use the grade on the slab label.
   
   Provide a detailed grading rationale explaining WHY you assigned that grade, referencing specific visual evidence from the photos.
   
   Set isSlabbed to true ONLY if the coin is visibly encapsulated in a certified holder.

5. **eBay Item Specifics**: You MUST extract structured item specifics that map directly to eBay's required fields. For coins and currency, these include:
   - Year of manufacture
   - Denomination (e.g., "1 Dollar", "25 Cents", "1 oz")
   - Grade (e.g., "MS-65", "VF-30", "Ungraded" — use Sheldon scale if identifiable)
   - Circulated/Uncirculated status
   - Coin type (e.g., "American Silver Eagle", "Morgan Dollar")
   - Mint location (e.g., "Philadelphia", "Denver", "San Francisco")
   - Country/Region of manufacture
   - Composition (e.g., ".999 Silver", "90% Silver", "Copper-Nickel Clad")
   - Certification (e.g., "PCGS", "NGC", "Uncertified")
   - Strike type (e.g., "Business", "Proof")
   For non-coin items, extract any relevant eBay item specifics (Brand, Model, Material, Color, Size, etc.)

6. **eBay Category**: Determine the most specific eBay category ID for the item. Common coin categories:
   - 39482: US Coins > Dollars > Morgan (1878-1921)
   - 39483: US Coins > Dollars > Peace (1921-1935)
   - 41111: US Coins > Dollars > American Silver Eagle
   - 39484: US Coins > Dollars > Eisenhower (1971-1978)
   - 164743: US Coins > Quarters > 50 States & Territories
   - 11116: US Coins > Pennies > Lincoln Memorial (1959-2008)
   - 39481: US Coins > Dollars > Walking Liberty (1916-1947)
   - 261069: Bullion > Silver Bullion > Bars & Rounds
   - 261064: Bullion > Gold Bullion > Coins
   - 261071: Bullion > Gold Bullion > Bars & Rounds
   - 11118: US Coins > Half Dollars
   - 253: US Coins (general)
   - 45243: World Coins
   If uncertain, use the most reasonable parent category.

7. **Pricing**: Provide a realistic price range based on:
   - Recent eBay sold listings for comparable items in similar condition
   - For precious metals: ensure the minimum price is NEVER below the current melt value
   - Current approximate spot prices to reference: Gold ~$2,650/oz, Silver ~$31/oz, Platinum ~$1,000/oz
   - Factor in numismatic/collectible premium above melt value where applicable

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
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-pro-preview",
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
                        "Minimum suggested price in USD (never below melt value for precious metals)",
                    },
                    priceMax: {
                      type: "number",
                      description:
                        "Maximum suggested price in USD based on recent sold comps",
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
                    itemSpecifics: {
                      type: "object",
                      description: "Key-value pairs of eBay item specifics",
                      properties: {
                        Year: { type: "string", description: "Year of manufacture/minting" },
                        Denomination: { type: "string", description: "Coin denomination (e.g., '1 Dollar', '25 Cents', '1 oz')" },
                        Grade: { type: "string", description: "Coin grade using Sheldon scale or 'Ungraded' (e.g., 'MS-65', 'VF-30')" },
                        "Circulated/Uncirculated": { type: "string", enum: ["Circulated", "Uncirculated"], description: "Whether the coin has been circulated" },
                        "Coin/Bullion Type": { type: "string", description: "Specific coin type (e.g., 'American Silver Eagle', 'Morgan Dollar')" },
                        "Mint Location": { type: "string", description: "Where the coin was minted" },
                        "Country/Region of Manufacture": { type: "string", description: "Country of origin" },
                        Composition: { type: "string", description: "Metal composition (e.g., '.999 Silver', '90% Silver')" },
                        Certification: { type: "string", enum: ["PCGS", "NGC", "ANACS", "ICG", "Uncertified"], description: "Grading service certification" },
                        "Strike Type": { type: "string", enum: ["Business", "Proof", "Satin Finish"], description: "Type of strike" },
                        Brand: { type: "string", description: "Brand name for non-coin items" },
                        Material: { type: "string", description: "Material for non-coin items" },
                      },
                      additionalProperties: true,
                    },
                    condition: {
                      type: "string",
                      enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE"],
                      description: "eBay item condition enum value",
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
                  required: ["title", "description", "priceMin", "priceMax", "metalType", "metalWeightOz", "ebayCategoryId", "itemSpecifics", "condition", "suggestedGrade", "gradingRationale", "isSlabbed"],
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
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured listing data");
    }

    const listing = JSON.parse(toolCall.function.arguments);

    if (listing.title && listing.title.length > 80) {
      listing.title = listing.title.substring(0, 80);
    }

    return new Response(JSON.stringify(listing), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-item error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
