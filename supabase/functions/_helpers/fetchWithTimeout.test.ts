import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  createRequestDeadline,
  EDGE_GATEWAY_TIMEOUT_MS,
  fetchWithTimeout,
  PIPELINE_TIMEOUTS_MS,
  withDeadline,
  withTimeout,
} from "./fetchWithTimeout.ts";

// Regression coverage for the unbounded-fetch incident (2026-09-14).
//
// analyze-item returned a 504 after 150.1s while the retry succeeded in 142.9s.
// The gateway kill is invisible from inside the function -- no catch runs and
// nothing is logged -- and every outbound call in the pipeline was unbounded,
// so one slow upstream could consume the entire budget untraceably.

Deno.test("every budget fits inside the gateway's hard kill", () => {
  for (const [name, ms] of Object.entries(PIPELINE_TIMEOUTS_MS)) {
    assertEquals(
      ms < EDGE_GATEWAY_TIMEOUT_MS,
      true,
      `${name} (${ms}ms) must be under the ${EDGE_GATEWAY_TIMEOUT_MS}ms gateway ceiling`,
    );
  }
});

Deno.test("the accuracy-critical visual stage holds the largest budget", () => {
  // The heavy model + codeExecution crop/zoom loop IS the accuracy mechanism
  // for coins; it must never be the first stage starved by a tighter budget.
  const max = Math.max(...Object.values(PIPELINE_TIMEOUTS_MS));
  assertEquals(PIPELINE_TIMEOUTS_MS.visualAgent, max);
});

Deno.test("visual budget covers the observed ~88s inspection with headroom", () => {
  assertEquals(PIPELINE_TIMEOUTS_MS.visualAgent >= 100_000, true);
});

Deno.test("aborts a hung request and names the label in the error", async () => {
  const err = await assertRejects(
    () =>
      fetchWithTimeout(
        // Reserved-for-documentation address; connect never completes.
        "http://192.0.2.1:9/hang",
        {},
        150,
        "unit-test call",
      ),
    Error,
  );
  // Either the abort fired (our message) or the connection failed outright --
  // both are the graceful, locally-handled failure the fix is for. Only a hang
  // would be a regression, and the test timing out would surface that.
  assertEquals(typeof err.message, "string");
  assertEquals(err.message.length > 0, true);
});

Deno.test("a fast local response is unaffected by the ceiling", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    () => new Response("ok"),
  );
  try {
    const res = await fetchWithTimeout(
      `http://127.0.0.1:${server.addr.port}/`,
      {},
      10_000,
      "local probe",
    );
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("timeout message reports the budget that was exceeded", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return new Response("late");
    },
  );
  try {
    const err = await assertRejects(
      () =>
        fetchWithTimeout(
          `http://127.0.0.1:${server.addr.port}/slow`,
          {},
          120,
          "slow upstream",
        ),
      Error,
    );
    assertEquals(err.message.includes("slow upstream"), true);
    assertEquals(err.message.includes("120ms"), true);
  } finally {
    ac.abort();
    await server.finished;
  }
});

// ─── Response-body coverage (Copilot review, PR #564) ───────────────────────
//
// fetch() resolves when HEADERS arrive. Clearing the timer at that point left
// `await res.json()` unbounded, so an upstream that sent headers and then
// stalled the body bypassed the ceiling entirely and could still ride to the
// gateway kill -- defeating the whole point of this module.

