import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { unwrapIdentificationPayload } from "./pass1Identification.ts";

// Regression coverage for the Pass 1 array-wrapping bug (2026-09-14).
//
// Despite `response_format: { type: "json_object" }`, Gemini intermittently
// returns the identification wrapped in an array. Production logs caught it on
// a 1930-S Standing Liberty quarter:
//
//   PASS 1 raw response: [ { "domain": "coins_bullion", "itemName": "1930-S ..." } ]
//   ⚠️ Pass 1 JSON missing domain or itemName
//   Controller: Stage 1 Complete. Domain=general        <-- wrong
//
// Both parse paths checked `parsed.domain && parsed.itemName`, which is
// undefined on an array, so a perfectly correct identification silently
// degraded to domain="general". That misroutes RAG category selection, the
// domain prompt, Slab OCR eligibility and category resolution -- the whole
// downstream pipeline runs as the wrong vertical.

const IDENT = {
  domain: "coins_bullion",
  itemName: "1930-S Standing Liberty Quarter 90% Silver",
  keywords: ["1930-S", "Standing Liberty"],
  isMetal: true,
  metalType: "silver",
};

Deno.test("unwraps the exact array payload seen in production", () => {
  assertEquals(unwrapIdentificationPayload([IDENT]), IDENT);
});

Deno.test("passes a plain object through untouched (the normal path)", () => {
  assertEquals(unwrapIdentificationPayload(IDENT), IDENT);
});

Deno.test("picks the identification-shaped element, not blindly index 0", () => {
  assertEquals(unwrapIdentificationPayload([null, IDENT]), IDENT);
  assertEquals(unwrapIdentificationPayload(["preamble", IDENT]), IDENT);
});

Deno.test("prefers the first fully-shaped element among several", () => {
  const partial = { domain: "general" }; // missing itemName
  assertEquals(unwrapIdentificationPayload([partial, IDENT]), IDENT);
});

Deno.test("falls back to index 0 when nothing is identification-shaped", () => {
  // Preserves the previous end state (the caller's domain/itemName check then
  // fails and DEFAULT_IDENTIFICATION applies) rather than throwing.
  const junk = { unexpected: true };
  assertEquals(unwrapIdentificationPayload([junk]), junk);
});

Deno.test("an empty array yields undefined rather than throwing", () => {
  assertEquals(unwrapIdentificationPayload([]), undefined);
});

Deno.test("non-object scalars pass through unchanged", () => {
  assertEquals(unwrapIdentificationPayload(null), null);
  assertEquals(unwrapIdentificationPayload("text"), "text");
  assertEquals(unwrapIdentificationPayload(42), 42);
});

Deno.test("does not recurse into doubly-nested arrays", () => {
  // Not observed in production; documents the boundary rather than guessing.
  assertEquals(unwrapIdentificationPayload([[IDENT]]), [IDENT]);
});

// ---------------------------------------------------------------------------
// Request-shape and truncation coverage (2026-09-15 incident).
//
// A vintage sterling silver pendant came back as 29 characters --
// `{"domain":"jewelry","itemName` -- with `finish_reason: "length"` under a
// 500-token cap. An answer that short cannot be 500 tokens of OUTPUT, so
// reasoning consumed the budget: on this endpoint `max_tokens` bounds thinking
// and visible text together. The domain was even correct; it was cut mid-string
// and the whole pipeline then ran as domain="general".
//
// These tests pin the two things that fix and diagnose it: that a reasoning
// budget is actually SENT (nothing in this codebase set one on any Gemini call
// before this date), and that truncation is reported with the reasoning-token
// spend so the next person does not misread a cap problem again. They stub
// global fetch, which is what fetchWithTimeout calls.
// ---------------------------------------------------------------------------

import { runPass1Identification } from "./pass1Identification.ts";

const IMAGE = "data:image/jpeg;base64,AAAA";

/** Captures the outbound request body and replies with `payload`. */
function stubFetch(payload: unknown, status = 200) {
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = ((_url: string | URL, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
  return { bodies, restore: () => (globalThis.fetch = originalFetch) };
}

/** Captures console.error so the truncation diagnostic can be asserted on. */
function captureErrors() {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) =>
    // Some of these logs pass their fields as an OBJECT rather than
    // interpolating them (the parse-failure ones do), and String() flattens
    // that to "[object Object]" -- serialize instead so the fields are
    // assertable.
    lines.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  return { lines, restore: () => (console.error = originalError) };
}

function okResponse(content: string, finishReason = "stop", usage?: unknown) {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage,
  };
}

