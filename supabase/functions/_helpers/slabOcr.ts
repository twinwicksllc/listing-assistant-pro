/**
 * slabOcr.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GPT-4o Vision OCR for grading slab labels.
 *
 * Gemini consistently misreads small printed digits on PCGS/NGC slab labels
 * (most commonly "2026" → "2020"). This module sends the images to GPT-4o
 * with a single focused task: extract the text from any visible slab label.
 *
 * GPT-4o is used ONLY for OCR here — it returns structured JSON with the
 * label text. That result is then injected as authoritative ground truth
 * into the Gemini listing prompt, so Gemini never has to read the label.
 *
 * This replaces the post-hoc override approach with a pre-pass that gives
 * Gemini the correct data from the start.
 */

export interface SlabOcrResult {
  isSlabbed: boolean; // Was a grading slab detected in the images?
  grader: string | null; // "PCGS", "NGC", "ANACS", "ICG", "CAC", etc.
  year: string | null; // e.g. "2026"
  mintMark: string | null; // "W", "S", "D", "O", "CC", or null for Philadelphia
  denomination: string | null; // "$1", "50C", "25C", etc.
  grade: string | null; // "MS 70", "MS 65", "PR 70", etc.
  certNumber: string | null; // PCGS/NGC certification number
  designation: string | null; // "First Strike", "First Day of Issue", etc.
  coinName: string | null; // "American Silver Eagle", "Morgan Dollar", etc.
  rawLabelText: string | null; // Full verbatim text extracted from label
}

const OCR_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Run GPT-4o Vision OCR on slab label(s) in the provided images.
 * Returns null if OCR fails or no slab is detected (caller should proceed normally).
 */
export interface SlabOcrUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export async function runSlabOcr(
  openAiApiKey: string,
  base64Images: string[], // base64-encoded image data (no data: prefix)
  mimeTypes: string[], // corresponding MIME types e.g. "image/jpeg"
  invocationId: string,
  userId?: string | null, // optional: for OpenAI user attribution + usage logging
): Promise<(SlabOcrResult & { _usage?: SlabOcrUsage }) | null> {
  const label = `[${invocationId}][SlabOCR]`;

  if (!openAiApiKey) {
    console.warn(`${label} No OpenAI API key — skipping slab OCR`);
    return null;
  }

  if (base64Images.length === 0) {
    return null;
  }

  // Build image content parts for GPT-4o — send all images but cap at 5
  // to keep latency reasonable. The slab label is usually in the first 1-2 shots.
  const imagesToSend = base64Images.slice(0, 5);
  const imageContentParts = imagesToSend.map((b64, i) => ({
    type: "image_url",
    image_url: {
      url: `data:${mimeTypes[i] ?? "image/jpeg"};base64,${b64}`,
      detail: "high", // Use high detail for small label text
    },
  }));

  const systemPrompt =
    `You are a precise OCR engine specializing in reading text from professional coin grading slab labels (PCGS, NGC, ANACS, ICG, CAC, ICCS).

Your ONLY job is to read the printed text on the slab label and return it as structured JSON. Do NOT describe the coin. Do NOT guess. Only report what you can clearly read.

CRITICAL DIGIT RULES:
- The digit 6 has a tail curving down-left. It is NOT 0.
- The digit 8 has two loops. It is NOT 0.
- The digit 9 has a loop at top. It is NOT 0.
- Carefully distinguish: 0 vs 6, 1 vs 7, 3 vs 8.
- Read EACH digit individually. Do not assume the year based on context.
- Modern US Mint coins are actively produced dated 2024, 2025, and 2026. These are real years.

Return ONLY valid JSON, no markdown, no explanation:
{
  "isSlabbed": true/false,
  "grader": "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "ICCS" | null,
  "year": "YYYY" | null,
  "mintMark": "W" | "S" | "D" | "O" | "CC" | "P" | null,
  "denomination": "$1" | "50C" | "25C" | "10C" | "5C" | "1C" | null,
  "grade": "MS 70" | "MS 65" | "PR 70" | etc | null,
  "certNumber": "12345678" | null,
  "designation": "First Strike" | "First Day of Issue" | etc | null,
  "coinName": "American Silver Eagle" | "Morgan Dollar" | etc | null,
  "rawLabelText": "full verbatim text from label" | null
}`;

  const requestBody: Record<string, unknown> = {
    model: "gpt-4o",
    max_tokens: 500,
    // user field: correlates this request to a user in OpenAI usage dashboard
    // format: "uid_<supabase_user_id>" — lets us attribute spend per user
    ...(userId ? { user: `uid_${userId}` } : {}),
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Read all text from any grading slab label visible in these images and return the structured JSON.",
          },
          ...imageContentParts,
        ],
      },
    ],
    response_format: { type: "json_object" },
  };

  try {
    console.log(
      `${label} Calling GPT-4o Vision for slab label OCR (${imagesToSend.length} images)`,
    );

    const resp = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      OCR_TIMEOUT_MS,
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(
        `${label} GPT-4o returned ${resp.status}: ${errText.slice(0, 200)}`,
      );
      return null;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.warn(`${label} GPT-4o returned empty content`);
      return null;
    }

    const parsed = JSON.parse(content) as SlabOcrResult;

    // Capture token usage for logging
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? 0;
    // GPT-4o pricing: $2.50/1M input tokens, $10.00/1M output tokens
    const costUsd = (promptTokens * 0.0000025) + (completionTokens * 0.000010);

    console.log(`${label} OCR result:`, {
      isSlabbed: parsed.isSlabbed,
      grader: parsed.grader,
      year: parsed.year,
      mintMark: parsed.mintMark,
      grade: parsed.grade,
      certNumber: parsed.certNumber,
      coinName: parsed.coinName,
      tokens: totalTokens,
      costUsd: costUsd.toFixed(6),
    });

    return {
      ...parsed,
      _usage: { promptTokens, completionTokens, totalTokens, costUsd },
    };
  } catch (err) {
    console.warn(`${label} Slab OCR failed (non-blocking):`, String(err));
    return null;
  }
}

