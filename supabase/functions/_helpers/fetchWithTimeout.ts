/**
 * fetchWithTimeout.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Wall-clock ceiling for outbound fetches in the analyze-item pipeline.
 *
 * Supabase Edge Functions are killed by the gateway at 150s with a 504, and
 * that kill is invisible from inside the function -- no catch block runs, no
 * error is logged, the caller just gets a timeout. On 2026-09-14 an
 * analyze-item request died exactly that way while the retry that followed
 * completed in 142.9s, i.e. 7s under the ceiling. Every outbound call in the
 * pipeline was unbounded, so a single slow upstream could consume the whole
 * budget with nothing in the logs to show which one did it.
 *
 * A per-call ceiling converts that silent 504 into a fast, attributable,
 * locally-handled failure: each call site already degrades gracefully on
 * throw (non-blocking warn + fallback value), so aborting one slow upstream
 * costs a partial result instead of the entire request.
 *
 * Budgets live in PIPELINE_TIMEOUTS_MS rather than at the call sites so the
 * total can be reasoned about against the 150s ceiling in one place.
 *
 * ── Two things a naive AbortController wrapper does NOT bound ───────────────
 *
 * 1. THE RESPONSE BODY. fetch() resolves as soon as response HEADERS arrive,
 *    so clearing the timer at that point leaves `await res.json()` unbounded.
 *    An upstream that sends headers and then stalls the body would sail past
 *    the ceiling and still ride to the gateway kill -- the exact failure this
 *    module exists to prevent. The body is therefore buffered while the abort
 *    signal is still live, and a fresh Response is handed back so callers can
 *    keep calling .json()/.text() on an already-resolved payload.
 *
 * 2. THE REQUEST AS A WHOLE. A per-call ceiling catches ONE hung upstream; it
 *    says nothing about a request that creeps to 150s through many merely-slow
 *    stages. These budgets are deliberately NOT a summed request budget -- if
 *    they were forced to add up to 150s, visualAgent (the accuracy-critical
 *    stage) would have to be cut to ~40s, which is precisely the wrong trade.
 *    Instead, `withDeadline()` clamps each call to whatever wall clock is
 *    actually left, so a late stage gets the smaller of its own budget and the
 *    remaining time. That only ever bites when the request is already doomed.
 */

/** Gateway hard kill for Edge Functions. Every budget below must fit inside this. */
export const EDGE_GATEWAY_TIMEOUT_MS = 150_000;

export const PIPELINE_TIMEOUTS_MS = {
  /** Pass 1 identification -- heavy model, all images, small output. Observed ~6-8s. */
  pass1: 45_000,
  /**
   * VisualAgent precision inspection -- heavy model (GEMINI_HEAVY_MODEL) plus
   * codeExecution, which runs an agentic crop/zoom loop over every image.
   * Deliberately the largest budget: this is the accuracy-critical stage and
   * must not be cut short. Observed ~88s on a 4-image coin.
   */
  visualAgent: 110_000,
  /** MarketAgent grounding -- fast model + googleSearch. Observed ~10-20s. */
  marketAgent: 45_000,
  /** RAG embedding -- small text, no images. Observed <1s. */
  embedding: 15_000,
  /** Listing generation (Pass 2) -- heavy model, forced tool schema. Observed ~21s. */
  listingGeneration: 60_000,
  /** Internal Edge Function hops (category-lookup, spot-prices, competitor search). */
  internalFunction: 25_000,
  /** eBay taxonomy/aspects/conditions lookups. */
  ebayMetadata: 20_000,
  /**
   * RAG retrieval (pgvector match_knowledge_base RPC). Observed <1s. Runs
   * BEFORE the bounded Gemini call in both sub-agents, so leaving it unbounded
   * would let it eat the budget in front of every other ceiling here.
   */
  ragRetrieval: 10_000,
  /**
   * Race ceiling for the pre-AI comps lookup, layered ON TOP of
   * `internalFunction`'s own 25s budget -- not a replacement for it. A
   * successful call settles in ~5-8s observed; this splits that range so a
   * slow-but-normal response isn't cut off while still bounding the worst
   * case tightly enough that Pass 2's prompt-build doesn't wait the full 25s.
   */
  compsPreAiRace: 6_000,
} as const;

