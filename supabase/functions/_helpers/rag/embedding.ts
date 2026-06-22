/**
 * embedding.ts
 * Helper to generate embeddings using Gemini's gemini-embedding-001 model.
 */

export async function getEmbedding(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
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