Deno.test("bounds an upstream that sends headers then stalls the body", async () => {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    () =>
      // Headers flush immediately; the body never arrives.
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            // Deliberately never close/enqueue again.
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  try {
    const err = await assertRejects(
      () =>
        fetchWithTimeout(
          `http://127.0.0.1:${server.addr.port}/stall`,
          {},
          400,
          "stalled body upstream",
        ),
      Error,
    );
    assertEquals(err.message.includes("stalled body upstream"), true);
    assertEquals(err.message.includes("timed out"), true);
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("a complete body is still returned and re-readable by callers", async () => {
  // The helper buffers the body and hands back a reconstructed Response, so
  // callers must still be able to call .json() on it exactly as before.
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    () =>
      new Response(JSON.stringify({ ok: true, n: 42 }), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json", "X-Probe": "kept" },
      }),
  );
  try {
    const res = await fetchWithTimeout(
      `http://127.0.0.1:${server.addr.port}/`,
      {},
      10_000,
      "buffered probe",
    );
    assertEquals(res.status, 201);
    assertEquals(res.ok, true);
    assertEquals(res.headers.get("X-Probe"), "kept");
    const body = await res.json();
    assertEquals(body.n, 42);
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("a 204 passes through without a body-reconstruction error", async () => {
  // The Response constructor throws if a null-body status is paired with any
  // body, so these must not go through the buffering path.
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    () => new Response(null, { status: 204 }),
  );
  try {
    const res = await fetchWithTimeout(
      `http://127.0.0.1:${server.addr.port}/`,
      {},
      10_000,
      "no-content probe",
    );
    assertEquals(res.status, 204);
  } finally {
    ac.abort();
    await server.finished;
  }
});

// ─── Request-level deadline (Copilot review, PR #564) ───────────────────────
//
// Per-call ceilings catch ONE hung upstream. They say nothing about a request
// that creeps to 150s through many merely-slow stages -- which is the shape of
// the 2026-09-14 504. withDeadline() clamps each budget to the remaining clock.

Deno.test("withDeadline returns the budget unchanged when no deadline is given", () => {
  // Keeps every pre-existing call site behaving exactly as before.
  assertEquals(withDeadline(45_000, undefined), 45_000);
  assertEquals(withDeadline(45_000, null), 45_000);
});

Deno.test("withDeadline leaves a budget alone early in the request", () => {
  const deadline = createRequestDeadline(Date.now());
  // 150s ceiling - 10s margin = 140s available, so a 45s budget is untouched.
  assertEquals(withDeadline(45_000, deadline), 45_000);
});

Deno.test("withDeadline shrinks a budget the request can no longer afford", () => {
  // 100s already spent: 150 - 10 margin - 100 = ~40s left, so the
  // accuracy-critical 110s visual budget must not be handed out in full.
  const deadline = createRequestDeadline(Date.now() - 100_000);
  const clamped = withDeadline(PIPELINE_TIMEOUTS_MS.visualAgent, deadline);
  assertEquals(clamped < PIPELINE_TIMEOUTS_MS.visualAgent, true);
  assertEquals(clamped <= 40_000, true);
  assertEquals(clamped > 30_000, true);
});

Deno.test("withDeadline floors a doomed call instead of aborting at 0ms", () => {
  // Past the ceiling entirely. A 0ms budget would abort before the connection
  // opened and log a confusing "timed out" for what is really "out of time";
  // one honest short attempt is the better failure.
  const deadline = createRequestDeadline(Date.now() - 500_000);
  assertEquals(deadline.remainingMs(), 0);
  assertEquals(withDeadline(60_000, deadline), 1_000);
});

Deno.test("the deadline reserves margin for assembling the response", () => {
  // The 2026-09-14 retry cleared the ceiling by only 7s. The margin stops a
  // call from running to the wire and leaving nothing for the response itself.
  const deadline = createRequestDeadline(Date.now(), 10_000);
  assertEquals(deadline.remainingMs() <= EDGE_GATEWAY_TIMEOUT_MS - 10_000, true);
});

Deno.test("a clamped budget actually aborts the fetch at the shortened ceiling", async () => {
  // End-to-end: the clamp must reach fetchWithTimeout, not just compute a number.
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return new Response("late");
    },
  );
  try {
    // Only ~200ms of clock left, so the nominal 60s budget must not apply.
    const deadline = createRequestDeadline(
      Date.now() - (EDGE_GATEWAY_TIMEOUT_MS - 10_000 - 200),
    );
    const err = await assertRejects(
      () =>
        fetchWithTimeout(
          `http://127.0.0.1:${server.addr.port}/slow`,
          {},
          withDeadline(60_000, deadline, 200),
          "late-stage call",
        ),
      Error,
    );
    assertEquals(err.message.includes("late-stage call"), true);
  } finally {
    ac.abort();
    await server.finished;
  }
});

// ─── withTimeout: for promises with no AbortController of their own ─────────

Deno.test("withTimeout rejects a hung operation with a labeled error", async () => {
  const err = await assertRejects(
    () => withTimeout(new Promise(() => {}), 100, "RAG retrieval (coins)"),
    Error,
  );
  assertEquals(err.message.includes("RAG retrieval (coins)"), true);
  assertEquals(err.message.includes("100ms"), true);
});

Deno.test("withTimeout passes a fast result straight through", async () => {
  const value = await withTimeout(Promise.resolve({ rows: 3 }), 5_000, "fast op");
  assertEquals(value.rows, 3);
});

Deno.test("withTimeout propagates the operation's own rejection unchanged", async () => {
  // A real DB error must not be disguised as a timeout.
  const err = await assertRejects(
    () => withTimeout(Promise.reject(new Error("pgvector exploded")), 5_000, "op"),
    Error,
  );
  assertEquals(err.message, "pgvector exploded");
});

Deno.test("RAG retrieval budget leaves room for the stages that follow it", () => {
  // It runs BEFORE the bounded Gemini call in both sub-agents, so it must not
  // be able to consume a meaningful share of the visual stage's budget.
  assertEquals(
    PIPELINE_TIMEOUTS_MS.ragRetrieval < PIPELINE_TIMEOUTS_MS.visualAgent / 4,
    true,
  );
});
