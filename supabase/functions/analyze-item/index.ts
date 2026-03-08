import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Strip data URL prefix if present
    const base64Data = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

    const systemPrompt = `You are an expert eBay listing creator specializing in coins, bullion, precious metals, and general collectibles.

When analyzing an item image, you MUST:

1. **Identify the item** precisely — brand, model, year, material, condition details visible in the photo.

2. **eBay Title** (EXACTLY 80 characters or fewer): Create a professional, SEO-optimized eBay title. Include key identifiers: brand/mint, year, denomination/weight, metal content (if applicable), condition grade, and important keywords buyers search for. Use standard eBay abbreviations where appropriate.

3. **Item Description**: Write a professional, detailed description covering:
   - Exact identification of the item
   - Physical condition based on visible details
   - Metal content and purity (for coins/bullion)
   - Weight and dimensions if determinable
   - Any mint marks, varieties, or notable features
   - Authentication notes if relevant

4. **Pricing**: Provide a realistic price range based on:
   - Recent eBay sold listings for comparable items in similar condition
   - For precious metals: ensure the minimum price is NEVER below the current melt value
   - Current approximate spot prices to reference: Gold ~$2,650/oz, Silver ~$31/oz, Platinum ~$1,000/oz
   - Factor in numismatic/collectible premium above melt value where applicable

Return your analysis using the provided tool.`;

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
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64Data}` },
                },
                {
                  type: "text",
                  text: "Analyze this item for an eBay listing. Identify it precisely, generate a title and description, and provide pricing based on recent sold comps and melt value (if precious metal).",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_listing",
                description:
                  "Create an eBay listing with title, description, and price range",
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
                  },
                  required: ["title", "description", "priceMin", "priceMax"],
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

    // Enforce 80-char title limit
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
