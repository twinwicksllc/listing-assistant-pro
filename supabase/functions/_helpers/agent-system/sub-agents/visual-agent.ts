/**
 * visual-agent.ts
 * Sub-agent specialized in precision vision tasks using Gemini 3's code execution.
 */

import { AgentContext, VisualInspectionResult } from "../pipelineContracts.ts";
import { DomainDefinition } from "../registry.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getEmbedding } from "../../rag/embedding.ts";
import { findSimilarContext, formatRagResults } from "../../rag/retriever.ts";

export async function runAgenticVisualAgent(
  apiKey: string,
  domainDef: DomainDefinition,
  context: AgentContext,
  supabase: ReturnType<typeof createClient>,
): Promise<VisualInspectionResult> {
  const { invocationId, imageList } = context;
  console.log(`[${invocationId}] VisualAgent: Running precision inspection for ${domainDef.domain}`);

  // --- RAG: Augmented Context from Grading Standards ---
  let ragContext = "";
  if (domainDef.domain === "coins_bullion") {
    try {
      // Use pre-computed embedding from controller if available; fall back to generating one
      const embedding = context.queryEmbedding ??
        await getEmbedding(apiKey, context.identification?.itemName || domainDef.domain);
      const results = await findSimilarContext(supabase, embedding, "grading_standard");
      ragContext = formatRagResults(results);
      if (ragContext) {
        console.log(`[${invocationId}] VisualAgent: Injected ${results.length} grading standard references.`);
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

  const zoomTargets = domainDef.visionGoals.map((g) => `- **${g.region}**: ${g.rationale}`).join("\n");

  const prompt =
    `You are an expert precision vision agent. Your task is to perform a detailed visual inspection of the item in the images.
Domain: ${domainDef.domain}
Item Identification: ${context.identification?.itemName}

${
      ragContext
        ? `### GRADING STANDARDS & CRITERIA:\nUse these verified standards to guide your inspection:\n${ragContext}\n`
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
  "identificationCorrection": "string or null"
}`;

  // Use the stronger model for coins_bullion — precision slab label reading demands it.
  // For other domains, gemini-2.0-flash is fast and sufficient.
  const visualModel = domainDef.domain === "coins_bullion" ? "gemini-3.1-pro-preview" : "gemini-2.0-flash";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${visualModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              ...visionImages,
              { text: prompt },
            ],
          }],
          tools: [{ codeExecution: {} }],
        }),
      },
    );

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
    const data = await response.json();

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Strip markdown code fences (```json...``` or ```...```) that Gemini sometimes adds around JSON
    const cleanText = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          zoomRegionsExamined: parsed.zoomRegionsExamined || [],
          keyFindings: parsed.keyFindings || "Incomplete findings provided.",
          confidenceBoost: parsed.confidenceBoost || 50,
          identificationCorrection: parsed.identificationCorrection || null,
        };
      } catch (pErr) {
        console.warn(`[${invocationId}] VisualAgent: Failed to parse JSON response:`, pErr);
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
