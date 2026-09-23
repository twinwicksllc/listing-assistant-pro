/**
 * visual-agent.ts
 * Sub-agent specialized in precision vision tasks — a single plain-vision
 * inspection pass over the item's photos (no tool use; see 2026-09-23 fix
 * below for why codeExecution was removed).
 */

import { AgentContext, VisualInspectionResult } from "../pipelineContracts.ts";
import { DOMAIN_RAG_CATEGORIES, DomainDefinition } from "../registry.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getEmbedding } from "../../rag/embedding.ts";
import { findSimilarContext, formatRagResults } from "../../rag/retriever.ts";
import { GEMINI_FAST_MODEL } from "../../geminiModels.ts";
import { fetchWithTimeout, PIPELINE_TIMEOUTS_MS, withDeadline } from "../../fetchWithTimeout.ts";

export async function runAgenticVisualAgent(
  apiKey: string,
  domainDef: DomainDefinition,
  context: AgentContext,
  supabase: ReturnType<typeof createClient<any>>,
): Promise<VisualInspectionResult> {
  const { invocationId, imageList } = context;
  console.log(
    `[${invocationId}] VisualAgent: Running precision inspection for ${domainDef.domain}`,
  );

  // --- RAG: Augmented Context from Domain-Specific Knowledge Base ---
  // Generalized lookup (see DOMAIN_RAG_CATEGORIES in registry.ts) - not hardcoded
  // to coins_bullion anymore. Any domain with an entry in the mapping gets its
  // relevant knowledge_base category queried; domains without an entry simply
  // skip RAG injection (no behavior change for them).
  let ragContext = "";
  const ragCategories = DOMAIN_RAG_CATEGORIES[domainDef.domain] ?? [];
  if (ragCategories.length > 0) {
    try {
      // Use pre-computed embedding from controller if available; fall back to generating one
      const embedding = context.queryEmbedding ??
        (await getEmbedding(
          apiKey,
          context.identification?.itemName || domainDef.domain,
        ));
      for (const category of ragCategories) {
        const results = await findSimilarContext(
          supabase,
          embedding,
          category,
          undefined,
          undefined,
          withDeadline(PIPELINE_TIMEOUTS_MS.ragRetrieval, context.deadline),
        );
        if (results.length > 0) {
          ragContext = formatRagResults(results);
          console.log(
            `[${invocationId}] VisualAgent: Injected ${results.length} "${category}" reference(s) for domain ${domainDef.domain}.`,
          );
          break;
        }
      }
    } catch (ragErr) {
      console.warn(`[${invocationId}] VisualAgent RAG failed:`, ragErr);
    }
  }

  // Base64 parsing (Simplified for now - in production use existing parser)
  const visionImages = imageList.map((img) => {
    const base64 = img.includes(",") ? img.split(",")[1] : img;
    const mimeMatch = img.match(/^data:(image\/\w+);/);
    return {
      inlineData: {
        data: base64,
        mimeType: mimeMatch ? mimeMatch[1] : "image/jpeg",
      },
    };
  });

  const zoomTargets = domainDef.visionGoals
    .map((g) => `- **${g.region}**: ${g.rationale}`)
    .join("\n");

  const prompt =
    `You are an expert precision vision agent. Your task is to perform a detailed visual inspection of the item in the images.
Domain: ${domainDef.domain}
Item Identification: ${context.identification?.itemName}

${
      ragContext
        ? `### VERIFIED REFERENCE STANDARDS:\nUse these verified domain standards to guide your inspection:\n${ragContext}\n`
        : ""
    }

### PRECISION INSPECTION GOALS:
${zoomTargets}

### INSTRUCTIONS:
1. Examine each region mentioned in the inspection goals directly in the provided images. Do not write or run code — look at the images as given.
2. For each region, describe exactly what you see.
3. If you find information that contradicts the initial identification, note it in 'identification_correction'.
4. Assess your confidence based on the clarity of your visual findings.

### CRITICAL: DO NOT GUESS. REPORT "NOT_VISIBLE" INSTEAD.
A confident-sounding answer is only correct if you can actually see and read it in a photo.
Recognizing that an item's type/series/year SOMETIMES has a particular mark, feature, or
variant is NOT evidence that THIS SPECIFIC item has it. If a region isn't photographed
clearly enough to read, or nothing distinguishing is actually visible there:
- Set that attribute's value to the literal string "NOT_VISIBLE" (not your best guess).
- Before answering, briefly state what you actually observed in that region — the raw visual
  evidence — then give your answer based ONLY on that observation, not on general knowledge
  about what that type of item usually has.
A wrong, invented answer is worse than an honest "NOT_VISIBLE".

