/**
 * market-agent.ts
 * Sub-agent specialized in grounding item metadata and pricing via Google Search.
 */

import { AgentContext, MarketDataReport } from "../pipelineContracts.ts";
import { DomainDefinition } from "../registry.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getEmbedding } from "../../rag/embedding.ts";
import { findSimilarContext, formatRagResults } from "../../rag/retriever.ts";

export async function runMarketAgent(
  apiKey: string,
  domainDef: DomainDefinition,
  context: AgentContext,
  supabase: ReturnType<typeof createClient<any>>,
): Promise<MarketDataReport> {
  const { invocationId, identification } = context;
  const itemName = identification?.itemName || "item";

  console.log(`[${invocationId}] MarketAgent: Grounding market data for ${itemName}`);

  // --- RAG: Augmented Context from Sales History ---
  let ragContext = "";
  try {
    // Use pre-computed embedding from controller if available; fall back to generating one
    const embedding = context.queryEmbedding ?? await getEmbedding(apiKey, itemName);
    const results = await findSimilarContext(supabase, embedding, "sales_history");
    ragContext = formatRagResults(results);
    if (ragContext) {
      console.log(`[${invocationId}] MarketAgent: Injected ${results.length} sales history references.`);
    }
  } catch (ragErr) {
    console.warn(`[${invocationId}] MarketAgent RAG failed:`, ragErr);
  }

  const queries = domainDef.groundingQueries(itemName);

  const prompt = `You are a market data analyst. Use Google Search to ground the following item for eBay listing.
Item: ${itemName}
Domain: ${domainDef.domain}

${
    ragContext
      ? `### INTERNAL SALES HISTORY:\nThe following items from our internal sales history are similar to this item:\n${ragContext}\n`
      : ""
  }

### TASKS:
1. Find the most accurate 2026 eBay Leaf Category ID for this item.
2. Research recently sold prices and market nuances (premiums, typical defects, high-value variants).

### SEARCH QUERIES:
${queries.map((q) => `- ${q}`).join("\n")}

Return your report in JSON format:
{
  "marketAnalysis": "Detailed search results and market trends...",
  "groundedCategoryId": "12345"
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }],
          }],
          tools: [{ googleSearch: {} }],
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
          marketAnalysis: parsed.marketAnalysis || "Search completed with no detailed analysis.",
          groundedCategoryId: parsed.groundedCategoryId || null,
        };
      } catch (pErr) {
        console.warn(`[${invocationId}] MarketAgent: Failed to parse JSON response:`, pErr);
      }
    }

    return {
      marketAnalysis: `Grounded search completed for ${itemName} in ${domainDef.domain}.`,
      groundedCategoryId: null,
    };
  } catch (err) {
    console.warn(`[${invocationId}] MarketAgent failed (non-blocking):`, err);
    return {
      marketAnalysis: null,
      groundedCategoryId: null,
    };
  }
}
