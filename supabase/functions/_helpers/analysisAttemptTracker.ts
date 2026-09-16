/**
 * analysisAttemptTracker.ts
 *
 * Writes to `analysis_attempts` (see 20260916000000_create_analysis_attempts.sql
 * for the full rationale): a diagnostic signal for the one failure mode
 * `_helpers/sentry.ts`'s `captureException` structurally cannot see -- a
 * platform-level gateway kill of `analyze-item` itself. That kill happens
 * from outside the function; no exception is thrown, no catch block runs,
 * nothing reaches Sentry. A row stuck at `status: "started"` for longer than
 * the gateway ceiling is unambiguous proof that this happened.
 *
 * Every function here swallows its own errors -- a DB write failing must
 * never affect the actual analysis it is merely observing. None of these are
 * on any latency-critical path: `start` is a single small insert made once,
 * `finish` is called immediately before the function's two existing
 * `timer.log()` sites (already right before `return`), not woven into the
 * pipeline itself.
 */

// deno-lint-ignore no-explicit-any -- matches the loose supabase-js client
// typing already used throughout analyze-item/index.ts.
type SupabaseLike = any;

/**
 * The correlation key is the FRONTEND's own generated id, not
 * `analyze-item`'s internal `invocationId` -- the whole point of this table
 * is to catch requests where the client never received ANY response,
 * meaning it never learned the server's internal id. The frontend must
 * generate and send this value in the request body before the call, and
 * report back to `report-analysis-timeout` using the SAME value if the call
 * fails with a network-level error.
 */
export async function startAnalysisAttempt(
  svc: SupabaseLike,
  params: { clientRequestId: string | undefined; userId: string },
): Promise<void> {
  if (!params.clientRequestId) return; // older/unknown client build -- nothing to track
  try {
    await svc.from("analysis_attempts").insert({
      invocation_id: params.clientRequestId,
      user_id: params.userId,
      status: "started",
    });
  } catch (e) {
    console.warn("analysisAttemptTracker: startAnalysisAttempt failed (non-blocking):", e);
  }
}

export async function finishAnalysisAttempt(
  svc: SupabaseLike,
  params: {
    clientRequestId: string | undefined;
    status: "completed" | "failed";
    totalMs: number;
  },
): Promise<void> {
  if (!params.clientRequestId) return;
  try {
    await svc
      .from("analysis_attempts")
      .update({
        status: params.status,
        ended_at: new Date().toISOString(),
        total_ms: params.totalMs,
      })
      .eq("invocation_id", params.clientRequestId);
  } catch (e) {
    console.warn("analysisAttemptTracker: finishAnalysisAttempt failed (non-blocking):", e);
  }
}
