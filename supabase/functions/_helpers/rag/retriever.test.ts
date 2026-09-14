import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { findSimilarContext } from "./retriever.ts";

/**
 * Regression coverage for the unbounded RAG RPC (Copilot review, PR #564).
 *
 * `supabase.rpc("match_knowledge_base", ...)` had no deadline, and BOTH
 * sub-agents call this before their (bounded) Gemini request -- so a hung
 * pgvector query could consume the gateway's 150s budget in front of every
 * timeout added elsewhere in the pipeline.
 *
 * RAG is grounding, not a hard requirement: a timeout must degrade to the same
 * empty result the pre-existing error path already returns, never throw into a
 * caller that has no reason to expect it.
 */

/** Minimal supabase double: only `.rpc()` is reached by findSimilarContext. */
// deno-lint-ignore no-explicit-any
function fakeSupabase(rpc: (name: string, args: unknown) => Promise<any>): any {
  return { rpc };
}

Deno.test("returns rows on the happy path", async () => {
  const supabase = fakeSupabase(() =>
    Promise.resolve({
      data: [{ content: "MS-65 means...", metadata: {}, similarity: 0.9 }],
      error: null,
    })
  );
  const rows = await findSimilarContext(supabase, [0.1, 0.2], "grading_standard");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].content, "MS-65 means...");
});

Deno.test("a hung RPC degrades to empty instead of hanging the pipeline", async () => {
  // This is the actual bug: without a ceiling this call never returns and the
  // invocation dies at the gateway with nothing in the logs to explain it.
  const supabase = fakeSupabase(() => new Promise(() => {}));
  const started = Date.now();
  const rows = await findSimilarContext(
    supabase,
    [0.1],
    "grading_standard",
    undefined,
    undefined,
    150,
  );
  assertEquals(rows, []);
  // Must have given up near its ceiling, nowhere near the 150s gateway kill.
  assertEquals(Date.now() - started < 5_000, true);
});

Deno.test("a slow-but-in-budget RPC still returns its rows", async () => {
  // The ceiling must not truncate legitimate retrieval.
  const supabase = fakeSupabase(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return { data: [{ content: "ok", metadata: {}, similarity: 0.7 }], error: null };
  });
  const rows = await findSimilarContext(
    supabase,
    [0.1],
    "sales_history",
    undefined,
    undefined,
    3_000,
  );
  assertEquals(rows.length, 1);
});

Deno.test("an RPC error still degrades to empty (pre-existing behavior kept)", async () => {
  const supabase = fakeSupabase(() => Promise.resolve({ data: null, error: { message: "relation missing" } }));
  assertEquals(await findSimilarContext(supabase, [0.1], "sales_history"), []);
});

Deno.test("a thrown client error degrades to empty rather than propagating", async () => {
  // Callers treat RAG as best-effort; a throw here would break that contract.
  const supabase = fakeSupabase(() => Promise.reject(new Error("socket closed")));
  assertEquals(await findSimilarContext(supabase, [0.1], "sales_history"), []);
});

Deno.test("passes the caller's threshold and count through unchanged", async () => {
  // The deadline parameter was appended after these, so their positions matter.
  let seen: Record<string, unknown> = {};
  const supabase = fakeSupabase((_n, args) => {
    seen = args as Record<string, unknown>;
    return Promise.resolve({ data: [], error: null });
  });
  await findSimilarContext(supabase, [0.5], "grading_standard", 0.75, 9, 5_000);
  assertEquals(seen.match_threshold, 0.75);
  assertEquals(seen.match_count, 9);
  assertEquals(seen.filter_category, "grading_standard");
});
