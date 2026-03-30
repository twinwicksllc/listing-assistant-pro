/**
 * agenticPrePass.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Pre-Pass 0: Agentic Grounding + Vision Inspection
 *
 * Uses the NATIVE Gemini generateContent API (NOT the OpenAI-compat shim) so
 * that we can leverage:
 *   • google_search built-in tool  → Real-Time Category & Comp Grounding
 *   • code_execution built-in tool → Agentic Vision Think-Act-Observe loop
 *
 * MODEL ROUTING (per official Gemini API docs, verified 2026):
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Stage A — Google Search Grounding   → gemini-2.5-flash                │
 * │    • googleSearch tool fully supported on 2.5 Flash                    │
 * │    • No images needed; pure text grounding pass                        │
 * │    • Cheaper, faster, stable GA model                                  │
 * │                                                                         │
 * │  Stage B — Agentic Vision Inspection → gemini-3-flash-preview          │
 * │    • codeExecution WITH images officially supported in Gemini 3+ only  │
 * │    • Model writes Python to crop/zoom/inspect image regions             │
 * │    • Falls back gracefully to null if model unavailable                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * This runs BEFORE Pass 1 & Pass 2 in analyze-item/index.ts.
 * Its output is injected into the Pass 2 system prompt via `prePassContext`
 * in PromptContext (domainPrompts.ts).
 *
 * DESIGN PRINCIPLES:
 *   - Non-blocking: any failure returns null, letting existing pipeline run unchanged
 *   - Additive: new fields (market_analysis, grounded_category_id, agentic_inspection)
 *     are returned alongside — never replacing — existing response fields
 *   - Fast: per-stage timeouts so neither stage can stall the overall pipeline
 *   - Independent: Stage A and Stage B run concurrently and fail independently
 */

export type Domain =
  | "coins_bullion"
  | "trading_cards"
  | "jewelry"
  | "electronics"
  | "vintage_clothing"
  | "general";

export interface AgenticInspection {
  zoomRegionsExamined: string[];
  keyFindings: string;
  confidenceBoost: number;        // 0–100
  identificationCorrection?: string;
}

export interface PrePassResult {
  marketAnalysis: string | null;
  groundedCategoryId: string | null;
  agenticInspection: AgenticInspection | null;
}

// ─── Model constants ──────────────────────────────────────────────────────────
// Stage A: Google Search grounding — supported on 2.5 Flash (GA, stable, cheaper)
const GROUNDING_MODEL = "gemini-2.5-flash";
// Stage B: Agentic vision inspection with images — requires Gemini 3+ (per docs):
// "Code Execution with images is officially supported in Gemini 3 Flash.
//  The model writes and executes Python code to actively manipulate and
//  inspect images — zoom and inspect, visual math, image annotation."
const VISION_MODEL = "gemini-3-flash-preview";

const STAGE_A_TIMEOUT_MS = 8_000;  // 8 s for search grounding
const STAGE_B_TIMEOUT_MS = 10_000; // 10 s for vision inspection (more complex)

// ─── Domain-specific search query templates ───────────────────────────────────

function buildSearchQueries(domain: Domain, itemName: string): string[] {
  const base = itemName.slice(0, 80);
  switch (domain) {
    case "coins_bullion":
      return [
        `eBay leaf category ID "${base}" 2026 coin bullion numismatic`,
        `eBay recently sold "${base}" price 2026 mint mark error premium toning`,
      ];
    case "trading_cards":
      return [
        `eBay leaf category ID "${base}" trading card 2026`,
        `eBay recently sold "${base}" card 2026 print run error variant graded raw price`,
      ];
    case "jewelry":
      return [
        `eBay leaf category ID "${base}" jewelry 2026`,
        `eBay recently sold "${base}" jewelry 2026 karat hallmark price`,
      ];
    case "electronics":
      return [
        `eBay leaf category ID "${base}" electronics 2026`,
        `eBay recently sold "${base}" 2026 with charger accessories price`,
      ];
    case "vintage_clothing":
      return [
        `eBay leaf category ID "${base}" vintage clothing 2026`,
        `eBay recently sold "${base}" vintage 2026 size tag condition rips snags price`,
      ];
    default:
      return [
        `eBay leaf category ID "${base}" 2026`,
        `eBay recently sold "${base}" 2026 price`,
      ];
  }
}

// ─── Domain-specific zoom targets for vision inspection ───────────────────────

interface ZoomTarget {
  region: string;
  rationale: string;
}

