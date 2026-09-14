import type { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PIPELINE_TIMEOUTS_MS, withTimeout } from "../fetchWithTimeout.ts";

export interface RagContext {
  content: string;
  metadata: any;
  similarity: number;
}

/**
 * Searches the knowledge base for content similar to the query.
 * Uses vector similarity search (cosine distance).
 *
 * Bounded by PIPELINE_TIMEOUTS_MS.ragRetrieval. Both sub-agents call this
 * BEFORE their (bounded) Gemini request, so an unbounded RPC here could consume
 * the whole gateway budget ahead of every other ceiling in the pipeline. RAG is
 * grounding, not a hard requirement -- a timeout degrades to the same empty
 * result an error already does, and the caller proceeds ungrounded.
 */
export async function findSimilarContext(
  supabase: ReturnType<typeof createClient<any>>,
  queryEmbedding: number[],
  category: string,
  matchThreshold: number = 0.5,
  matchCount: number = 5,
  timeoutMs: number = PIPELINE_TIMEOUTS_MS.ragRetrieval,
): Promise<RagContext[]> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase.rpc("match_knowledge_base", {
          query_embedding: queryEmbedding,
          match_threshold: matchThreshold,
          match_count: matchCount,
          filter_category: category,
        }),
      ),
      timeoutMs,
      `RAG retrieval (${category})`,
    );

    if (error) {
      console.error("RAG: Error fetching similar context:", error);
      return [];
    }

    return (data || []) as RagContext[];
  } catch (err) {
    // Timed out (or the client threw). Same degradation as the error path above.
    console.warn("RAG: Retrieval failed, proceeding without grounding:", err);
    return [];
  }
}

/**
 * Formats RAG results into a string for injection into a prompt.
 */
export function formatRagResults(results: RagContext[]): string {
  if (results.length === 0) return "";

  return results
    .map((r, i) => `[Reference ${i + 1}]: ${r.content}`)
    .join("\n\n");
}