/**
 * Format the slab OCR result as an authoritative context block
 * to be injected into the Gemini listing prompt.
 * Gemini will treat this as ground truth and never override it.
 */
export function formatSlabOcrContext(ocr: SlabOcrResult): string {
  if (!ocr.isSlabbed || !ocr.grader) {
    return "";
  }

  const lines: string[] = [
    "### CONFIRMED SLAB DATA (GPT-4o OCR — AUTHORITATIVE, DO NOT OVERRIDE)",
    `This coin IS in a PROFESSIONAL, GENUINE grading slab from ${ocr.grader}.`,
    `The following data was read directly from the slab label by GPT-4o Vision OCR.`,
    `Use these values EXACTLY as provided. Do NOT substitute your own reading.`,
    "",
    "**CRITICAL: THIS IS A REAL, GENUINE SLABBED COIN — NOT A NOVELTY, NOT A REPLICA, NOT A FANTASY ITEM.**",
    `Professional grading services (PCGS, NGC, ANACS, ICG, CAC) ONLY grade authentic coins.`,
    `If GPT-4o detected a ${ocr.grader} slab with a certification number, this is 100% genuine.`,
    `Do NOT describe this as novelty, fantasy, replica, tribute, or exonumia.`,
    `The title and description must reflect that this is a genuine certified coin.`,
    "",
  ];

  if (ocr.grader) lines.push(`- Grading Service: ${ocr.grader}`);
  if (ocr.coinName) lines.push(`- Coin: ${ocr.coinName}`);
  if (ocr.year) lines.push(`- Year: ${ocr.year}`);
  if (ocr.mintMark !== undefined && ocr.mintMark !== null) {
    lines.push(`- Mint Mark: ${ocr.mintMark} (West Point=W, San Francisco=S, Denver=D, New Orleans=O, Carson City=CC)`);
  } else if (ocr.mintMark === null && ocr.grader) {
    lines.push(`- Mint Mark: None visible on label (may be Philadelphia or not shown)`);
  }
  if (ocr.denomination) lines.push(`- Denomination: ${ocr.denomination}`);
  if (ocr.grade) lines.push(`- Grade: ${ocr.grade}`);
  if (ocr.certNumber) lines.push(`- Certification Number: ${ocr.certNumber}`);
  if (ocr.designation) lines.push(`- Designation: ${ocr.designation}`);
  if (ocr.rawLabelText) lines.push(`- Raw Label Text: "${ocr.rawLabelText}"`);

  lines.push("");
  lines.push(
    `MANDATORY: The title MUST begin with "${ocr.year ?? ""}${ocr.mintMark ? `-${ocr.mintMark}` : ""}". ` +
      `The Year item specific MUST be "${ocr.year ?? ""}". ` +
      `Certification MUST be "${ocr.grader ?? ""}". ` +
      `Grade MUST be "${ocr.grade ?? ""}". ` +
      `These values come from GPT-4o OCR and are correct.`,
  );

  return lines.join("\n");
}
