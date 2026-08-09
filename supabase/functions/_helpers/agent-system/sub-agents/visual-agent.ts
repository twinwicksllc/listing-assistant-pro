/**
 * visual-agent.ts
 * Sub-agent specialized in precision vision tasks using Gemini 3's code execution.
 */

import { AgentContext, VisualInspectionResult } from "../pipelineContracts.ts";
import { DOMAIN_RAG_CATEGORIES, DomainDefinition } from "../registry.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getEmbedding } from "../../rag/embedding.ts";
import { findSimilarContext, formatRagResults } from "../../rag/retriever.ts";

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
      const embedding =
        context.queryEmbedding ??
        (await getEmbedding(
          apiKey,
          context.identification?.itemName || domainDef.domain,
        ));
      for (const category of ragCategories) {
        const results = await findSimilarContext(supabase, embedding, category);
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

  const prompt = `You are an expert precision vision agent. Your task is to perform a detailed visual inspection of the item in the images.
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
1. Use your code_execution tool to perform virtual crops or zooms on the areas mentioned in the inspection goals.
2. For each region, describe exactly what you see.
3. If you find information that contradicts the initial identification, note it in 'identification_correction'.
4. Assess your confidence based on the clarity of your visual findings.

You must return your findings in JSON format:
{
  "zoomRegionsExamined": ["region1", "region2"],
  "keyFindings": "Detailed summary of findings...",
  "confidenceBoost": 85,
  "identificationCorrection": "string or null",
  "capturedAttributes": {
    "Year": "1876",
    "Mint Mark": "D",
    "Denomination": "10C",
    "Strike Type": "Business",
    "Composition": "Silver"
  }
} (Only include attributes you are ≥90% confident in. Use eBay-friendly values.)`;

  // Use the stronger model for coins_bullion — precision slab label reading demands it.
  // For other domains, gemini-2.0-flash is fast and sufficient.
  const visualModel =
    domainDef.domain === "coins_bullion"
      ? "gemini-3.1-pro-preview"
      : "gemini-2.0-flash";

  try {
    const response = await fetch(
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
          tools: [{ codeExecution: {} }],
        }),
      },
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
        const capturedAttributes =
          parsed?.capturedAttributes &&
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
                  .map(([k, v]) => [k.trim(), v.trim()]),
              )
            : undefined;
        return {
          zoomRegionsExamined: parsed.zoomRegionsExamined || [],
          keyFindings: parsed.keyFindings || "Incomplete findings provided.",
          confidenceBoost: parsed.confidenceBoost || 50,
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