Deno.test("sends a reasoning budget, so max_tokens bounds the ANSWER not the thinking", async () => {
  const f = stubFetch(okResponse(JSON.stringify(IDENT)));
  try {
    await runPass1Identification("key", [IMAGE], "", "inv-1");
  } finally {
    f.restore();
  }

  assertEquals(f.bodies.length, 1);
  // The whole point of the 2026-09-15 fix. If this field ever goes missing,
  // ~470 of the 500 tokens can vanish into invisible reasoning again.
  assertEquals(f.bodies[0].reasoning_effort, "none");
  // `reasoning_effort` is the OpenAI-compat spelling. The native endpoint wants
  // generationConfig.thinkingConfig.thinkingBudget -- a different shape, so a
  // call site ported between endpoints must rewrite this, not copy it.
  assertEquals(f.bodies[0].max_tokens, 500);
});

Deno.test("still parses a normal identification with the reasoning budget applied", async () => {
  const f = stubFetch(okResponse(JSON.stringify(IDENT)));
  try {
    const ident = await runPass1Identification("key", [IMAGE], "", "inv-2");
    assertEquals(ident.domain, "coins_bullion");
    assertEquals(ident.itemName, IDENT.itemName);
  } finally {
    f.restore();
  }
});

Deno.test("reports truncation from finish_reason=length, with the reasoning spend", async () => {
  // The exact production payload: correct domain, cut mid-`itemName`.
  const TRUNCATED = '{"domain":"jewelry","itemName';
  const f = stubFetch(
    okResponse(TRUNCATED, "length", {
      completion_tokens_details: { reasoning_tokens: 471 },
    }),
  );
  const c = captureErrors();
  let ident;
  try {
    ident = await runPass1Identification("key", [IMAGE], "", "inv-3");
  } finally {
    c.restore();
    f.restore();
  }

  const truncationLog = c.lines.find((l) => l.includes("TRUNCATED by max_tokens"));
  assertEquals(typeof truncationLog, "string");
  // 29 chars against 471 reasoning tokens is the whole diagnosis in one line --
  // without both numbers side by side this reads as "raise the cap".
  assertEquals(truncationLog!.includes("chars=29"), true);
  assertEquals(truncationLog!.includes("reasoningTokens=471"), true);
  assertEquals(truncationLog!.includes("reasoning_effort=none"), true);
  // And the consequence the log warns about is real: unparseable JSON falls
  // back to domain="general", which is what misrouted category resolution.
  assertEquals(ident!.domain, "general");
});

Deno.test("says 'unreported' rather than a bare null when usage omits reasoning tokens", async () => {
  // Gemini does not always populate completion_tokens_details. A log reading
  // `reasoningTokens=null` invites "so it wasn't reasoning" -- it means unknown.
  const f = stubFetch(okResponse('{"domain":"jewelry"', "length"));
  const c = captureErrors();
  try {
    await runPass1Identification("key", [IMAGE], "", "inv-4");
  } finally {
    c.restore();
    f.restore();
  }

  const truncationLog = c.lines.find((l) => l.includes("TRUNCATED by max_tokens"));
  assertEquals(truncationLog!.includes("reasoningTokens=unreported"), true);
});

Deno.test("does not cry truncation on a normal finish_reason", async () => {
  // finish_reason=stop with unparseable prose is a PROMPT problem, and the two
  // have opposite fixes -- conflating them is what sent yesterday's fix wrong.
  const f = stubFetch(okResponse("Here is the JSON you asked for.", "stop"));
  const c = captureErrors();
  try {
    await runPass1Identification("key", [IMAGE], "", "inv-5");
  } finally {
    c.restore();
    f.restore();
  }

  assertEquals(
    c.lines.some((l) => l.includes("TRUNCATED by max_tokens")),
    false,
  );
  // The parse-failure log still carries finishReason so the two are
  // distinguishable in triage without re-running anything.
  assertEquals(
    c.lines.some((l) => l.includes("JSON parse failed") && l.includes("stop")),
    true,
  );
});
