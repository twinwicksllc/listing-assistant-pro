import { GEMINI_HEAVY_MODEL } from "./geminiModels.ts";
import { fetchWithTimeout, PIPELINE_TIMEOUTS_MS, type RequestDeadline, withDeadline } from "./fetchWithTimeout.ts";

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

/**
 * Output cap for Pass 1. Raised 150 -> 500 on 2026-09-14, then diagnosed
 * properly on 2026-09-15 -- see PASS1_REASONING_EFFORT below, which is the
 * change that actually fixes the truncation.
 *
 * On this endpoint `max_tokens` bounds reasoning tokens AND visible output
 * together, so raising it alone could never be reliable: it hands the model a
 * bigger budget to think with, not a guaranteed floor for the answer. The 500
 * cap truncated a response at TWENTY-NINE characters
 * (`{"domain":"jewelry","itemName`) the day after it landed -- an answer that
 * short cannot be 500 tokens of output, so ~470 went to reasoning before the
 * first visible character.
 *
 * 500 is kept because the ceiling itself is harmless (output tokens bill only
 * as generated) and it leaves comfortable room for the ~260-char payload now
 * that reasoning no longer competes for the same budget. Do NOT "fix" a future
 * truncation here by raising this number again -- if `finish_reason: "length"`
 * reappears with a short response, reasoning is eating the budget and the
 * lever is PASS1_REASONING_EFFORT.
 */
const PASS1_MAX_TOKENS = 500;

/**
 * Minimize (NOT disable) extended reasoning for Pass 1.
 *
 * GEMINI_HEAVY_MODEL is a thinking model (`gemini-pro-latest`), and nothing in
 * this codebase set a reasoning budget on any Gemini call before 2026-09-15 --
 * so every thinking-model call spends an unbounded, per-request-variable share
 * of `max_tokens` on reasoning it never shows. On the OpenAI-compatible
 * endpoint that budget comes out of the same allowance as the answer, which is
 * how a 500-token cap produced 29 characters. "none" fixed that on 2026-09-15.
 *
 * "none" stopped being a valid value on 2026-09-16: Google's `gemini-pro-latest`
 * alias now points at a Gemini 3 Pro generation that made thinking mandatory --
 * a zero reasoning budget is hardcoded-rejected with `400 INVALID_ARGUMENT:
 * Budget 0 is invalid. This model only works in thinking mode`, and that
 * request-level failure fell through Pass 1's existing !pass1Resp.ok branch to
 * DEFAULT_IDENTIFICATION (domain="general") on EVERY call -- confirmed live in
 * production, not from an error page. "low" is the lowest value the
 * OpenAI-compat endpoint accepts for this model family; Pass 1's own
 * single-shot classification task still needs none of the reasoning that
 * floor buys, so this is a forced floor, not a considered increase in
 * reasoning depth.
 *
 * Pass 1 is single-shot classification into a fixed 12-domain enum plus a name
 * and keywords -- all of it read directly off the images. There is no
 * multi-step inference for reasoning to help with, so minimizing it costs no
 * accuracy here. This is deliberately NOT a blanket policy for the rest of the
 * pipeline: the visual and market agents do multi-step work where reasoning
 * earns its keep, and per the user's standing instruction the heavy model tier
 * stays put for visual requests because accuracy matters more than cost there.
 *
 * Sent as `reasoning_effort` (the OpenAI-compat spelling). The native API's
 * equivalent for this model family is `thinking_level` (NOT the older
 * `thinkingConfig.thinkingBudget` integer, which this same model generation
 * still accepts but treats a 0 floor identically -- and Google warns not to
 * send both `thinking_level` and `thinking_budget` in the same request, they
 * conflict). A call site ported between the native and OpenAI-compat endpoints
 * needs this rewritten, not copied.
 */
const PASS1_REASONING_EFFORT = "low";

