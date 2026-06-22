/**
 * seed-knowledge-base.js
 * Ingests ANA standards and sample sales history into the Supabase knowledge_base.
 *
 * Usage:
 * SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GEMINI_API_KEY=... node scripts/seed-knowledge-base.js
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  console.error("Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANA_STANDARDS = [
  {
    category: "grading_standard",
    content:
      "MS-70 (Perfect Uncirculated): A coin with no trace of wear, no visible marks, and full original luster. Eye appeal is outstanding.",
    metadata: { series: "general", grade: 70, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "MS-65 (Choice Uncirculated): A coin with full luster and very few minor marks or hairlines. None of the marks are in focal points.",
    metadata: { series: "general", grade: 65, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "MS-63 (Select Uncirculated): A coin with full luster but allows for minor bag marks or contact marks, even in focal points.",
    metadata: { series: "general", grade: 63, letter: "MS" },
  },
  {
    category: "grading_standard",
    content:
      "AU-58 (Choice About Uncirculated): Only the slightest trace of wear on the highest points of the design. Full luster remains in the fields.",
    metadata: { series: "general", grade: 58, letter: "AU" },
  },
  {
    category: "grading_standard",
    content:
      "EF-45 (Choice Extremely Fine): Typical light wear on all high points. Nearly all design details remain sharp.",
    metadata: { series: "general", grade: 45, letter: "EF" },
  },
  {
    category: "grading_standard",
    content:
      "VF-20 (Very Fine): Moderate wear on the high points. All major design elements are visible, though somewhat flattened.",
    metadata: { series: "general", grade: 20, letter: "VF" },
  },
];

async function getEmbedding(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
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
    throw new Error(`Gemini API Error: ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

async function main() {
  console.log("Starting knowledge base ingestion...");

  for (const item of ANA_STANDARDS) {
    console.log(`Ingesting: ${item.content.substring(0, 50)}...`);
    try {
      const embedding = await getEmbedding(item.content);
      const { error } = await supabase.from("knowledge_base").insert({
        content: item.content,
        metadata: item.metadata,
        category: item.category,
        embedding: embedding,
      });

      if (error) console.error("Supabase Error:", error);
    } catch (e) {
      console.error("Failed to ingest item:", e.message);
    }
  }

  console.log("Ingestion complete.");
}

main();
