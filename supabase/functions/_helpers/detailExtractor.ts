/**
 * detailExtractor.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Post-Pass Detail Extraction & Override
 *
 * This module runs AFTER the main AI analysis (Pass 2) and performs a focused,
 * targeted vision inspection to extract high-value identification details that
 * the main model frequently gets wrong:
 *
 *   • Coins: mint marks, key dates, die varieties, errors
 *   • Trading Cards: set name, card number, parallel/variant, print run
 *   • Jewelry: hallmarks, maker's marks, karat stamps
 *
 * Unlike the advisory pre-pass, findings from this module are AUTHORITATIVE
 * and will OVERRIDE the main model's output when they differ.
 *
 * Uses gemini-3-flash-preview with structured JSON output (no code_execution needed —
 * we send ALL images and ask the model to focus specifically on the detail areas).
 */

export type Domain =
  | "coins_bullion"
  | "trading_cards"
  | "jewelry"
  | "electronics"
  | "vintage_clothing"
  | "general";

export interface CoinDetails {
  mintMark: string | null; // "O", "S", "CC", "D", "W", or null (no mark / Philadelphia)
  mintMarkConfidence: "confirmed" | "likely" | "not_visible";
  mintLocation: string | null; // "New Orleans", "San Francisco", etc.
  year: string | null;
  denomination: string | null;
  series: string | null; // "Morgan Dollar", "Peace Dollar", etc.
  keyDate: boolean; // Is this a key/semi-key date?
  keyDateReason: string | null; // e.g. "1893-S Morgan is the key date of the series"
  variety: string | null; // VAM, DDO, RPM, etc.
  errors: string | null; // Die cracks, clips, off-center, etc.
  reverseVisible: boolean; // Was the reverse photographed?
}

export interface CardDetails {
  sport: string | null; // "Baseball", "Basketball", "Football", "Pokemon", etc.
  playerOrCharacter: string | null;
  year: string | null;
  setName: string | null; // "Topps Chrome", "Prizm", "Base Set", etc.
  cardNumber: string | null;
  parallel: string | null; // "Refractor", "Silver Prizm", "Holo", etc.
  variant: string | null; // "Short Print", "Error", "Photo Variation", etc.
  serialNumbered: boolean;
  serialNumber: string | null; // e.g. "/99", "/25"
  rookie: boolean;
  autographed: boolean;
  graded: boolean;
  grader: string | null; // "PSA", "BGS", "CGC", etc.
  grade: string | null; // "10", "9.5", etc.
}

export interface JewelryDetails {
  metalType: string | null; // "Gold", "Silver", "Platinum"
  karat: string | null; // "10k", "14k", "18k", "925", etc.
  hallmarks: string[];
  makersMark: string | null;
  brandSignature: string | null; // "Tiffany & Co.", "Cartier", etc.
  gemstones: string[];
}

export interface DetailExtractionResult {
  domain: Domain;
  coinDetails: CoinDetails | null;
  cardDetails: CardDetails | null;
  jewelryDetails: JewelryDetails | null;
  rawFindings: string; // Full narrative for logging
}

const DETAIL_MODEL = "gemini-3-flash-preview";
const DETAIL_TIMEOUT_MS = 15_000; // 15 seconds

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractJson(raw: string): string {
  let text = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text;
}

// ─── Coin-specific detail extraction prompt ────────────────────────────────

