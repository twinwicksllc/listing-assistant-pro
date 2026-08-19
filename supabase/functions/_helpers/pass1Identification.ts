import { GEMINI_HEAVY_MODEL } from "./geminiModels.ts";

// Canonical 12-domain type lives in agent-system/pipelineContracts.ts.
// Re-export it so there is a single source of truth for Domain across the
// entire pipeline (Pass 1, registry, controller, prompts, detail extraction).
export type Domain =
  | "coins_bullion"
  | "trading_cards"
  | "jewelry"
  | "electronics"
  | "vintage_clothing"
  | "auto_parts"
  | "sneakers"
  | "luxury_handbags"
  | "musical_instruments"
  | "toys_collectibles"
  | "home_garden_tools"
  | "general";

export interface Identification {
  domain: Domain;
  itemName: string;
  keywords: string[];
  isMetal: boolean;
  metalType: "gold" | "silver" | "platinum" | "palladium" | "none";
}

function parseImageDataUrl(dataUrl: string) {
  const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  return { base64Data, mimeType };
}

const DEFAULT_IDENTIFICATION: Identification = {
  domain: "general",
  itemName: "item",
  keywords: [],
  isMetal: false,
  metalType: "none",
};

export async function runPass1Identification(
  apiKey: string,
  imageList: string[],
  voiceNote: string,
  invocationId: string,
): Promise<Identification> {
  let identification: Identification = { ...DEFAULT_IDENTIFICATION };

  try {
    // Use ALL images for Pass 1 — critical for items where key details
    // (slab labels, reverses, mint marks) may not appear in the first photo
    const pass1Images = imageList.map((img) => {
      const { base64Data, mimeType } = parseImageDataUrl(img);
      return {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      };
    });

    const pass1VoiceHint = voiceNote ? `\nSeller note: "${voiceNote.slice(0, 200)}"` : "";

    // Dynamic year range so Pass 1 stays accurate in future years without code changes
    const p1Year = new Date().getFullYear();
    const p1RecentYears = [p1Year - 1, p1Year, p1Year + 1, p1Year + 2]
      .filter((y) => y >= 2020)
      .join(", ");

    const pass1Resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GEMINI_HEAVY_MODEL,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `You are an item identification assistant. Examine ALL images carefully as a set and return ONLY valid JSON (no markdown, no code blocks):\n{"domain":"coins_bullion|trading_cards|jewelry|electronics|vintage_clothing|auto_parts|sneakers|luxury_handbags|musical_instruments|toys_collectibles|home_garden_tools|general","itemName":"short descriptive name (max 80 chars — include year, denomination, and series when visible for coins)","keywords":["kw1","kw2","kw3","kw4","kw5"],"isMetal":true|false,"metalType":"gold|silver|platinum|none"}\n\nDOMAIN GUIDE — classify the item into exactly ONE of these 12 domains:\n- coins_bullion: any coin, currency/paper money, bullion bar, bullion round, or precious metal item\n- trading_cards: sports cards, TCG (Pokémon, Magic: The Gathering, Yu-Gi-Oh), non-sports trading cards, card packs/boxes\n- jewelry: rings, watches, necklaces, bracelets, earrings, brooches, loose gemstones, body jewelry\n- electronics: phones, tablets, laptops/PCs, gaming consoles, cameras, audio equipment, headphones, TVs, smart home devices\n- vintage_clothing: apparel, shoes, and fashion accessories — especially vintage, retro, or branded clothing (sneakers with athletic/sport use go to "sneakers" instead)\n- auto_parts: car/truck/motorcycle/ATV parts and accessories — engine components, body panels, wheels/tires, lights, sensors, filters, exhaust, suspension (look for part numbers, fitment data, or vehicle-specific mounting)\n- sneakers: athletic/performance shoes with SKU tags (Nike, Jordan, Adidas, Yeezy, New Balance, etc.) — distinguish from vintage_clothing which covers non-athletic footwear and apparel\n- luxury_handbags: designer handbags, totes, wallets, and leather goods from luxury brands (Louis Vuitton, Chanel, Hermès, Gucci, Prada, Coach, etc.) — distinguish from general bags/purses\n- musical_instruments: guitars, basses, keyboards, drums, wind instruments, string instruments, audio effects pedals, microphones, DJ equipment\n- toys_collectibles: action figures, diecast (Hot Wheels), LEGO, dolls, board games, model kits, Funko Pops, comic books, vintage toys, pop-culture collectibles\n- home_garden_tools: power tools, hand tools, lawn/garden equipment, kitchen appliances, home decor, furniture, hardware, HVAC/plumbing parts for home use (vehicle parts go to "auto_parts" instead)\n- general: anything that does not clearly fit the above — books, art, sporting goods, health/beauty, industrial/MRO supplies, office supplies, miscellaneous\n\nDISAMBIGUATION — when domains overlap, use these rules:\n- Sneakers vs vintage_clothing: athletic/performance shoes with a brand SKU tag (Nike, Jordan, Adidas, etc.) → sneakers. Dress shoes, boots, sandals, or vintage non-athletic footwear → vintage_clothing.\n- Auto_parts vs home_garden_tools: if the part is for a vehicle (car, truck, motorcycle, ATV) → auto_parts. If it is a power tool, hand tool, or lawn/garden equipment → home_garden_tools.\n- Luxury_handbags vs general: branded designer handbags/wallets from recognized luxury houses → luxury_handbags. Unbranded or non-luxury bags/purses → general.\n- Toys_collectibles vs general: items with collectible/character/franchise branding (action figures, LEGO, Funko, diecast, comics) → toys_collectibles. Generic household items → general.\n- Musical_instruments vs electronics: musical instruments and audio gear specifically for music performance/recording (guitars, pedals, mics, DJ gear) → musical_instruments. Consumer audio (headphones, speakers, home theater) → electronics.\n- Jewelry vs general: if the item is wearable personal adornment (ring, necklace, watch, bracelet) → jewelry. Decorative home items → general.\n\nCRITICAL FOR COINS/CARDS IN GRADING SLABS: If the item is in a PCGS, NGC, PSA, BGS, or other certification slab, READ THE PRINTED LABEL TEXT FIRST. The label is the AUTHORITATIVE source for year, denomination, grade, and item identity. Do NOT guess the year from the coin/card face if a label is clearly visible. Common AI error: misreading 2026 as 2020, 2021, or 2024. The digit 6 has a tail curving down-left - it is NOT a 0 or 1. Read each digit on the label individually and carefully.\n\nCRITICAL — TODAY'S YEAR IS ${p1Year}: Coins dated in recent or current years (${p1RecentYears}) ARE REAL government-issued coins. They are NOT novelty, fantasy, replica, or tribute coins. The US Mint and other world mints actively produce coins with these dates. NEVER classify ANY coin — raw/ungraded, in a capsule, or professionally slabbed — as novelty, fantasy, exonumia, or tribute based on its date. Set domain=coins_bullion for all such coins.\n\nFAILED IDENTIFICATION PREVENTION:\n- When in doubt between coins_bullion and general for a round metallic object: choose coins_bullion.\n- For multi-item photos (e.g. several coins, a group of cards): identify the PRIMARY or most prominent item. If it is a lot/group, describe as a group in itemName (e.g. "Mixed US Silver Coin Lot 5 Coins").\n- If images are blurry/unclear, use the seller voice note if provided, otherwise pick the most likely domain from visible context clues.\n- For bullion bars, rounds, or generic silver/gold items: domain=coins_bullion, isMetal=true.\n- Prefer the most specific domain over "general" — only use "general" when no other domain clearly applies.\n- itemName MUST be specific: "1921 Morgan Silver Dollar" not just "coin". "2023 Pokemon Scarlet Base Set Pack" not just "card". "Nike Air Jordan 1 Retro High OG Chicago" not just "shoes".`,
            },
            {
              role: "user",
              content: [
                ...pass1Images,
                {
                  type: "text",
                  text: `Identify this item.${pass1VoiceHint}`,
                },
              ],
            },
          ],
          max_tokens: 150,
        }),
      },
    );

    if (pass1Resp.ok) {
      const pass1Data = await pass1Resp.json();
      const pass1Text = pass1Data.choices?.[0]?.message?.content ?? "";
      console.log(
        `[${invocationId}] PASS 1 raw response (${pass1Text.length} chars):`,
        pass1Text.slice(0, 500),
      );

      if (!pass1Text || pass1Text.trim().length === 0) {
        console.warn(`[${invocationId}] ⚠️  Pass 1 returned empty response`);
      } else {
        try {
          const parsed = JSON.parse(pass1Text);
          if (parsed.domain && parsed.itemName) {
            identification = {
              domain: parsed.domain as Domain,
              itemName: String(parsed.itemName).slice(0, 120),
              keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 7).map(String) : [],
              isMetal: Boolean(parsed.isMetal),
              metalType: (parsed.metalType ??
                "none") as Identification["metalType"],
            };
            console.log(
              `[${invocationId}] ✓ Pass 1 identification succeeded:`,
              identification,
            );
          } else {
            console.warn(
              `[${invocationId}] ⚠️  Pass 1 JSON missing domain or itemName:`,
              parsed,
            );
          }
        } catch (jsonParseErr) {
          // Try to extract JSON from the text (Gemini sometimes wraps it)
          const jsonMatch = pass1Text.match(/\{[\s\S]*"domain"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.domain && parsed.itemName) {
                identification = {
                  domain: parsed.domain as Domain,
                  itemName: String(parsed.itemName).slice(0, 120),
                  keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 7).map(String) : [],
                  isMetal: Boolean(parsed.isMetal),
                  metalType: (parsed.metalType ??
                    "none") as Identification["metalType"],
                };
                console.log(
                  `[${invocationId}] ✓ Pass 1 identification succeeded (extracted from text):`,
                  identification,
                );
              }
            } catch {
              console.error(
                `[${invocationId}] ❌ Pass 1 JSON parse failed (even after extraction):`,
                {
                  error: String(jsonParseErr),
                  raw: pass1Text.slice(0, 200),
                },
              );
            }
          } else {
            console.error(`[${invocationId}] ❌ Pass 1 JSON parse failed:`, {
              error: String(jsonParseErr),
              raw: pass1Text.slice(0, 200),
            });
          }
        }
      }
    } else {
      const errBody = await pass1Resp.text();
      console.warn(
        `[${invocationId}] ⚠️  Pass 1 API returned status ${pass1Resp.status}:`,
        errBody.slice(0, 200),
      );
    }
  } catch (pass1Err) {
    console.warn(
      `[${invocationId}] ❌ Pass 1 fetch/parse failed:`,
      String(pass1Err),
    );
    if (pass1Err instanceof Error) {
      console.warn(`[${invocationId}] Error message:`, pass1Err.message);
    }
  }

  return identification;
}

export function applyVoiceNoteMetalFallback(
  identification: Identification,
  voiceNote: string,
): Identification {
  if (identification.metalType !== "none" || !voiceNote) {
    return identification;
  }

  const noteText = voiceNote.toLowerCase();
  const goldKeywords = /\bgold\b|gold\s+(?:coin|bullion|eagle|bar|leaf)|gold\s+\d+/i;
  const silverKeywords = /\bsilver\b|silver\s+(?:coin|bullion|eagle|bar|oz)|silver\s+\d+/i;
  const platinumKeywords = /\bplatinum\b|platinum\s+(?:coin|bullion|bar)|platinum\s+\d+/i;

  if (goldKeywords.test(noteText)) {
    return { ...identification, metalType: "gold", isMetal: true };
  }
  if (silverKeywords.test(noteText)) {
    return { ...identification, metalType: "silver", isMetal: true };
  }
  if (platinumKeywords.test(noteText)) {
    return { ...identification, metalType: "platinum", isMetal: true };
  }

  return identification;
}