You must return your findings in JSON format:
{
  "visualEvidence": "Brief, literal description of what you actually observed in each inspected region, before drawing any conclusion.",
  "zoomRegionsExamined": ["region1", "region2"],
  "keyFindings": "Detailed summary of findings...",
  "confidenceBoost": 85,
  "identificationCorrection": "string or null",
  "capturedAttributes": {
    "Year": "1876",
    "Mint Mark": "D",
    "Denomination": "10C",
    "Strike Type": "Business",
    "Composition": "NOT_VISIBLE"
  }
} (Only include attributes you are ≥90% confident in, OR "NOT_VISIBLE" for a region you inspected but couldn't read. Use eBay-friendly values.)`;

  // Flash tier for every domain, including coins_bullion (2026-09-23): Gemini
  // guidance (asked directly about this stage's latency and hallucination
  // problems) confirmed both Flash and Pro share the same underlying 768x768
  // vision-tile tokenization, so optical fidelity for reading small printed
  // text is identical across tiers -- the difference is in reasoning weights,
  // and Pro's larger parameter count was MORE likely to let general-knowledge
  // "this series sometimes has X" reasoning override thin/ambiguous visual
  // evidence and confabulate a specific, wrong answer (the repeated coin
  // "variety" hallucination this fix responds to). Flash acts closer to a
  // pure OCR pass. If real-world slab-label accuracy regresses on Flash,
  // revisit -- but per that guidance there is no expected optical downside.
  const visualModel = GEMINI_FAST_MODEL;

  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${visualModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [...visionImages, { text: prompt }],
            },
          ],
          // codeExecution removed (2026-09-23): it drove this stage's 40-90s
          // latency via an agentic crop/zoom loop (each round-trip ~10-20s),
          // but Gemini's own guidance confirmed it bought nothing here --
          // our client already downscales to 1200px max dimension, and
          // Gemini's native vision pipeline tiles images at 768x768 with 1:1
          // pixel fidelity on an image this size. Cropping a 1200px JPEG via
          // code execution re-examines the SAME already-compressed pixels; it
          // does not recover detail lost to the earlier client-side resize.
          // A single plain vision pass gets the same optical information in
          // one round-trip instead of several.
        }),
      },
      // Largest budget in the pipeline by design -- kept even after dropping
      // codeExecution, since this is still the accuracy-critical stage and a
      // hung call should fail via this ceiling, not eat the gateway's 150s.
      // Actual observed latency should drop substantially now that the
      // multi-round tool loop is gone; revisit this budget once real-traffic
      // numbers are in rather than assuming the improvement up front.
      withDeadline(PIPELINE_TIMEOUTS_MS.visualAgent, context.deadline),
      "VisualAgent precision inspection",
    );

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    const data = await response.json();

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Strip markdown code fences (```json...``` or ```...```) that Gemini sometimes adds around JSON
    const cleanText = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "");
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        // "NOT_VISIBLE" (and empty-after-trim) are the prompt's explicit
        // escape hatch for "I inspected this region but can't confirm a
        // value" -- dropped here rather than passed through, because every
        // downstream consumer (domainPrompts.ts's listing-generation prompt)
        // treats every key present in capturedAttributes as a confirmed,
        // ground-truth value to inject verbatim. Letting the literal string
        // "NOT_VISIBLE" reach that path would make it into a real (wrong)
        // item specific instead of just being absent, which is the opposite
        // of what the escape hatch exists to do.
        const capturedAttributes = parsed?.capturedAttributes &&
            typeof parsed.capturedAttributes === "object"
          ? Object.fromEntries(
            Object.entries(
              parsed.capturedAttributes as Record<string, unknown>,
            )
              .filter(
                (entry): entry is [string, string] =>
                  typeof entry[0] === "string" &&
                  typeof entry[1] === "string",
              )
              .map(([k, v]) => [k.trim(), v.trim()])
              .filter(
                ([, v]) => v.length > 0 && v.toUpperCase() !== "NOT_VISIBLE",
              ),
          )
          : undefined;
        // Validate confidence at the boundary rather than trusting the model.
        // `parsed.confidenceBoost || 50` used to pass a non-numeric value like
        // "high" straight through, and every downstream consumer compares it
        // numerically (controller.ts gates identificationCorrection on >= 70,
        // slabOcrGate on < 70). NaN comparisons are always false, so a garbage
        // value silently defeated both guards. Fall back to the neutral 50,
        // which sits below every threshold and so fails safe.
        const rawBoost = parsed.confidenceBoost;
        const confidenceBoost = typeof rawBoost === "number" && Number.isFinite(rawBoost) ? rawBoost : 50;

        return {
          zoomRegionsExamined: parsed.zoomRegionsExamined || [],
          keyFindings: parsed.keyFindings || "Incomplete findings provided.",
          confidenceBoost,
          identificationCorrection: parsed.identificationCorrection || null,
          capturedAttributes,
        };
      } catch (pErr) {
        console.warn(
          `[${invocationId}] VisualAgent: Failed to parse JSON response:`,
          pErr,
        );
      }
    }

    return {
      zoomRegionsExamined: domainDef.visionGoals.map((g) => g.region),
      keyFindings: "Visual inspection completed (fallback parsing).",
      confidenceBoost: 70,
    };
  } catch (err) {
    console.warn(`[${invocationId}] VisualAgent failed (non-blocking):`, err);
    return {
      zoomRegionsExamined: [],
      keyFindings: "Visual inspection failed to run.",
      confidenceBoost: 0,
    };
  }
}