function buildCoinExtractionPrompt(itemName: string): string {
  return `You are an expert numismatist performing a FOCUSED visual inspection of coin photographs.
Your ONLY job is to extract specific identification details. Do NOT generate a listing.

## YOUR TASK
Examine ALL provided photographs carefully and extract the following details:

### MINT MARK IDENTIFICATION (HIGHEST PRIORITY)
This is the MOST IMPORTANT thing to get right. Follow these steps:
1. FIRST: Determine the coin series (Morgan Dollar, Peace Dollar, Kennedy Half, etc.)
2. THEN: Look at the EXACT location where the mint mark appears for that series:
   - Morgan Dollar (1878-1921): REVERSE side, BELOW the eagle's tail feathers, ABOVE the letters "DO" in "ONE DOLLAR". The mint mark is a small letter: O, S, CC, or D. If NO letter is present, it's Philadelphia.
   - Peace Dollar (1921-1935): REVERSE side, at the base/tip of the eagle's RIGHT wing (viewer's left), near the word "ONE". Look for S or D.
   - Pre-1933 Gold ($5/$10/$20): varies by type — Liberty Head: REVERSE below eagle. Indian Head: REVERSE left of arrowheads.
   - Kennedy Half: REVERSE near eagle's left talons (viewer's right).
   - Lincoln Cent: OBVERSE below the date.
   - Barber/Walking Liberty: OBVERSE left side or REVERSE.
3. CAREFULLY examine that exact spot. Zoom mentally into that region.
4. Report what you see:
   - If you see an "O" → mint mark is "O" (New Orleans)
   - If you see an "S" → mint mark is "S" (San Francisco)
   - If you see "CC" → mint mark is "CC" (Carson City)
   - If you see a "D" → mint mark is "D" (Denver)
   - If you see a "W" → mint mark is "W" (West Point)
   - If that area is BLANK/SMOOTH with no letter → mint mark is null (Philadelphia)
   - If the REVERSE is not photographed or the area is OUT OF FRAME → mintMarkConfidence = "not_visible"

### CRITICAL RULES
- NEVER default to Philadelphia. Philadelphia = CONFIRMED absence of any mint mark letter in the correct location.
- If you cannot clearly see the mint mark area, set mintMarkConfidence to "not_visible", NOT "confirmed".
- If the reverse side is not in the photos, set reverseVisible to false and mintMarkConfidence to "not_visible".
- For Morgan Dollars specifically: the "O" mint mark is often small and can look worn — look carefully below the eagle's tail feathers.

### OTHER DETAILS TO EXTRACT
- Year: Read from the obverse. Note if it's hard to read.
- Denomination: $1, 50C, 25C, 10C, 5C, 1C, $5, $10, $20
- Series: Morgan Dollar, Peace Dollar, Kennedy Half, etc.
- Key Date: Is this year+mint combination a key or semi-key date? (e.g. 1893-S Morgan, 1916-D Mercury Dime, 1909-S VDB Lincoln)
- Variety: Any die variety (VAM, DDO, RPM)?
- Errors: Die cracks, clips, off-center strike, etc.?

The item was described as: "${itemName}"

Return ONLY valid JSON (no markdown, no code blocks):
{
  "mintMark": "O" | "S" | "CC" | "D" | "W" | null,
  "mintMarkConfidence": "confirmed" | "likely" | "not_visible",
  "mintLocation": "New Orleans" | "San Francisco" | "Carson City" | "Denver" | "West Point" | "Philadelphia" | "Unknown/Not Visible",
  "year": "1896",
  "denomination": "$1",
  "series": "Morgan Dollar",
  "keyDate": false,
  "keyDateReason": null,
  "variety": null,
  "errors": null,
  "reverseVisible": true,
  "reasoning": "brief explanation of what you saw in the mint mark area"
}`;
}

// ─── Trading card detail extraction prompt ──────────────────────────────────

