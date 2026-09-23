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
import { applyDetailOverrides, extractKeyDetails } from "./detailExtractor.ts";
import type { DetailExtractionResult } from "./detailExtractor.ts";

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

// ── Regression coverage: the invented-privy-mark hallucination
// (2026-09-22/23) ────────────────────────────────────────────────────────
//
// The exact same Britannia coin photos produced three mutually exclusive,
// highly-specific "variety" claims across three separate analyze-item runs
// ("20th Anniversary Trident Privy", "Trident Privy Mark (30th
// Anniversary)", "Year of the Rooster Edge Privy") with no confidence
// signal distinguishing a real read from a guess. varietyConfidence exists
// to let extractKeyDetails report uncertainty explicitly, and
// applyDetailOverrides must respect it -- a "none" confidence claim must
// never reach the listing's item specifics as if it were a verified spec,
// while a genuinely "confirmed" one (the user confirmed this specific coin
// really does have a rooster edge privy) still should.

Deno.test("extractKeyDetails: a missing varietyConfidence field defaults to 'none', not trusted", async () => {
  await withStubbedFetch(
    () =>
      geminiResponse(
        JSON.stringify({
          variety: "20th Anniversary Trident Privy",
          // varietyConfidence deliberately omitted -- simulates a model
          // response that didn't follow the new schema field.
          reasoning: "Britannia coins sometimes have anniversary privies.",
        }),
        "STOP",
      ),
    async () => {
      await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "2017 Britannia 1 oz Silver",
          IMG,
          MIME,
          "test05",
        );
        assertEquals(result?.coinDetails?.variety, "20th Anniversary Trident Privy");
        assertEquals(result?.coinDetails?.varietyConfidence, "none");
      });
    },
  );
});

Deno.test("extractKeyDetails: an invalid varietyConfidence string also defaults to 'none'", async () => {
  await withStubbedFetch(
    () =>
      geminiResponse(
        JSON.stringify({
          variety: "Rooster Edge Privy",
          varietyConfidence: "probably", // not one of the three allowed values
        }),
        "STOP",
      ),
    async () => {
      await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "2017 Britannia 1 oz Silver",
          IMG,
          MIME,
          "test06",
        );
        assertEquals(result?.coinDetails?.varietyConfidence, "none");
      });
    },
  );
});

Deno.test("extractKeyDetails: 'confirmed' and 'uncertain' varietyConfidence pass through unchanged", async () => {
  await withStubbedFetch(
    () =>
      geminiResponse(
        JSON.stringify({
          variety: "Small rooster silhouette privy mark on the edge",
          varietyConfidence: "confirmed",
        }),
        "STOP",
      ),
    async () => {
      await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "2017 Britannia 1 oz Silver",
          IMG,
          MIME,
          "test07",
        );
        assertEquals(result?.coinDetails?.varietyConfidence, "confirmed");
      });
    },
  );

  await withStubbedFetch(
    () =>
      geminiResponse(
        JSON.stringify({
          variety: "small unidentified mark near date on reverse",
          varietyConfidence: "uncertain",
        }),
        "STOP",
      ),
    async () => {
      await captureLogs(async () => {
        const result = await extractKeyDetails(
          "test-key",
          "coins_bullion",
          "2017 Britannia 1 oz Silver",
          IMG,
          MIME,
          "test08",
        );
        assertEquals(result?.coinDetails?.varietyConfidence, "uncertain");
      });
    },
  );
});

function baseListing(): any {
  return { title: "2017 Britannia 1 oz Silver", description: "", itemSpecifics: {} };
}

function coinExtraction(
  overrides: Partial<NonNullable<DetailExtractionResult["coinDetails"]>>,
): DetailExtractionResult {
  return {
    domain: "coins_bullion",
    coinDetails: {
      mintMark: null,
      mintMarkConfidence: "not_visible",
      mintLocation: null,
      year: null,
      denomination: null,
      series: null,
      keyDate: false,
      keyDateReason: null,
      variety: null,
      varietyConfidence: "none",
      errors: null,
      reverseVisible: true,
      ...overrides,
    },
    cardDetails: null,
    jewelryDetails: null,
    electronicsDetails: null,
    sneakerDetails: null,
    autoPartDetails: null,
    instrumentDetails: null,
    handbagDetails: null,
    toolDetails: null,
    rawFindings: "",
  };
}

Deno.test("applyDetailOverrides: varietyConfidence='none' never writes item specifics, even with a specific-sounding claim", () => {
  const listing = baseListing();
  const extraction = coinExtraction({
    variety: "20th Anniversary Trident Privy",
    varietyConfidence: "none",
  });

  applyDetailOverrides(listing, extraction, "test-inv-1");

  assertEquals(listing.itemSpecifics["Variety"], undefined);
});

Deno.test("applyDetailOverrides: varietyConfidence='uncertain' still writes a plain description", () => {
  const listing = baseListing();
  const extraction = coinExtraction({
    variety: "small unidentified mark near date on reverse",
    varietyConfidence: "uncertain",
  });

  applyDetailOverrides(listing, extraction, "test-inv-2");

  assertEquals(
    listing.itemSpecifics["Variety"],
    "small unidentified mark near date on reverse",
  );
});

Deno.test("applyDetailOverrides: varietyConfidence='confirmed' writes the specific claim", () => {
  const listing = baseListing();
  const extraction = coinExtraction({
    variety: "Rooster edge privy mark",
    varietyConfidence: "confirmed",
  });

  applyDetailOverrides(listing, extraction, "test-inv-3");

  assertEquals(listing.itemSpecifics["Variety"], "Rooster edge privy mark");
});

Deno.test("applyDetailOverrides: an existing user-set Variety spec is never clobbered, regardless of confidence", () => {
  const listing = baseListing();
  listing.itemSpecifics["Variety"] = "User-entered value";
  const extraction = coinExtraction({
    variety: "Rooster edge privy mark",
    varietyConfidence: "confirmed",
  });

  applyDetailOverrides(listing, extraction, "test-inv-4");

  assertEquals(listing.itemSpecifics["Variety"], "User-entered value");
});
