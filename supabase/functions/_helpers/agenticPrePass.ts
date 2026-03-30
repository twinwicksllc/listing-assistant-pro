/**
 * agenticPrePass.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-Pass 0: Agentic Grounding + Vision Inspection
 *
 * Uses the NATIVE Gemini generateContent API (NOT the OpenAI-compat shim) so
 * that we can leverage:
 *   • google_search built-in tool  → Real-Time Category & Comp Grounding
 *   • code_execution built-in tool → Agentic Vision Think-Act-Observe loop
 *
 * This runs BEFORE Pass 1 & Pass 2 in analyze-item/index.ts.
 * Its output is injected into the Pass 2 system prompt via `prePassContext`
 * in PromptContext (domainPrompts.ts).
 *
 * DESIGN PRINCIPLES:
 *   - Non-blocking: any failure returns null, letting existing pipeline run unchanged
 *   - Additive: new fields (market_analysis, grounded_category_id, agentic_inspection)
 *     are returned alongside — never replacing — existing response fields
 *   - Fast: 8-second timeout so it doesn't slow the overall pipeline significantly
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

// ─── Domain-specific search query templates ──────────────────────────────────

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

// ─── Domain-specific zoom targets for vision inspection ──────────────────────

interface ZoomTarget {
  region: string;
  rationale: string;
}

function getZoomTargets(domain: Domain): ZoomTarget[] {
  switch (domain) {
    case "coins_bullion":
      return [
        { region: "date digits",   rationale: "Critical for correct year — misreading 1964 vs 1965 Kennedy Half Dollar changes silver content from 90% to 40%" },
        { region: "mint mark",     rationale: "Location above/below date or on reverse; determines rarity and value (e.g., CC, S, D, O, W marks)" },
        { region: "edge reeds",    rationale: "Helps verify denomination and detect cleaned/altered coins" },
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
        { region: "hallmarks and stamps",  rationale: "Karat, maker's mark, assay office mark — determines metal purity and authenticity" },
        { region: "clasp and findings",     rationale: "Condition of clasp, prong integrity, stone security" },
        { region: "stone clarity and color", rationale: "Visible inclusions, chips, or loose stones affect value significantly" },
        { region: "brand signatures",       rationale: "Hidden signatures (Tiffany, Cartier, etc.) dramatically increase value" },
      ];
    case "electronics":
      return [
        { region: "model number sticker",   rationale: "Exact model/SKU determines correct eBay category and price point" },
        { region: "ports and connectors",   rationale: "Damaged ports (bent pins, broken USB-C) are major value detractors" },
        { region: "screen condition",       rationale: "Dead pixels, scratches, backlight bleed affect condition grade" },
        { region: "serial/IMEI sticker",    rationale: "Confirms device identity and can indicate carrier lock status" },
      ];
    case "vintage_clothing":
      return [
        { region: "brand and size label",        rationale: "Vintage sizing runs 1–2 sizes smaller; correct size drives search traffic" },
        { region: "care instruction label",       rationale: "Absence of care label = pre-1971 US; helps date the piece" },
        { region: "fabric and seam condition",    rationale: "Rips, snags, thin spots, and seam separation are critical disclosures" },
        { region: "union label if present",       rationale: "ILGWU/ACWA dates item to 1940s–1970s; UNITE = 1995+" },
      ];
    default:
      return [
        { region: "brand markings",    rationale: "Identifies maker and model" },
        { region: "condition details", rationale: "Visible wear, damage, or flaws" },
        { region: "label or sticker",  rationale: "Model number, serial, or spec information" },
      ];
  }
}

// ─── Native Gemini API call with grounding + code execution ──────────────────

const PRE_PASS_TIMEOUT_MS = 12_000; // 12 seconds — generous but bounded

/**
 * Calls the native Gemini generateContent API with both googleSearch and
 * codeExecution tools enabled. Returns structured PrePassResult or null on
 * any failure.
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

  try {
    const searchQueries = buildSearchQueries(domain, itemName);
    const zoomTargets = getZoomTargets(domain);

    // ── Build image parts (use up to 3 images for pre-pass) ──
    const imagePartsForPrePass = imageBase64List.slice(0, 3).map((b64, i) => ({
      inlineData: {
        mimeType: imageMimeTypes[i] ?? "image/jpeg",
        data: b64,
      },
    }));

    // ── Construct the Pre-Pass 0 prompt ──
    const zoomInstructions = zoomTargets.map(
      (t, i) => `${i + 1}. **${t.region}**: ${t.rationale}`
    ).join("\n");

    const systemInstruction = `You are an expert eBay listing analyst performing a two-part agentic pre-analysis:

## PART A — Google Search Grounding
Use the Google Search tool to find:
1. The current 2026 eBay LEAF category ID for: "${itemName}" (domain: ${domain})
2. Recently sold eBay prices for this item type, including any qualitative value factors:
   ${searchQueries.map((q, i) => `Query ${i + 1}: ${q}`).join("\n   ")}

After searching, produce a JSON object with:
- "grounded_category_id": the specific eBay leaf category ID you found (string, or null if not found)
- "market_analysis": a 2–4 sentence narrative citing specific search results. Include:
  • Price range and median from recently sold listings
  • Any qualitative premiums/discounts found (e.g., mint marks, errors, accessory completeness, size specificity)
  • Any market trend insights (e.g., "1964-D Peace Dollar errors sell for 15–20% premium over standard examples")

## PART B — Agentic Visual Inspection (Think-Act-Observe)
Using the code_execution tool, perform a Think-Act-Observe inspection loop on the provided image(s):

**THINK**: Which regions need closer examination for this ${domain} item?
Focus regions for this domain:
${zoomInstructions}

**ACT**: Write and execute Python code that:
1. Prints which region you are "examining" (as if zooming in)
2. States in detail what you observe in that region
3. Notes any identification-critical findings (dates, marks, labels, damage)

**OBSERVE**: Based on the execution output, state your final findings:
- "zoom_regions_examined": list of regions you inspected
- "key_findings": detailed narrative of what was found
- "confidence_boost": integer 0–100 indicating how much more certain you are after inspection
- "identification_correction": if inspection revealed the initial identification was wrong, state the correction here. Otherwise omit or set to null.

## FINAL OUTPUT
Return ONLY a single valid JSON object (no markdown, no code blocks):
{
  "grounded_category_id": "string or null",
  "market_analysis": "string",
  "zoom_regions_examined": ["region1", "region2"],
  "key_findings": "string",
  "confidence_boost": 0,
  "identification_correction": "string or null"
}`;

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [
            ...imagePartsForPrePass,
            {
              text: `Analyze this ${domain.replace("_", " ")} item: "${itemName}". Perform the Google Search grounding and visual inspection as instructed.`,
            },
          ],
        },
      ],
      tools: [
        { googleSearch: {} },
        { codeExecution: {} },
      ],
      generationConfig: {
        temperature: 0.1,       // Low temp for factual grounding
        maxOutputTokens: 1500,
        responseMimeType: "application/json",
      },
    };

    console.log(`${label} Starting Pre-Pass 0 (grounding + code_execution) for "${itemName}" domain=${domain}`);

    // Use AbortController for the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PRE_PASS_TIMEOUT_MS);

    let nativeResp: Response;
    try {
      nativeResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!nativeResp.ok) {
      const errText = await nativeResp.text();
      console.warn(`${label} Native API returned ${nativeResp.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const nativeData = await nativeResp.json();

    // ── Extract the text response from generateContent format ──
    // The response may have multiple parts (tool use interleaved with text).
    // We look for the final text part that contains our JSON.
    const candidates = nativeData.candidates ?? [];
    if (candidates.length === 0) {
      console.warn(`${label} No candidates in response`);
      return null;
    }

    const parts = candidates[0]?.content?.parts ?? [];
    let rawText = "";
    for (const part of parts) {
      if (part.text) rawText += part.text;
    }

    if (!rawText || rawText.trim().length < 10) {
      console.warn(`${label} Empty or minimal text response from pre-pass`);
      return null;
    }

    console.log(`${label} Raw response (${rawText.length} chars): ${rawText.slice(0, 400)}`);

    // ── Parse JSON from the response ──
    // The model is instructed to return only JSON, but it may wrap in ```json
    let jsonText = rawText.trim();
    // Strip possible markdown code fences
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    // Find the JSON object boundaries if there's surrounding text
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.warn(`${label} JSON parse failed: ${String(parseErr)}. Raw: ${jsonText.slice(0, 200)}`);
      return null;
    }

    // ── Build structured result ──
    const result: PrePassResult = {
      marketAnalysis: typeof parsed.market_analysis === "string" && parsed.market_analysis.trim().length > 5
        ? parsed.market_analysis.trim()
        : null,
      groundedCategoryId: typeof parsed.grounded_category_id === "string" && /^\d+$/.test(parsed.grounded_category_id.trim())
        ? parsed.grounded_category_id.trim()
        : null,
      agenticInspection: null,
    };

    // Parse inspection findings
    const zoomRegions = Array.isArray(parsed.zoom_regions_examined)
      ? parsed.zoom_regions_examined.map(String).filter((s: string) => s.length > 0)
      : [];
    const keyFindings = typeof parsed.key_findings === "string" ? parsed.key_findings.trim() : "";
    const confidenceBoost = typeof parsed.confidence_boost === "number"
      ? Math.min(100, Math.max(0, Math.round(parsed.confidence_boost)))
      : 0;
    const identificationCorrection = typeof parsed.identification_correction === "string" &&
      parsed.identification_correction.trim().length > 5
      ? parsed.identification_correction.trim()
      : undefined;

    if (keyFindings.length > 5 || zoomRegions.length > 0) {
      result.agenticInspection = {
        zoomRegionsExamined: zoomRegions,
        keyFindings,
        confidenceBoost,
        identificationCorrection,
      };
    }

    console.log(`${label} ✓ Pre-Pass 0 complete:`, {
      hasMarketAnalysis: !!result.marketAnalysis,
      groundedCategoryId: result.groundedCategoryId,
      inspectionRegions: result.agenticInspection?.zoomRegionsExamined?.length ?? 0,
      confidenceBoost: result.agenticInspection?.confidenceBoost ?? 0,
      hasCorrection: !!result.agenticInspection?.identificationCorrection,
    });

    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`${label} Pre-Pass 0 timed out after ${PRE_PASS_TIMEOUT_MS}ms — continuing without grounding`);
    } else {
      console.warn(`${label} Pre-Pass 0 failed (non-blocking): ${String(err)}`);
    }
    return null;
  }
}