function getZoomTargets(domain: Domain): ZoomTarget[] {
  switch (domain) {
    case "coins_bullion":
      return [
        { region: "date digits",    rationale: "Critical for correct year — misreading 1964 vs 1965 Kennedy Half Dollar changes silver content from 90% to 40%" },
        { region: "mint mark",      rationale: "Location above/below date or on reverse; determines rarity and value (e.g., CC, S, D, O, W marks)" },
        { region: "edge reeds",     rationale: "Helps verify denomination and detect cleaned/altered coins" },
        { region: "surface fields", rationale: "Detect bag marks, cleaning lines, PVC damage, artificial toning" },
      ];
    case "trading_cards":
      return [
        { region: "card number and set symbol", rationale: "Identifies exact set and print run; critical for parallel identification" },
        { region: "corners and edges",           rationale: "Primary condition indicators for raw card grading" },
        { region: "surface centering",           rationale: "Left/right and top/bottom centering affects grade and value significantly" },
        { region: "holographic or foil pattern", rationale: "Identifies parallel type (refractor, prizm, etc.) and its value tier" },
      ];
    case "jewelry":
      return [
        { region: "hallmarks and stamps",   rationale: "Karat, maker's mark, assay office mark — determines metal purity and authenticity" },
        { region: "clasp and findings",     rationale: "Condition of clasp, prong integrity, stone security" },
        { region: "stone clarity and color", rationale: "Visible inclusions, chips, or loose stones affect value significantly" },
        { region: "brand signatures",       rationale: "Hidden signatures (Tiffany, Cartier, etc.) dramatically increase value" },
      ];
    case "electronics":
      return [
        { region: "model number sticker",  rationale: "Exact model/SKU determines correct eBay category and price point" },
        { region: "ports and connectors",  rationale: "Damaged ports (bent pins, broken USB-C) are major value detractors" },
        { region: "screen condition",      rationale: "Dead pixels, scratches, backlight bleed affect condition grade" },
        { region: "serial/IMEI sticker",   rationale: "Confirms device identity and can indicate carrier lock status" },
      ];
    case "vintage_clothing":
      return [
        { region: "brand and size label",      rationale: "Vintage sizing runs 1–2 sizes smaller; correct size drives search traffic" },
        { region: "care instruction label",     rationale: "Absence of care label = pre-1971 US; helps date the piece" },
        { region: "fabric and seam condition",  rationale: "Rips, snags, thin spots, and seam separation are critical disclosures" },
        { region: "union label if present",     rationale: "ILGWU/ACWA dates item to 1940s–1970s; UNITE = 1995+" },
      ];
    default:
      return [
        { region: "brand markings",    rationale: "Identifies maker and model" },
        { region: "condition details", rationale: "Visible wear, damage, or flaws" },
        { region: "label or sticker",  rationale: "Model number, serial, or spec information" },
      ];
  }
}

// ─── Utility: fetch with timeout ──────────────────────────────────────────────

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

// ─── Utility: extract JSON from possibly-fenced model output ─────────────────

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

// ─── Stage A: Google Search Grounding (gemini-2.5-flash) ──────────────────────
//
// Runs WITHOUT images — pure text grounding to find eBay leaf category ID
// and current market pricing. googleSearch is fully supported on 2.5 Flash.

async function runStageA(
  apiKey: string,
  domain: Domain,
  itemName: string,
  label: string,
): Promise<{ marketAnalysis: string | null; groundedCategoryId: string | null }> {
  const searchQueries = buildSearchQueries(domain, itemName);

  const systemInstruction = `You are an expert eBay listing analyst. Use the Google Search tool to find:
1. The current 2026 eBay LEAF category ID for: "${itemName}" (domain: ${domain})
2. Recently sold eBay prices for this item type, including qualitative value factors.

Search queries to execute:
${searchQueries.map((q, i) => `  Query ${i + 1}: ${q}`).join("\n")}

After searching, return ONLY a single valid JSON object (no markdown, no code blocks):
{
  "grounded_category_id": "numeric string or null",
  "market_analysis": "2–4 sentence narrative citing specific search results with price range, median, qualitative premiums/discounts, and market trends"
}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Find the eBay leaf category ID and recent sold prices for this ${domain.replace("_", " ")} item: "${itemName}".`,
          },
        ],
      },
    ],
    tools: [
      { googleSearch: {} },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
    },
  };

  const resp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GROUNDING_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
    STAGE_A_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn(`${label}[StageA] ${GROUNDING_MODEL} returned ${resp.status}: ${errText.slice(0, 300)}`);
    return { marketAnalysis: null, groundedCategoryId: null };
  }

  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let rawText = "";
  for (const part of parts) {
    if (part.text) rawText += part.text;
  }

  if (!rawText || rawText.trim().length < 10) {
    console.warn(`${label}[StageA] Empty response`);
    return { marketAnalysis: null, groundedCategoryId: null };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch (e) {
    console.warn(`${label}[StageA] JSON parse failed: ${String(e)}. Raw: ${rawText.slice(0, 200)}`);
    return { marketAnalysis: null, groundedCategoryId: null };
  }

  const marketAnalysis = typeof parsed.market_analysis === "string" && parsed.market_analysis.trim().length > 5
    ? parsed.market_analysis.trim()
    : null;
  const groundedCategoryId = typeof parsed.grounded_category_id === "string" && /^\d+$/.test(parsed.grounded_category_id.trim())
    ? parsed.grounded_category_id.trim()
    : null;

  console.log(`${label}[StageA] ✓ model=${GROUNDING_MODEL} categoryId=${groundedCategoryId} hasAnalysis=${!!marketAnalysis}`);
  return { marketAnalysis, groundedCategoryId };
}