function buildCardExtractionPrompt(itemName: string): string {
  return `You are an expert trading card specialist performing a FOCUSED visual inspection.
Your ONLY job is to extract specific identification details from the card photographs.

## YOUR TASK
Examine ALL provided photographs and extract:

### CARD IDENTIFICATION (HIGHEST PRIORITY)
1. Sport or game (Baseball, Basketball, Football, Hockey, Soccer, Pokemon, Magic, Yu-Gi-Oh, etc.)
2. Player or character name — read from the card face
3. Year — look at copyright date, set year, or card design era
4. Set name — e.g. "Topps Chrome", "Panini Prizm", "Pokemon Base Set", "Bowman 1st"
5. Card number — usually bottom of card front or card back
6. PARALLEL/VARIANT — THIS IS CRITICAL:
   - Look at the card's surface: Is it holographic? Refractor? Prizm/silver shimmer?
   - Check the border color: colored borders often indicate parallels
   - Look for text indicating parallel: "Refractor", "Silver", "Gold", "/99", etc.
   - Compare to base: any visual difference from a standard base card = parallel
7. Serial numbering — look for /XX notation (e.g. "23/99")
8. Rookie indicators — "RC" logo, "Rookie" text, 1st Bowman chrome, etc.
9. Autograph — real ink auto vs. printed facsimile
10. If graded: read the grading company, grade number, cert number from slab

### CRITICAL RULES
- NEVER guess the set name — read it from the card or determine from visual design
- For parallels: if you can't identify the specific parallel type, describe what you see (e.g. "holographic surface, non-standard border color")
- Serial numbered cards are HIGH value — always check for /XX notation

The item was described as: "${itemName}"

Return ONLY valid JSON:
{
  "sport": "Baseball",
  "playerOrCharacter": "Mike Trout",
  "year": "2024",
  "setName": "Topps Chrome",
  "cardNumber": "200",
  "parallel": "Refractor",
  "variant": null,
  "serialNumbered": true,
  "serialNumber": "/99",
  "rookie": false,
  "autographed": false,
  "graded": false,
  "grader": null,
  "grade": null,
  "reasoning": "brief explanation of visual identifiers seen"
}`;
}

// ─── Jewelry detail extraction prompt ───────────────────────────────────────

function buildJewelryExtractionPrompt(itemName: string): string {
  return `You are an expert gemologist and jewelry appraiser performing a FOCUSED visual inspection.
Your ONLY job is to extract identification details from jewelry photographs.

## YOUR TASK
Examine ALL provided photographs and extract:
1. Metal type and karat (look for stamps: 10K, 14K, 18K, 925, 950, PLAT, etc.)
2. Hallmarks (any stamps, symbols, or marks)
3. Maker's mark (brand stamps)
4. Brand signature (Tiffany, Cartier, David Yurman, etc.)
5. Gemstones visible (type, approximate size, count)

The item was described as: "${itemName}"

Return ONLY valid JSON:
{
  "metalType": "Gold" | "Silver" | "Platinum" | null,
  "karat": "14k",
  "hallmarks": ["14K", "Turkey"],
  "makersMark": null,
  "brandSignature": null,
  "gemstones": ["diamond approx 0.5ct", "sapphire"],
  "reasoning": "brief explanation"
}`;
}

// ─── Main extraction function ───────────────────────────────────────────────

