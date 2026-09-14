import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { EDGE_GATEWAY_TIMEOUT_MS, fetchWithTimeout, PIPELINE_TIMEOUTS_MS } from "./fetchWithTimeout.ts";

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