// ─── Stage B: Agentic Vision Inspection (gemini-3-flash-preview) ──────────────
//
// Requires Gemini 3+ per official Gemini API docs:
// "Code Execution with images is officially supported in Gemini 3 Flash.
//  The model implicitly detects when details are too small (e.g., reading a
//  distant gauge) and writes code to crop and re-examine the area at higher
//  resolution."
// Source: https://ai.google.dev/gemini-api/docs/code-execution

async function runStageB(
  apiKey: string,
  domain: Domain,
  itemName: string,
  imageBase64List: string[],
  imageMimeTypes: string[],
  label: string,
): Promise<AgenticInspection | null> {
  if (imageBase64List.length === 0) {
    console.log(`${label}[StageB] No images provided — skipping vision inspection`);
    return null;
  }

  const zoomTargets = getZoomTargets(domain);

  // Use up to 3 images for the pre-pass
  const imageParts = imageBase64List.slice(0, 3).map((b64, i) => ({
    inlineData: {
      mimeType: imageMimeTypes[i] ?? "image/jpeg",
      data: b64,
    },
  }));

  const zoomInstructions = zoomTargets
    .map((t, i) => `${i + 1}. **${t.region}**: ${t.rationale}`)
    .join("\n");

  const systemInstruction = `You are an expert visual analyst performing an agentic inspection of a ${domain.replace("_", " ")} item for eBay listing purposes.

Using the code_execution tool, perform a Think-Act-Observe inspection loop on the provided image(s):

**THINK**: Which regions need closer examination for this ${domain} item?
Focus regions for this domain:
${zoomInstructions}

**ACT**: Write and execute Python code that:
1. Loads the provided image using PIL (from base64 or as-is)
2. Crops and prints each region you are "examining" (simulating zoom-in)
3. States in detail what you observe in each region (text, marks, condition, damage)
4. Notes any identification-critical findings (dates, mint marks, model numbers, hallmarks, labels)
Use PIL, numpy, or opencv libraries available in the execution environment to crop and inspect image regions.

**OBSERVE**: Based on the execution output, state your final findings.

Return ONLY a single valid JSON object (no markdown, no code blocks):
{
  "zoom_regions_examined": ["region1", "region2"],
  "key_findings": "detailed narrative of what was found across all inspected regions",
  "confidence_boost": 0,
  "identification_correction": "string describing correction, or null if no correction needed"
}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [
          ...imageParts,
          {
            text: `Perform agentic visual inspection on this ${domain.replace("_", " ")} item: "${itemName}". Use code execution to zoom into and examine the key regions listed in your instructions.`,
          },
        ],
      },
    ],
    tools: [
      { codeExecution: {} },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
    },
  };

  const resp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
    STAGE_B_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn(`${label}[StageB] ${VISION_MODEL} returned ${resp.status}: ${errText.slice(0, 300)}`);
    return null;
  }

  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  // Collect all text parts — model interleaves tool use + text in response
  let rawText = "";
  for (const part of parts) {
    if (part.text) rawText += part.text;
  }

  if (!rawText || rawText.trim().length < 10) {
    console.warn(`${label}[StageB] Empty vision response`);
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch (e) {
    console.warn(`${label}[StageB] JSON parse failed: ${String(e)}. Raw: ${rawText.slice(0, 200)}`);
    return null;
  }

  const zoomRegions = Array.isArray(parsed.zoom_regions_examined)
    ? parsed.zoom_regions_examined.map(String).filter((s: string) => s.length > 0)
    : [];
  const keyFindings = typeof parsed.key_findings === "string" ? parsed.key_findings.trim() : "";
  const confidenceBoost = typeof parsed.confidence_boost === "number"
    ? Math.min(100, Math.max(0, Math.round(parsed.confidence_boost)))
    : 0;
  const identificationCorrection =
    typeof parsed.identification_correction === "string" &&
    parsed.identification_correction.trim().length > 5
      ? parsed.identification_correction.trim()
      : undefined;

  if (keyFindings.length <= 5 && zoomRegions.length === 0) {
    console.warn(`${label}[StageB] Inspection returned no meaningful findings`);
    return null;
  }

  console.log(`${label}[StageB] ✓ model=${VISION_MODEL} regions=${zoomRegions.length} confidenceBoost=${confidenceBoost} hasCorrection=${!!identificationCorrection}`);

  return {
    zoomRegionsExamined: zoomRegions,
    keyFindings,
    confidenceBoost,
    identificationCorrection,
  };
}

// ─── Main export: runAgenticPrePass ───────────────────────────────────────────

/**
 * Runs the two-stage agentic pre-pass concurrently:
 *
 *   Stage A (gemini-2.5-flash)       — googleSearch for eBay category + market pricing
 *   Stage B (gemini-3-flash-preview) — codeExecution vision inspection on images
 *
 * Both stages run in parallel via Promise.allSettled.
 * Either stage may fail independently without affecting the other or the
 * main analyze-item pipeline. Returns PrePassResult or null if both fail.
 */
export async function runAgenticPrePass(
  apiKey: string,
  domain: Domain,
  itemName: string,
  imageBase64List: string[],   // raw base64 strings (no data: prefix needed)
  imageMimeTypes: string[],
  invocationId: string,
): Promise<PrePassResult | null> {
  const label = `[${invocationId}][PrePass0]`;

  console.log(`${label} Starting two-stage pre-pass for "${itemName}" domain=${domain} images=${imageBase64List.length}`);
  console.log(`${label} Stage A → ${GROUNDING_MODEL} (googleSearch) | Stage B → ${VISION_MODEL} (codeExecution+vision)`);

  try {
    // Run both stages concurrently — neither blocks the other
    const [stageASettled, stageBSettled] = await Promise.allSettled([
      runStageA(apiKey, domain, itemName, label).catch((err) => {
        const reason = err instanceof Error && err.name === "AbortError"
          ? `timed out after ${STAGE_A_TIMEOUT_MS}ms`
          : String(err);
        console.warn(`${label}[StageA] Failed: ${reason}`);
        return { marketAnalysis: null, groundedCategoryId: null };
      }),
      runStageB(apiKey, domain, itemName, imageBase64List, imageMimeTypes, label).catch((err) => {
        const reason = err instanceof Error && err.name === "AbortError"
          ? `timed out after ${STAGE_B_TIMEOUT_MS}ms`
          : String(err);
        console.warn(`${label}[StageB] Failed: ${reason}`);
        return null;
      }),
    ]);

    const stageA = stageASettled.status === "fulfilled"
      ? stageASettled.value
      : { marketAnalysis: null, groundedCategoryId: null };

    const stageB = stageBSettled.status === "fulfilled"
      ? stageBSettled.value
      : null;

    const result: PrePassResult = {
      marketAnalysis: stageA.marketAnalysis,
      groundedCategoryId: stageA.groundedCategoryId,
      agenticInspection: stageB,
    };

    // Return null only if both stages produced nothing useful
    const hasAnyResult =
      result.marketAnalysis !== null ||
      result.groundedCategoryId !== null ||
      result.agenticInspection !== null;

    if (!hasAnyResult) {
      console.warn(`${label} Both stages returned no results — returning null`);
      return null;
    }

    console.log(`${label} ✓ Pre-Pass 0 complete:`, {
      stageA_model: GROUNDING_MODEL,
      stageB_model: VISION_MODEL,
      hasMarketAnalysis: !!result.marketAnalysis,
      groundedCategoryId: result.groundedCategoryId,
      inspectionRegions: result.agenticInspection?.zoomRegionsExamined?.length ?? 0,
      confidenceBoost: result.agenticInspection?.confidenceBoost ?? 0,
      hasCorrection: !!result.agenticInspection?.identificationCorrection,
    });

    return result;
  } catch (err) {
    console.warn(`${label} Pre-Pass 0 unexpected failure (non-blocking): ${String(err)}`);
    return null;
  }
}