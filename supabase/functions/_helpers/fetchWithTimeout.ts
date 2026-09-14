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
} as const;

/**
 * fetch() with an AbortController-backed wall-clock ceiling.
 *
 * Throws on timeout (an AbortError-shaped DOMException) rather than resolving,
 * so existing try/catch fallbacks handle it exactly like any network failure.
 * `label` is included in the thrown message to make log triage possible --
 * without it an aborted fetch is indistinguishable from any other abort.
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
    return await fetch(url, { ...options, signal: controller.signal });
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