/** Statuses the Response constructor refuses to pair with a body of any size. */
export const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * A request-scoped wall clock. Created once per invocation and passed to
 * `withDeadline()` so late stages inherit the time the earlier ones left.
 */
export interface RequestDeadline {
  /** Milliseconds remaining before the gateway kill. Never negative. */
  remainingMs(): number;
}

/**
 * Build a deadline from the handler's own start timestamp.
 *
 * `safetyMarginMs` is reserved for the work that happens AFTER the last
 * outbound call -- assembling the response, the final DB writes, logging. The
 * 2026-09-14 retry succeeded with only 7s of headroom, so the margin exists to
 * stop a call from being allowed to run right up to the wire and leave nothing
 * for the response itself.
 */
export function createRequestDeadline(
  startTime: number,
  safetyMarginMs = 10_000,
  ceilingMs: number = EDGE_GATEWAY_TIMEOUT_MS,
): RequestDeadline {
  return {
    remainingMs() {
      const used = Date.now() - startTime;
      return Math.max(0, ceilingMs - safetyMarginMs - used);
    },
  };
}

/**
 * Clamp a stage budget to the time the request actually has left.
 *
 * Returns the smaller of the stage's own budget and the remaining wall clock,
 * with a floor of `minMs` -- a 1ms budget would abort before the connection
 * opened and produce a confusing "timed out" log for what is really "the
 * request ran out of time", so a doomed call is given one honest short attempt
 * instead. Passing no deadline returns the budget unchanged, which keeps every
 * call site that has no deadline in scope working exactly as before.
 */
export function withDeadline(
  budgetMs: number,
  deadline?: RequestDeadline | null,
  minMs = 1_000,
): number {
  if (!deadline) return budgetMs;
  return Math.max(minMs, Math.min(budgetMs, deadline.remainingMs()));
}

/**
 * fetch() with an AbortController-backed wall-clock ceiling that covers the
 * response BODY as well as the headers.
 *
 * Throws on timeout rather than resolving, so existing try/catch fallbacks
 * handle it exactly like any network failure. `label` is included in the thrown
 * message to make log triage possible -- without it an aborted fetch is
 * indistinguishable from any other abort.
 *
 * The returned Response is a reconstruction carrying the buffered body plus the
 * original status/statusText/headers. Callers use .ok/.status/.json()/.text(),
 * all of which behave identically; `.body` is a fresh stream over the buffered
 * bytes rather than the live socket, and `.url`/`.redirected` are not preserved.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit,
  timeoutMs: number,
  label?: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // 204/205/304 are defined to have no body; the Response constructor throws
    // if handed one, even an empty buffer. Nothing to drain, so pass it through.
    if (NULL_BODY_STATUSES.has(response.status)) return response;
    // Drain the body while the abort signal is still armed. Without this the
    // ceiling only covers headers and a stalled body escapes it entirely.
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `${label ?? "fetch"} timed out after ${timeoutMs}ms (wall-clock ceiling)`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wall-clock ceiling for a promise that has no AbortController of its own.
 *
 * `supabase.rpc(...)` is the case this exists for: it returns a thenable with
 * no abort plumbing, so a hung pgvector query cannot be cancelled -- it can only
 * be abandoned. That is a real gap, not a theoretical one: both sub-agents call
 * the RAG retriever BEFORE their (now bounded) Gemini fetch, so a stalled RPC
 * would consume the gateway budget in front of every timeout this module adds.
 *
 * Losing the race abandons the underlying work rather than cancelling it. That
 * is acceptable here because the caller's fallback is "proceed without RAG
 * grounding", and the invocation is about to end anyway -- but it means this
 * must not be used where the abandoned operation has side effects worth
 * waiting on.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${timeoutMs}ms (wall-clock ceiling)`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, ceiling]);
  } finally {
    clearTimeout(timer);
  }
}
