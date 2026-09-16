import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { finishAnalysisAttempt, startAnalysisAttempt } from "./analysisAttemptTracker.ts";

// Regression coverage for the analysis_attempts diagnostic table (2026-09-16).
// _helpers/sentry.ts's captureException only fires from inside analyze-item's
// own catch block, so a platform-level gateway kill is invisible to it -- this
// table is the server-side half of the signal that catches that case, keyed
// on the FRONTEND's clientRequestId rather than analyze-item's own internal
// invocationId, since a request the client never got a response for never
// learned that internal id either.

/** Minimal fake mirroring the subset of the supabase-js query builder used here. */
function fakeSupabase(opts: {
  onInsert?: (table: string, row: Record<string, unknown>) => void;
  onUpdate?: (
    table: string,
    patch: Record<string, unknown>,
    eqField: string,
    eqValue: unknown,
  ) => void;
  throwOnInsert?: boolean;
  throwOnUpdate?: boolean;
}) {
  return {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (opts.throwOnInsert) return Promise.reject(new Error("insert boom"));
          opts.onInsert?.(table, row);
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(eqField: string, eqValue: unknown) {
              if (opts.throwOnUpdate) return Promise.reject(new Error("update boom"));
              opts.onUpdate?.(table, patch, eqField, eqValue);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

interface CapturedUpdate {
  table: string;
  patch: Record<string, unknown>;
  eqField: string;
  eqValue: unknown;
}

Deno.test("startAnalysisAttempt: writes a 'started' row keyed on the client's own id, not left null", async () => {
  // Mutable wrapper object rather than a bare `let` -- a `let` reassigned only
  // inside a nested closure gets narrowed by TS to its initial literal type at
  // read sites in the outer scope, which is a pure type-checker quirk, not a
  // real behavior; wrapping in an object field sidesteps it.
  const captured: { value: CapturedInsert | null } = { value: null };
  const svc = fakeSupabase({
    onInsert: (table, row) => {
      captured.value = { table, row };
    },
  });

  await startAnalysisAttempt(svc, {
    clientRequestId: "client-abc-123",
    userId: "user-1",
  });

  assertEquals(captured.value?.table, "analysis_attempts");
  assertEquals(captured.value?.row.invocation_id, "client-abc-123");
  assertEquals(captured.value?.row.user_id, "user-1");
  assertEquals(captured.value?.row.status, "started");
});

Deno.test("startAnalysisAttempt: no-ops (no insert at all) when clientRequestId is absent -- an older client build", async () => {
  let insertCalled = false;
  const svc = fakeSupabase({
    onInsert: () => {
      insertCalled = true;
    },
  });

  await startAnalysisAttempt(svc, { clientRequestId: undefined, userId: "user-1" });

  assertEquals(insertCalled, false);
});

Deno.test("startAnalysisAttempt: a DB failure is swallowed, never thrown -- must not affect the analysis it only observes", async () => {
  const svc = fakeSupabase({ throwOnInsert: true });

  // Must resolve, not reject.
  await startAnalysisAttempt(svc, { clientRequestId: "client-1", userId: "user-1" });
});

Deno.test("finishAnalysisAttempt: updates the row matching invocation_id with status+ended_at+total_ms", async () => {
  const captured: { value: CapturedUpdate | null } = { value: null };
  const svc = fakeSupabase({
    onUpdate: (table, patch, eqField, eqValue) => {
      captured.value = { table, patch, eqField, eqValue };
    },
  });

  await finishAnalysisAttempt(svc, {
    clientRequestId: "client-abc-123",
    status: "completed",
    totalMs: 42_000,
  });

  assertEquals(captured.value?.table, "analysis_attempts");
  assertEquals(captured.value?.eqField, "invocation_id");
  assertEquals(captured.value?.eqValue, "client-abc-123");
  assertEquals(captured.value?.patch.status, "completed");
  assertEquals(captured.value?.patch.total_ms, 42_000);
  assertEquals(typeof captured.value?.patch.ended_at, "string");
});

Deno.test("finishAnalysisAttempt: no-ops when clientRequestId is absent", async () => {
  let updateCalled = false;
  const svc = fakeSupabase({
    onUpdate: () => {
      updateCalled = true;
    },
  });

  await finishAnalysisAttempt(svc, {
    clientRequestId: undefined,
    status: "failed",
    totalMs: 1000,
  });

  assertEquals(updateCalled, false);
});

Deno.test("finishAnalysisAttempt: a DB failure is swallowed, never thrown", async () => {
  const svc = fakeSupabase({ throwOnUpdate: true });

  await finishAnalysisAttempt(svc, {
    clientRequestId: "client-1",
    status: "failed",
    totalMs: 1000,
  });
});