const DEFAULT_IDENTIFICATION: Identification = {
  domain: "general",
  itemName: "item",
  keywords: [],
  isMetal: false,
  metalType: "none",
};

/**
 * Unwrap a single-element array into the object inside it.
 *
 * Despite `response_format: { type: "json_object" }`, the model intermittently
 * returns its result wrapped in an array: `[{ "domain": ..., "itemName": ... }]`.
 * Both parse paths below then failed the `parsed.domain && parsed.itemName`
 * check and silently fell through to DEFAULT_IDENTIFICATION's domain="general",
 * which sends the whole downstream pipeline (RAG category, prompt selection,
 * Slab OCR eligibility, category resolution) down the wrong domain's branch --
 * with the correct identification sitting right there in the payload.
 *
 * Observed 2026-09-14 on a Standing Liberty quarter: Pass 1 returned
 * domain="coins_bullion" inside an array and the run proceeded as "general".
 */
export function unwrapIdentificationPayload(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    // Prefer the first element that actually looks like an identification,
    // rather than blindly taking [0] -- guards against a leading null/string.
    const candidate = parsed.find(
      (el) => el && typeof el === "object" && "domain" in el && "itemName" in el,
    );
    return candidate ?? parsed[0];
  }
  return parsed;
}

export async function runPass1Identification(
  apiKey: string,
  imageList: string[],
  voiceNote: string,
  invocationId: string,
  deadline?: RequestDeadline | null,
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

    const pass1Resp = await fetchWithTimeout(
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
                `You are an item identification assistant. Examine ALL images carefully as a set and return ONLY valid JSON (no markdown, no code blocks):\n{"domain":"coins_bullion|trading_cards|jewelry|electronics|vintage_clothing|auto_parts|sneakers|luxury_handbags|musical_instruments|toys_collectibles|home_garden_tools|general","itemName":"short descriptive name (max 80 chars — include year, denomination, and series when visible for coins)","keywords":["kw1","kw2","kw3","kw4","kw5"],"isMetal":true|false,"metalType":"gold|silver|platinum|none"}\n\nDOMAIN GUIDE — classify the item into exactly ONE of these 12 domains:\n- coins_bullion: any coin, currency/paper money, bullion bar, bullion round, or precious metal item\n- trading_cards: sports cards, TCG (Pokémon, Magic: The Gathering, Yu-Gi-Oh), non-sports trading cards, card packs/boxes\n- jewelry: rings, watches, necklaces, bracelets, earrings, brooches, loose gemstones, body jewelry\n- electronics: phones, tablets, laptops/PCs, gaming consoles, cameras, audio equipment, headphones, TVs, smart home devices\n- vintage_clothing: apparel, shoes, and fashion accessories — especially vintage, retro, or branded clothing (sneakers with athletic/sport use go to "sneakers" instead)\n- auto_parts: car/truck/motorcycle/ATV parts and accessories — engine components, body panels, wheels/tires, lights, sensors, filters, exhaust, suspension (look for part numbers, fitment data, or vehicle-specific mounting)\n- sneakers: athletic/performance shoes with SKU tags (Nike, Jordan, Adidas, Yeezy, New Balance, etc.) — distinguish from vintage_clothing which covers non-athletic footwear and apparel\n- luxury_handbags: designer handbags, totes, wallets, and leather goods from luxury brands (Louis Vuitton, Chanel, Hermès, Gucci, Prada, Coach, etc.) — distinguish from general bags/purses\n- musical_instruments: guitars, basses, keyboards, drums, wind instruments, string instruments, audio effects pedals, microphones, DJ equipment\n- toys_collectibles: action figures, diecast (Hot Wheels), LEGO, dolls, board games, model kits, Funko Pops, comic books, vintage toys, pop-culture collectibles\n- home_garden_tools: power tools, hand tools, lawn/garden equipment, kitchen appliances, home decor, furniture, hardware, HVAC/plumbing parts for home use (vehicle parts go to "auto_parts" instead)\n- general: anything that does not clearly fit the above — books, art, sporting goods, health/beauty, industrial/MRO supplies, office supplies, miscellaneous\n\nDISAMBIGUATION — when domains overlap, use these rules:\n- Sneakers vs vintage_clothing: athletic/performance shoes with a brand SKU tag (Nike, Jordan, Adidas, etc.) → sneakers. Dress shoes, boots, sandals, or vintage non-athletic footwear → vintage_clothing.\n- Auto_parts vs home_garden_tools: if the part is for a vehicle (car, truck, motorcycle, ATV) → auto_parts. If it is a power tool, hand tool, or lawn/garden equipment → home_garden_tools.\n- Luxury_handbags vs general: branded designer handbags/wallets from recognized luxury houses → luxury_handbags. Unbranded or non-luxury bags/purses → general.\n- Toys_collectibles vs general: items with collectible/character/franchise branding (action figures, LEGO, Funko, diecast, comics) → toys_collectibles. Generic household items → general.\n- Musical_instruments vs electronics: musical instruments and audio gear specifically for music performance/recording (guitars, pedals, mics, DJ gear) → musical_instruments. Consumer audio (headphones, speakers, home theater) → electronics.\n- Jewelry vs general: if the item is wearable personal adornment (ring, necklace, watch, bracelet) → jewelry. Decorative home items → general.\n\nCRITICAL FOR COINS/CARDS IN GRADING SLABS: If the item is in a PCGS, NGC, PSA, BGS, or other certification slab, READ THE PRINTED LABEL TEXT FIRST. The label is the AUTHORITATIVE source for year, denomination, grade, and item identity. Do NOT guess the year from the coin/card face if a label is clearly visible. Common AI error: misreading 2026 as 2020, 2021, or 2024. The digit 6 has a tail curving down-left - it is NOT a 0 or 1. Read each digit on the label individually and carefully.\n\nCRITICAL — TODAY'S YEAR IS ${p1Year}: Coins dated in recent or current years (${p1RecentYears}) ARE REAL government-issued coins. They are NOT novelty, fantasy, replica, or tribute coins. The US Mint and other world mints actively produce coins with these dates. NEVER classify ANY coin — raw/ungraded, in a capsule, or professionally slabbed — as novelty, fantasy, exonumia, or tribute based on its date. Set domain=coins_bullion for all such coins.\n\nFAILED IDENTIFICATION PREVENTION:\n- When in doubt between coins_bullion and general for a round metallic object: choose coins_bullion.\n- For multi-item photos (e.g. several coins, a group of cards): identify the PRIMARY or most prominent item. If it is a lot/group, describe as a group in itemName (e.g. "Mixed US Silver Coin Lot 5 Coins").\n- If images are blurry/unclear, use the seller voice note if provided, otherwise pick the most likely domain from visible context clues.\n- For bullion bars, rounds, or generic silver/gold items: domain=coins_bullion, isMetal=true.\n- Prefer the most specific domain over "general" — only use "general" when no other domain clearly applies.\n- itemName MUST be specific: "1921 Morgan Silver Dollar" not just "coin". "2023 Pokemon Scarlet Base Set Pack" not just "card". "Nike Air Jordan 1 Retro High OG Chicago" not just "shoes".

OUTPUT FORMAT — STRICT: Your entire response must be the JSON object and nothing else. Do NOT write a preamble, explanation, or lead-in sentence such as "Here is the JSON" before it, do NOT wrap it in markdown code fences, and do NOT wrap it in an array. Start your response with the { character.`,
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
          max_tokens: PASS1_MAX_TOKENS,
          reasoning_effort: PASS1_REASONING_EFFORT,
        }),
      },
      withDeadline(PIPELINE_TIMEOUTS_MS.pass1, deadline),
      "Pass 1 identification",
    );

    if (pass1Resp.ok) {
      const pass1Data = await pass1Resp.json();
      const pass1Text = pass1Data.choices?.[0]?.message?.content ?? "";
      // This is the OpenAI-compatible endpoint, so the truncation signal is
      // `finish_reason: "length"` -- NOT the native API's
      // `finishReason: "MAX_TOKENS"` that detailExtractor.ts checks. Reading
      // the wrong field here would silently never fire.
      const finishReason = pass1Data.choices?.[0]?.finish_reason;
      const truncated = finishReason === "length";
      console.log(
        `[${invocationId}] PASS 1 raw response (${pass1Text.length} chars):`,
        pass1Text.slice(0, 500),
      );

      if (truncated) {
        // Report the reasoning-token spend alongside the cap. A short response
        // with a large `reasoning` count means the budget went to thinking, not
        // to the answer -- the failure mode that made a 500-token cap emit 29
        // characters on 2026-09-15. Raising the cap does not fix that; check
        // that reasoning_effort is actually being honored instead.
        const reasoningTokens = pass1Data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
        console.error(
          `[${invocationId}] ❌ Pass 1 response TRUNCATED by max_tokens ` +
            `(${PASS1_MAX_TOKENS}) -- finish_reason=length, chars=${pass1Text.length}, ` +
            `reasoningTokens=${reasoningTokens ?? "unreported"}, ` +
            `reasoning_effort=${PASS1_REASONING_EFFORT}. ` +
            `Identification will fall back to domain="general", which misroutes ` +
            `category resolution, the domain prompt and Slab OCR eligibility. ` +
            `If the response is short, reasoning consumed the budget -- verify ` +
            `reasoning_effort is honored rather than raising PASS1_MAX_TOKENS.`,
        );
      }

      if (!pass1Text || pass1Text.trim().length === 0) {
        console.warn(`[${invocationId}] ⚠️  Pass 1 returned empty response`);
      } else {
        try {
          const parsed = unwrapIdentificationPayload(
            JSON.parse(pass1Text),
          ) as Record<string, unknown>;
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
              const parsed = unwrapIdentificationPayload(
                JSON.parse(jsonMatch[0]),
              ) as Record<string, unknown>;
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
                  truncated,
                  finishReason: finishReason ?? "unknown",
                  raw: pass1Text.slice(0, 200),
                },
              );
            }
          } else {
            // Distinguish "the model emitted prose/garbage" from "the model was
            // cut off mid-emit". Both surfaced here identically before, and they
            // have different fixes (correct the prompt vs. raise the cap).
            console.error(
              `[${invocationId}] ❌ Pass 1 JSON parse failed${
                truncated ? " (response was TRUNCATED -- see above)" : ""
              }:`,
              {
                error: String(jsonParseErr),
                truncated,
                finishReason: finishReason ?? "unknown",
                raw: pass1Text.slice(0, 200),
              },
            );
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

export function detectMetalGeneralContradiction(
  identification: Pick<Identification, "domain" | "itemName" | "keywords" | "isMetal" | "metalType">,
): { domain: Domain; corrected: boolean; reason: string } {
  if (identification.domain !== "general" || (!identification.isMetal && identification.metalType === "none")) {
    return { domain: identification.domain, corrected: false, reason: "" };
  }
  const text = `${identification.itemName} ${identification.keywords.join(" ")}`.toLowerCase();
  const JEWELRY_SIGNAL_RE =
    /\b(rings?|necklaces?|bracelets?|earrings?|pendants?|brooch(?:es)?|bangles?|chains?|anklets?|cufflinks?)\b/i;
  if (JEWELRY_SIGNAL_RE.test(text)) {
    return { domain: "jewelry", corrected: true, reason: `metal detected + jewelry noun in "${text}"` };
  }
  return {
    domain: "general",
    corrected: false,
    reason: `metal detected but no jewelry noun in "${text}" — leaving general`,
  };
}
