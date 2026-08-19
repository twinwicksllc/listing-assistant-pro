/**
 * embedding.ts
 * Helper to generate embeddings using GEMINI_EMBEDDING_MODEL (see geminiModels.ts).
 * Swapping this model requires re-embedding existing knowledge_base rows --
 * see backfill-knowledge-base-embeddings -- since two different embedding
 * models don't produce comparable vector spaces even at the same dimension.
 */

import { GEMINI_EMBEDDING_MODEL } from "../geminiModels.ts";

export async function getEmbedding(
  apiKey: string,
  text: string,
): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Embedding API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}
