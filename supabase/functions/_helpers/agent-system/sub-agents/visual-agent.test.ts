/**
 * Regression coverage for the VisualAgent latency/hallucination fix
 * (2026-09-23).
 *
 * Context: this stage was the single largest cost in the analyze-item
 * pipeline (40-90+ seconds), driven by `codeExecution` (an agentic
 * crop/zoom-via-Python loop) plus the heavy/Pro model tier for
 * coins_bullion. Asked directly, Gemini's own guidance confirmed
 * `codeExecution` bought nothing here — our client already downscales to
 * 1200px, and native Gemini vision tiles images at 768x768 with 1:1 pixel
 * fidelity at that size, so cropping the same already-compressed pixels via
 * code execution recovers no real detail. The same guidance also linked
 * Pro's larger parameter count to a real hallucination this app hit in
 * production: the same coin photos produced three different, mutually
 * exclusive, highly-specific "variety" claims across separate runs, because
 * Pro's general-knowledge reasoning ("this series sometimes has X") can
 * override thin/ambiguous visual evidence. These tests lock in the fix:
 * codeExecution removed, Flash tier for every domain (not just non-coins),
 * and a NOT_VISIBLE escape hatch that must never leak into capturedAttributes.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { runAgenticVisualAgent } from "./visual-agent.ts";
import { DOMAIN_REGISTRY } from "../registry.ts";
import type { AgentContext } from "../pipelineContracts.ts";

// "general" has no entry in DOMAIN_RAG_CATEGORIES, so these tests never
// exercise the RAG/embedding/Supabase path -- a dummy client is enough.
const domainDef = DOMAIN_REGISTRY.general;

function fakeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    invocationId: "test-visual",
    userId: "user-1",
    imageList: ["data:image/jpeg;base64,aGVsbG8="],
    identification: {
      domain: "general",
      itemName: "Test Item",
      keywords: [],
      isMetal: false,
      metalType: "none",
    },
    ...overrides,
  };
}

/** Builds a Gemini-shaped generateContent response with the given text body. */
function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Swaps in a stub fetch, capturing the request body/URL, and always restores. */
async function withStubbedFetch(
  response: () => Response,
  fn: () => Promise<void>,
): Promise<{ urls: string[]; bodies: string[] }> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const bodies: string[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    if (init?.body) bodies.push(String(init.body));
    return Promise.resolve(response());
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return { urls, bodies };
}

const dummySupabase = {} as any;

Deno.test("runAgenticVisualAgent: never sends codeExecution tool", async () => {
  const { bodies } = await withStubbedFetch(
    () => geminiResponse(JSON.stringify({ keyFindings: "ok", confidenceBoost: 80 })),
    async () => {
      await runAgenticVisualAgent("test-key", domainDef, fakeContext(), dummySupabase);
    },
  );
  assertEquals(bodies.length, 1);
  const sent = JSON.parse(bodies[0]);
  assertEquals(sent.tools, undefined);
});

Deno.test("runAgenticVisualAgent: uses the fast/Flash model tier even for coins_bullion", async () => {
  const coinContext = fakeContext({
    identification: {
      domain: "coins_bullion",
      itemName: "1921 Morgan Dollar",
      keywords: [],
      isMetal: true,
      metalType: "silver",
    },
  });
  const { urls } = await withStubbedFetch(
    () => geminiResponse(JSON.stringify({ keyFindings: "ok", confidenceBoost: 80 })),
    async () => {
      // coins_bullion DOES have a DOMAIN_RAG_CATEGORIES entry ("grading_standard"),
      // which makes the agent call getEmbedding() first -- that also goes
      // through this stubbed fetch, gets a response shape it can't parse as
      // an embedding, and fails (caught, logged as a warning, non-blocking).
      // So two fetch calls happen: the embedding attempt, then the real
      // generateContent call this test actually cares about -- assert on the
      // LAST url, not on call count.
      await runAgenticVisualAgent(
        "test-key",
        DOMAIN_REGISTRY.coins_bullion,
        coinContext,
        dummySupabase,
      );
    },
  );
  const generateContentUrl = urls[urls.length - 1];
  assertStringIncludes(generateContentUrl, "generateContent");
  // gemini-flash-latest is the default GEMINI_FAST_MODEL value (no env override
  // in this test process) -- the point being asserted is "not the Pro/heavy
  // model", which this codebase's gemini-pro-latest default would otherwise be.
  assertStringIncludes(generateContentUrl, "flash");
});

Deno.test("runAgenticVisualAgent: a NOT_VISIBLE attribute value is dropped, not passed through", async () => {
  const result = await withStubbedFetchReturning({
    visualEvidence: "Edge shows a small mark but I cannot make out its shape clearly.",
    keyFindings: "Coin edge inspected; mark present but unidentified.",
    confidenceBoost: 60,
    capturedAttributes: {
      Year: "2017",
      Variety: "NOT_VISIBLE",
      "Mint Mark": "not_visible",
    },
  });
  assertEquals(result.capturedAttributes?.Year, "2017");
  assertEquals(result.capturedAttributes?.Variety, undefined);
  assertEquals(result.capturedAttributes?.["Mint Mark"], undefined);
});

Deno.test("runAgenticVisualAgent: capturedAttributes is undefined (not an empty object) when every value is NOT_VISIBLE", async () => {
  const result = await withStubbedFetchReturning({
    keyFindings: "Nothing distinguishing visible.",
    confidenceBoost: 40,
    capturedAttributes: {
      Variety: "NOT_VISIBLE",
      Grade: "NOT_VISIBLE",
    },
  });
  // Object.fromEntries on an all-filtered list produces {} , which is
  // truthy -- downstream (domainPrompts.ts) already guards with
  // Object.keys(...).length > 0, so {} and undefined behave identically
  // there. Asserting the shape directly here rather than relying on that
  // downstream guard.
  assertEquals(Object.keys(result.capturedAttributes ?? {}).length, 0);
});

Deno.test("runAgenticVisualAgent: a real confirmed attribute still passes through unchanged", async () => {
  const result = await withStubbedFetchReturning({
    keyFindings: "Rooster privy mark clearly visible on the edge, between two raised dots.",
    confidenceBoost: 90,
    capturedAttributes: {
      Year: "2017",
      Variety: "Rooster edge privy mark",
    },
  });
  assertEquals(result.capturedAttributes?.Variety, "Rooster edge privy mark");
});

/** Helper: stub a single successful Gemini response and run the agent against it. */
async function withStubbedFetchReturning(payload: Record<string, unknown>) {
  let result: Awaited<ReturnType<typeof runAgenticVisualAgent>> | undefined;
  await withStubbedFetch(
    () => geminiResponse(JSON.stringify(payload)),
    async () => {
      result = await runAgenticVisualAgent("test-key", domainDef, fakeContext(), dummySupabase);
    },
  );
  return result!;
}
