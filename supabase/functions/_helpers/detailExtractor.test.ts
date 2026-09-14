/**
 * Regression tests for the detail-extraction truncation bug (2026-09-14).
 *
 * Production log showed two of three extractions dying with
 * `JSON parse failed: SyntaxError: Unterminated string ... Raw: [ { "mintMark": "S", ...`
 * -- the response was cut off mid-string by `maxOutputTokens`, so JSON.parse
 * threw and the entire extraction silently returned null. Nothing in the log
 * said the cause was the token cap, which is what made it hard to spot.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { extractKeyDetails } from "./detailExtractor.ts";

const IMG = ["aGVsbG8="];
const MIME = ["image/jpeg"];

/** Builds a Gemini-shaped response with a given body text and finishReason. */
function geminiResponse(text: string, finishReason = "STOP"): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Swaps in a stub fetch, capturing the request body, and always restores. */
async function withStubbedFetch(
  response: () => Response,
  fn: () => Promise<void>,
): Promise<{ bodies: string[] }> {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) bodies.push(String(init.body));
    return Promise.resolve(response());
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return { bodies };
}

/** Captures console.error/warn text emitted during a call. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const origError = console.error;
  const origWarn = console.warn;
  let out = "";
  console.error = (...a: unknown[]) => {
    out += a.map(String).join(" ") + "\n";
  };
  console.warn = (...a: unknown[]) => {
    out += a.map(String).join(" ") + "\n";
  };
  try {
    await fn();
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
  return out;
}

// The exact shape from the 2026-09-14 production log: valid JSON prefix, cut
// mid-string, with finishReason=MAX_TOKENS.
const TRUNCATED = `[
  {
    "mintMark": "S",
    "mintMarkConfidence": "confirmed",
    "mintLocation": "San`;

Deno.test("truncated response is reported as MAX_TOKENS, not a generic parse error", async () => {
  let logs = "";
  await withStubbedFetch(
    () => geminiResponse(TRUNCATED, "MAX_TOKENS"),
    async () => {
      logs = await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "1943 S Steel Cent",
          IMG,
          MIME,
          "test01",
        );
        // Still degrades to null -- the fix makes the cause visible, it does
        // not invent data the model never returned.
        assertEquals(result, null);
      });
    },
  );
  // The diagnosis must name the real cause. Before the fix the log said only
  // "JSON parse failed: SyntaxError: Unterminated string".
  assertStringIncludes(logs, "TRUNCATED");
  assertStringIncludes(logs, "MAX_TOKENS");
  assertStringIncludes(logs, "DETAIL_MAX_OUTPUT_TOKENS");
});

Deno.test("genuinely malformed JSON is NOT blamed on truncation", async () => {
  let logs = "";
  await withStubbedFetch(
    // Stopped normally, but the payload is not valid JSON.
    () => geminiResponse('{"mintMark": }', "STOP"),
    async () => {
      logs = await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "1943 S Steel Cent",
          IMG,
          MIME,
          "test02",
        );
        assertEquals(result, null);
      });
    },
  );
  assertStringIncludes(logs, "JSON parse failed");
  // Must not misattribute a prompt problem to the token cap -- the two have
  // different fixes.
  assertEquals(logs.includes("TRUNCATED"), false);
  assertStringIncludes(logs, "finishReason=STOP");
});

Deno.test("request declares the raised output-token cap", async () => {
  const { bodies } = await withStubbedFetch(
    () => geminiResponse('{"mintMark": "S"}', "STOP"),
    async () => {
      await captureLogs(async () => {
        await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "1943 S Steel Cent",
          IMG,
          MIME,
          "test03",
        );
      });
    },
  );
  assertEquals(bodies.length, 1);
  const sent = JSON.parse(bodies[0]);
  // 800 truncated real traffic; pin the raised value so it cannot silently regress.
  assertEquals(sent.generationConfig.maxOutputTokens, 2000);
});

Deno.test("a well-formed response still parses and returns details", async () => {
  await withStubbedFetch(
    () =>
      geminiResponse(
        JSON.stringify({
          mintMark: "S",
          mintMarkConfidence: "confirmed",
          reasoning: "Mint mark visible below the date.",
        }),
        "STOP",
      ),
    async () => {
      await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "1943 S Steel Cent",
          IMG,
          MIME,
          "test04",
        );
        // Guard against an over-correction that makes everything return null.
        assertEquals(result !== null, true);
        assertEquals(result?.domain, "coins_bullion");
      });
    },
  );
});