export async function extractKeyDetails(
  apiKey: string,
  domain: Domain,
  itemName: string,
  imageBase64List: string[],
  imageMimeTypes: string[],
  invocationId: string,
): Promise<DetailExtractionResult | null> {
  const label = `[${invocationId}][DetailExtract]`;

  // Only run for domains where we have focused extraction
  if (!["coins_bullion", "trading_cards", "jewelry"].includes(domain)) {
    console.log(`${label} Skipping — domain "${domain}" has no detail extraction`);
    return null;
  }

  if (imageBase64List.length === 0) {
    console.log(`${label} Skipping — no images`);
    return null;
  }

  // Build the domain-specific prompt
  let extractionPrompt: string;
  switch (domain) {
    case "coins_bullion":
      extractionPrompt = buildCoinExtractionPrompt(itemName);
      break;
    case "trading_cards":
      extractionPrompt = buildCardExtractionPrompt(itemName);
      break;
    case "jewelry":
      extractionPrompt = buildJewelryExtractionPrompt(itemName);
      break;
    default:
      return null;
  }

  // Build image parts — use ALL images to maximize coverage
  const imageParts = imageBase64List.map((b64, i) => ({
    inlineData: {
      mimeType: imageMimeTypes[i] ?? "image/jpeg",
      data: b64,
    },
  }));

  const requestBody = {
    system_instruction: {
      parts: [{ text: extractionPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [
          ...imageParts,
          {
            text:
              `Examine these ${imageParts.length} photograph(s) of "${itemName}" and extract the specific identification details requested. Look at EVERY image — the key details may be on any side of the item.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
    },
  };

  try {
    console.log(`${label} Starting ${domain} detail extraction (model=${DETAIL_MODEL}, images=${imageParts.length})`);

    const resp = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${DETAIL_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
      DETAIL_TIMEOUT_MS,
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`${label} ${DETAIL_MODEL} returned ${resp.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    let rawText = "";
    for (const part of parts) {
      if (part.text) rawText += part.text;
    }

    if (!rawText || rawText.trim().length < 10) {
      console.warn(`${label} Empty response`);
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(rawText));
    } catch (e) {
      console.warn(`${label} JSON parse failed: ${String(e)}. Raw: ${rawText.slice(0, 300)}`);
      return null;
    }

    console.log(`${label} Raw extraction result:`, JSON.stringify(parsed).slice(0, 500));

    // Build domain-specific result
    const result: DetailExtractionResult = {
      domain,
      coinDetails: null,
      cardDetails: null,
      jewelryDetails: null,
      rawFindings: parsed.reasoning || JSON.stringify(parsed).slice(0, 200),
    };

    if (domain === "coins_bullion") {
      result.coinDetails = {
        mintMark: parsed.mintMark ?? null,
        mintMarkConfidence: parsed.mintMarkConfidence ?? "not_visible",
        mintLocation: parsed.mintLocation ?? null,
        year: parsed.year ?? null,
        denomination: parsed.denomination ?? null,
        series: parsed.series ?? null,
        keyDate: Boolean(parsed.keyDate),
        keyDateReason: parsed.keyDateReason ?? null,
        variety: parsed.variety ?? null,
        errors: parsed.errors ?? null,
        reverseVisible: parsed.reverseVisible !== false,
      };
      console.log(`${label} ✓ Coin details extracted:`, {
        mintMark: result.coinDetails.mintMark,
        mintMarkConfidence: result.coinDetails.mintMarkConfidence,
        mintLocation: result.coinDetails.mintLocation,
        year: result.coinDetails.year,
        series: result.coinDetails.series,
        keyDate: result.coinDetails.keyDate,
        reverseVisible: result.coinDetails.reverseVisible,
      });
    } else if (domain === "trading_cards") {
      result.cardDetails = {
        sport: parsed.sport ?? null,
        playerOrCharacter: parsed.playerOrCharacter ?? null,
        year: parsed.year ?? null,
        setName: parsed.setName ?? null,
        cardNumber: parsed.cardNumber ?? null,
        parallel: parsed.parallel ?? null,
        variant: parsed.variant ?? null,
        serialNumbered: Boolean(parsed.serialNumbered),
        serialNumber: parsed.serialNumber ?? null,
        rookie: Boolean(parsed.rookie),
        autographed: Boolean(parsed.autographed),
        graded: Boolean(parsed.graded),
        grader: parsed.grader ?? null,
        grade: parsed.grade ?? null,
      };
      console.log(`${label} ✓ Card details extracted:`, {
        sport: result.cardDetails.sport,
        player: result.cardDetails.playerOrCharacter,
        set: result.cardDetails.setName,
        parallel: result.cardDetails.parallel,
        rookie: result.cardDetails.rookie,
      });
    } else if (domain === "jewelry") {
      result.jewelryDetails = {
        metalType: parsed.metalType ?? null,
        karat: parsed.karat ?? null,
        hallmarks: Array.isArray(parsed.hallmarks) ? parsed.hallmarks : [],
        makersMark: parsed.makersMark ?? null,
        brandSignature: parsed.brandSignature ?? null,
        gemstones: Array.isArray(parsed.gemstones) ? parsed.gemstones : [],
      };
      console.log(`${label} ✓ Jewelry details extracted:`, result.jewelryDetails);
    }

    return result;
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError"
      ? `timed out after ${DETAIL_TIMEOUT_MS}ms`
      : String(err);
    console.warn(`${label} Failed: ${reason}`);
    return null;
  }
}

// ─── Apply extracted details to listing (OVERRIDE) ──────────────────────────

/**
 * Applies extracted detail findings to the listing object.
 * This function OVERRIDES the main model's output where the detail extractor
 * has higher-confidence findings.
 */
// ─────────────────────────────────────────────────────────────────────────────
// inferCoinWeightOz
// Returns the fine troy oz of pure metal for well-known coin/bullion types.
// Matches against a combined series + title string (lowercased).
// Returns 0 if the type is not recognised.
// ─────────────────────────────────────────────────────────────────────────────
function inferCoinWeightOz(text: string): number {
  // ── Silver ──
  if (/american silver eagle/.test(text)) return 1.0000;
  if (/morgan dollar|peace dollar/.test(text)) return 0.7734;
  if (/walking liberty half|franklin half|barber half|kennedy half.*1964/.test(text)) return 0.3618;
  if (/kennedy half.*196[5-9]|kennedy half.*1970/.test(text)) return 0.1479; // 40% silver
  if (/barber quarter|standing liberty quarter|washington quarter/.test(text)) return 0.1809;
  if (/mercury dime|barber dime|roosevelt dime/.test(text)) return 0.0724;
  if (/silver war nickel|1942.*nickel|1943.*nickel|1944.*nickel|1945.*nickel/.test(text)) return 0.0563;
  // Generic silver bars/rounds — look for weight in oz in the text
  const silverOzMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:troy\s*)?oz\s*(?:\.999|fine|silver)/);
  if (silverOzMatch) return parseFloat(silverOzMatch[1]);
  if (/1\s*oz.*silver|silver.*1\s*oz/.test(text)) return 1.0000;
  if (/10\s*oz.*silver|silver.*10\s*oz/.test(text)) return 10.0000;
  if (/100\s*oz.*silver|silver.*100\s*oz/.test(text)) return 100.0000;
  if (/1\/2\s*oz.*silver|silver.*1\/2\s*oz/.test(text)) return 0.5000;
  if (/1\/4\s*oz.*silver|silver.*1\/4\s*oz/.test(text)) return 0.2500;
  if (/1\/10\s*oz.*silver|silver.*1\/10\s*oz/.test(text)) return 0.1000;

  // ── Gold ──
  if (/american gold eagle.*\$50|1\s*oz.*gold eagle|gold eagle.*1\s*oz/.test(text)) return 1.0000;
  if (/american gold eagle.*\$25|1\/2\s*oz.*gold eagle|gold eagle.*1\/2\s*oz/.test(text)) return 0.5000;
  if (/american gold eagle.*\$10|1\/4\s*oz.*gold eagle|gold eagle.*1\/4\s*oz/.test(text)) return 0.2500;
  if (/american gold eagle.*\$5|1\/10\s*oz.*gold eagle|gold eagle.*1\/10\s*oz/.test(text)) return 0.1000;
  if (/american gold buffalo/.test(text)) return 1.0000;
  if (/gold sovereign/.test(text)) return 0.2354;
  // Pre-1933 US gold
  if (/double eagle|\$20\s*gold/.test(text)) return 0.9675;
  if (/\$10\s*eagle|\$10\s*gold|eagle gold/.test(text)) return 0.4838;
  if (/\$5\s*half eagle|\$5\s*gold|half eagle/.test(text)) return 0.2419;
  if (/\$2\.5|quarter eagle|\$2\.50\s*gold/.test(text)) return 0.1209;
  if (/\$1\s*gold|gold dollar/.test(text)) return 0.0484;
  // Indian Head gold ($2.50 / $5 / $10)
  if (/indian head.*\$2\.5|indian.*quarter eagle/.test(text)) return 0.1209;
  if (/indian head.*\$5|indian.*half eagle/.test(text)) return 0.2419;
  if (/indian head.*\$10|indian.*eagle/.test(text)) return 0.4838;
  // Generic gold bars/rounds
  const goldOzMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:troy\s*)?oz\s*(?:\.999|\.9999|fine|gold)/);
  if (goldOzMatch) return parseFloat(goldOzMatch[1]);
  if (/1\s*oz.*gold|gold.*1\s*oz/.test(text)) return 1.0000;
  if (/1\/10\s*oz.*gold|gold.*1\/10\s*oz/.test(text)) return 0.1000;
  if (/1\/4\s*oz.*gold|gold.*1\/4\s*oz/.test(text)) return 0.2500;
  if (/1\/2\s*oz.*gold|gold.*1\/2\s*oz/.test(text)) return 0.5000;
  // LEGO silver bars — "1/8 oz" style
  if (/1\/8\s*oz.*silver|silver.*1\/8\s*oz/.test(text)) return 0.125;

  return 0;
}

export function applyDetailOverrides(
  listing: any,
  extraction: DetailExtractionResult,
  invocationId: string,
): void {
  const label = `[${invocationId}][DetailOverride]`;

  if (extraction.coinDetails) {
    const cd = extraction.coinDetails;
    const specs = listing.itemSpecifics ?? {};

    // ── Mint Mark Override ──
    if (cd.mintMarkConfidence === "confirmed" || cd.mintMarkConfidence === "likely") {
      const oldMintLocation = specs["Mint Location"] ?? "not set";
      const oldMintMark = specs["Mint Mark"] ?? "not set";

      if (cd.mintLocation && cd.mintLocation !== "Unknown/Not Visible") {
        specs["Mint Location"] = cd.mintLocation;
        console.log(
          `${label} OVERRIDE Mint Location: "${oldMintLocation}" → "${cd.mintLocation}" (confidence: ${cd.mintMarkConfidence})`,
        );
      }

      if (cd.mintMark !== null && cd.mintMark !== undefined) {
        specs["Mint Mark"] = cd.mintMark;
        console.log(
          `${label} OVERRIDE Mint Mark: "${oldMintMark}" → "${cd.mintMark}" (confidence: ${cd.mintMarkConfidence})`,
        );
      } else if (cd.mintLocation === "Philadelphia") {
        specs["Mint Mark"] = "None";
        specs["Mint Location"] = "Philadelphia";
        console.log(`${label} OVERRIDE Mint Mark: "${oldMintMark}" → "None" (Philadelphia confirmed)`);
      }

      // ── Update title with correct mint mark ──
      if (listing.title && cd.mintMark && cd.mintMarkConfidence === "confirmed") {
        const title = listing.title as string;
        // Check if title has wrong mint info or is missing mint mark
        const mintMarkInTitle = /\b([OSDW]|CC)\s*(?:mint|mark)?\b/i.test(title) ||
          /\bPhiladelphia\b/i.test(title) ||
          /\bNew Orleans\b/i.test(title) ||
          /\bSan Francisco\b/i.test(title) ||
          /\bCarson City\b/i.test(title) ||
          /\bDenver\b/i.test(title);

        // Add mint mark to title if not already there correctly
        if (!mintMarkInTitle && cd.year && cd.mintMark) {
          // Insert mint mark after year: "1896" → "1896-O"
          const yearPattern = new RegExp(`\\b${cd.year}\\b`);
          if (yearPattern.test(title)) {
            const newTitle = title.replace(yearPattern, `${cd.year}-${cd.mintMark}`);
            if (newTitle.length <= 80) {
              listing.title = newTitle;
              console.log(`${label} OVERRIDE Title: added mint mark → "${newTitle}"`);
            }
          }
        } else if (mintMarkInTitle && cd.mintMark) {
          // Fix wrong mint mark in title — replace year without mark to year-mark
          if (cd.year) {
            const wrongPattern = new RegExp(`\\b${cd.year}(?:-(\\w{1,2}))?\\b`);
            const match = title.match(wrongPattern);
            if (match) {
              const currentMark = match[1] || "";
              if (currentMark.toUpperCase() !== cd.mintMark.toUpperCase()) {
                const newTitle = title.replace(wrongPattern, `${cd.year}-${cd.mintMark}`);
                if (newTitle.length <= 80) {
                  listing.title = newTitle;
                  console.log(
                    `${label} OVERRIDE Title: fixed mint mark "${currentMark}" → "${cd.mintMark}" → "${newTitle}"`,
                  );
                }
              }
            }
          }
        }
      }

      // ── Update description with correct mint info ──
      if (listing.description && cd.mintLocation && cd.mintMarkConfidence === "confirmed") {
        const desc = listing.description as string;
        // If description says Philadelphia but we found a different mint
        if (/Philadelphia/i.test(desc) && cd.mintLocation !== "Philadelphia") {
          listing.description = desc.replace(/Philadelphia/gi, cd.mintLocation);
          console.log(`${label} OVERRIDE Description: replaced "Philadelphia" → "${cd.mintLocation}"`);
        }
      }
    } else if (cd.mintMarkConfidence === "not_visible") {
      // If we can't see the mint mark, make sure the listing doesn't claim Philadelphia
      if (specs["Mint Location"] === "Philadelphia" && !cd.reverseVisible) {
        specs["Mint Location"] = "Unknown/Not Visible";
        specs["Mint Mark"] = "Not Visible";
        console.log(`${label} OVERRIDE: reverse not visible, changed Philadelphia → Unknown/Not Visible`);
      }
    }

    // ── Year Override ──
    if (cd.year && cd.year !== specs["Year"]) {
      console.log(`${label} OVERRIDE Year: "${specs["Year"]}" → "${cd.year}"`);
      specs["Year"] = cd.year;
    }

    // ── Key Date notation ──
    if (cd.keyDate && cd.keyDateReason) {
      // Add key date info to description
      if (listing.description && !listing.description.includes("key date")) {
        listing.description = `KEY DATE: ${cd.keyDateReason}\n\n${listing.description}`;
        console.log(`${label} Added key date info to description: ${cd.keyDateReason}`);
      }
    }

    // ── Variety / Errors ──
    if (cd.variety && !specs["Variety"]) {
      specs["Variety"] = cd.variety;
      console.log(`${label} Added variety: ${cd.variety}`);
    }

    listing.itemSpecifics = specs;

    // ── Metal Type & Weight Backstop ──
    // If Pass 2 failed to populate metalType/metalWeightOz (common when Pass 1
    // didn't flag isMetal), derive them from the coin series identified here.
    // This ensures melt value is always calculated for precious metal coins.
    const seriesLower = (cd.series ?? listing.itemSpecifics?.["Series"] ?? "").toLowerCase();
    const titleLower = (listing.title ?? "").toLowerCase();
    const combinedText = `${seriesLower} ${titleLower}`;

    // Determine metal type from series/title if not already set
    if (!listing.metalType || listing.metalType === "none") {
      if (
        /morgan|peace|american silver eagle|silver dollar|silver dime|silver quarter|silver half|mercury dime|barber|walking liberty|franklin half|silver bar|silver round|silver bullion/
          .test(combinedText)
      ) {
        listing.metalType = "silver";
        console.log(`${label} BACKSTOP metalType -> "silver" (derived from series/title)`);
      } else if (
        /gold eagle|gold buffalo|double eagle|gold sovereign|half eagle|quarter eagle|indian head gold|\$2\.5|\$5 gold|\$10 gold|\$20 gold|gold bar|gold round|gold bullion|gold coin/
          .test(combinedText)
      ) {
        listing.metalType = "gold";
        console.log(`${label} BACKSTOP metalType -> "gold" (derived from series/title)`);
      } else if (/platinum/.test(combinedText)) {
        listing.metalType = "platinum";
        console.log(`${label} BACKSTOP metalType -> "platinum" (derived from series/title)`);
      }
    }

    // Determine weight from series/title if not already set (or is 0)
    if (listing.metalType && listing.metalType !== "none" && !(listing.metalWeightOz > 0)) {
      const w = inferCoinWeightOz(combinedText);
      if (w > 0) {
        listing.metalWeightOz = w;
        console.log(`${label} BACKSTOP metalWeightOz -> ${w} (derived from series/title)`);
      }
    }
  }

  if (extraction.cardDetails) {
    const card = extraction.cardDetails;
    const specs = listing.itemSpecifics ?? {};

    // ── Sport (REQUIRED by eBay — frequently missing) ──
    if (card.sport && !specs["Sport"]) {
      specs["Sport"] = card.sport;
      console.log(`${label} OVERRIDE Sport: added "${card.sport}"`);
    }

    // ── Player/Character ──
    if (card.playerOrCharacter) {
      if (!specs["Player/Athlete"] && !specs["Card Name"]) {
        // Determine if sports or TCG
        if (["Baseball", "Basketball", "Football", "Hockey", "Soccer"].includes(card.sport ?? "")) {
          specs["Player/Athlete"] = card.playerOrCharacter;
        } else {
          specs["Card Name"] = card.playerOrCharacter;
        }
        console.log(`${label} Added player/character: ${card.playerOrCharacter}`);
      }
    }

    // ── Set Name ──
    if (card.setName && !specs["Set"]) {
      specs["Set"] = card.setName;
      console.log(`${label} Added set: ${card.setName}`);
    }

    // ── Parallel/Variant — HIGH VALUE, often missed ──
    if (card.parallel) {
      const oldFeatures = specs["Features"] ?? "";
      if (!oldFeatures.toLowerCase().includes(card.parallel.toLowerCase())) {
        specs["Features"] = oldFeatures ? `${oldFeatures}, ${card.parallel}` : card.parallel;
        console.log(`${label} OVERRIDE Features: added parallel "${card.parallel}"`);
      }

      // Add parallel to title if not present
      if (listing.title && !listing.title.toLowerCase().includes(card.parallel.toLowerCase())) {
        const newTitle = `${listing.title} ${card.parallel}`.slice(0, 80).replace(/\s+\S*$/, "").trim();
        if (newTitle.length > listing.title.length) {
          listing.title = newTitle;
          console.log(`${label} OVERRIDE Title: added parallel → "${newTitle}"`);
        }
      }
    }

    // ── Serial Number — HIGH VALUE ──
    if (card.serialNumbered && card.serialNumber) {
      if (listing.title && !listing.title.includes("/")) {
        const newTitle = `${listing.title} ${card.serialNumber}`.slice(0, 80).replace(/\s+\S*$/, "").trim();
        listing.title = newTitle;
        console.log(`${label} OVERRIDE Title: added serial number → "${newTitle}"`);
      }
    }

    // ── Rookie designation ──
    if (card.rookie) {
      if (!specs["Features"]?.toLowerCase().includes("rookie")) {
        specs["Features"] = specs["Features"] ? `${specs["Features"]}, Rookie` : "Rookie";
      }
      if (
        listing.title && !listing.title.toLowerCase().includes("rc") && !listing.title.toLowerCase().includes("rookie")
      ) {
        const newTitle = `${listing.title} RC`.slice(0, 80).replace(/\s+\S*$/, "").trim();
        listing.title = newTitle;
        console.log(`${label} OVERRIDE Title: added RC → "${newTitle}"`);
      }
    }

    // ── Grading info ──
    if (card.graded && card.grader && card.grade) {
      if (!specs["Professional Grader"]) {
        specs["Professional Grader"] = card.grader;
      }
      if (!specs["Grade"]) {
        specs["Grade"] = card.grade;
      }
      listing.isSlabbed = true;
    }

    listing.itemSpecifics = specs;
  }

  if (extraction.jewelryDetails) {
    const jd = extraction.jewelryDetails;
    const specs = listing.itemSpecifics ?? {};

    // ── Brand signature (HIGH VALUE — dramatically changes price) ──
    if (jd.brandSignature && !specs["Brand"]) {
      specs["Brand"] = jd.brandSignature;
      console.log(`${label} OVERRIDE Brand: added "${jd.brandSignature}"`);

      // Add brand to title if not present
      if (listing.title && !listing.title.toLowerCase().includes(jd.brandSignature.toLowerCase())) {
        const newTitle = `${jd.brandSignature} ${listing.title}`.slice(0, 80).replace(/\s+\S*$/, "").trim();
        listing.title = newTitle;
        console.log(`${label} OVERRIDE Title: added brand → "${newTitle}"`);
      }
    }

    // ── Karat ──
    if (jd.karat && !specs["Metal Purity"]) {
      specs["Metal Purity"] = jd.karat;
      console.log(`${label} Added karat: ${jd.karat}`);
    }

    // ── Hallmarks ──
    if (jd.hallmarks.length > 0 && !specs["Hallmark"]) {
      specs["Hallmark"] = jd.hallmarks.join(", ");
    }

    listing.itemSpecifics = specs;
  }
}
