import { createClient } from "npm:@supabase/supabase-js@2.43.4";

export interface RagContext {
  content: string;
  metadata: any;
  similarity: number;
}

/**
 * Searches the knowledge base for content similar to the query.
 * Uses vector similarity search (cosine distance).
 */
export async function findSimilarContext(
  supabase: ReturnType<typeof createClient>,
  queryEmbedding: number[],
  category: string,
  matchThreshold: number = 0.5,
  matchCount: number = 5,
): Promise<RagContext[]> {
  const { data, error } = await supabase.rpc("match_knowledge_base", {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_category: category,
  });

  if (error) {
    console.error("RAG: Error fetching similar context:", error);
    return [];
  }

  return (data || []) as RagContext[];
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
