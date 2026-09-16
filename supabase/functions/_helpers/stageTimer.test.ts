import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { StageTimer } from "./stageTimer.ts";

// Coverage for the per-stage instrumentation helper (2026-09-15).
//
// The point of these tests is not "does it add numbers" -- it is that
// instrumentation cannot change pipeline behaviour. The three properties that
// actually matter:
//
//   1. A stage that throws is still TIMED, and the error still propagates.
//   2. Concurrent stages are not summed into an impossible total -- the
//      controller's visual+market burst genuinely overlaps ~19s of a ~88s
//      window, and a naive sum would report more elapsed time than the request
//      had, which is exactly the kind of number that discredits a perf pass.
//   3. The summary is ONE line, because interleaved Supabase logs from
//      concurrent invocations make a multi-line table unreadable.
//
// A fake clock is used throughout so the assertions are exact rather than
// tolerance-based (a real clock makes "sorted by duration descending" flaky on
// sub-millisecond stages).

/** Manually advanced clock so durations are deterministic. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// ── Sequential stages ─────────────────────────────────────────────────────────

Deno.test("sequential stages record their own durations", () => {
  const clock = fakeClock();
  const timer = new StageTimer("seq", clock.now);

  timer.start("alpha");
  clock.advance(30);
  timer.end("alpha");

  clock.advance(5); // untimed gap

  timer.start("beta");
  clock.advance(70);
  timer.end("beta");

  const r = timer.report();
  assertEquals(r.stages.map((s) => [s.name, s.totalMs]), [
    ["beta", 70],
    ["alpha", 30],
  ]);
  assertEquals(r.totalMs, 105);
  assertEquals(r.accountedMs, 100);
  assertEquals(r.overlapMs, 0);
  assertEquals(r.untimedMs, 5, "the 5ms gap between stages is uninstrumented");
});

Deno.test("stages are sorted by duration descending", () => {
  const clock = fakeClock();
  const timer = new StageTimer("sort", clock.now);
  for (const [name, ms] of [["small", 5], ["huge", 500], ["mid", 50]] as const) {
    timer.start(name);
    clock.advance(ms);
    timer.end(name);
  }
  assertEquals(timer.report().stages.map((s) => s.name), ["huge", "mid", "small"]);
});

Deno.test("time() returns the wrapped value and records its duration", async () => {
  const clock = fakeClock();
  const timer = new StageTimer("wrap", clock.now);

  const value = await timer.time("work", () => {
    clock.advance(42);
    return Promise.resolve("payload");
  });

  assertEquals(value, "payload");
  assertEquals(timer.report().stages[0], {
    name: "work",
    totalMs: 42,
    count: 1,
    open: false,
    failed: false,
  });
});

Deno.test("repeated starts of one name are summed and flagged with a count", () => {
  const clock = fakeClock();
  const timer = new StageTimer("repeat", clock.now);
  for (const ms of [10, 20, 30]) {
    timer.start("aspects_fetch");
    clock.advance(ms);
    timer.end("aspects_fetch");
  }
  const stage = timer.report().stages[0];
  assertEquals(stage.totalMs, 60);
  assertEquals(stage.count, 3);
  assertStringIncludes(timer.summary(), "aspects_fetch=60ms(x3)");
});

// ── Concurrent / overlapping stages ───────────────────────────────────────────

Deno.test("overlapping stages are not double-counted into the accounted total", async () => {
  const clock = fakeClock();
  const timer = new StageTimer("burst", clock.now);

  // Mirrors controller.ts: both agents open, market finishes first, visual runs
  // on to dominate the window. Real awaits with a fake clock, so ordering is
  // controlled rather than raced.
  const visualEnd = timer.start("visual_agent");
  const marketEnd = timer.start("market_agent");
  clock.advance(20);
  marketEnd();
  clock.advance(68);
  visualEnd();

  await Promise.resolve();

  const r = timer.report();
  assertEquals(r.stages.map((s) => [s.name, s.totalMs]), [
    ["visual_agent", 88],
    ["market_agent", 20],
  ]);
  // 88 + 20 = 108ms of stage time inside an 88ms window.
  assertEquals(r.accountedMs, 88, "union of intervals, not the sum");
  assertEquals(r.overlapMs, 20, "the concurrency is reported, not hidden");
  assertEquals(r.untimedMs, 0);
  assert(
    r.accountedMs <= r.totalMs,
    "accounted time can never exceed the timer lifetime -- that is the bug this guards",
  );
});

Deno.test("overlap accounting survives real concurrent awaits in allSettled", async () => {
  const timer = new StageTimer("real-concurrency");
  const stage = (name: string, ms: number) =>
    timer.time(name, () => new Promise<string>((res) => setTimeout(() => res(name), ms)));

  const settled = await Promise.allSettled([stage("slow", 60), stage("fast", 10)]);

  assertEquals(settled.map((s) => s.status), ["fulfilled", "fulfilled"]);
  const r = timer.report();
  assertEquals(r.stages.map((s) => s.name), ["slow", "fast"]);
  assert(r.overlapMs > 0, "two truly concurrent stages must report overlap");
  assert(
    r.accountedMs <= r.totalMs,
    `accounted (${r.accountedMs}) must not exceed total (${r.totalMs})`,
  );
});

Deno.test("a stage left open is timed to now and flagged, not dropped", () => {
  const clock = fakeClock();
  const timer = new StageTimer("open", clock.now);
  timer.start("never_closed");
  clock.advance(25);

  const r = timer.report();
  assertEquals(r.stages[0].totalMs, 25);
  assertEquals(r.stages[0].open, true);
  assertEquals(r.openNames, ["never_closed"]);
  assertStringIncludes(timer.summary(), "never_closed=25ms(open)");
  assertStringIncludes(timer.summary(), "open=never_closed");
});

// ── Failure path: record the time AND rethrow ────────────────────────────────

Deno.test("time() records elapsed time and rethrows the original error", async () => {
  const clock = fakeClock();
  const timer = new StageTimer("throws", clock.now);
  const boom = new Error("upstream 502");

  let caught: unknown = null;
  try {
    await timer.time("pass2_listing", () => {
      clock.advance(17);
      return Promise.reject(boom);
    });
  } catch (err) {
    caught = err;
  }

  assertEquals(caught, boom, "the exact error object must propagate unchanged");
  const stage = timer.report().stages[0];
  assertEquals(stage.name, "pass2_listing");
  assertEquals(stage.totalMs, 17, "a failed stage is still timed");
  assertEquals(stage.failed, true);
  assertEquals(stage.open, false, "a thrown stage is closed, not left open");
  assertStringIncludes(timer.summary(), "pass2_listing=17ms(failed)");
  assertStringIncludes(timer.summary(), "failed=pass2_listing");
});

Deno.test("timeSync() records elapsed time and rethrows", () => {
  const clock = fakeClock();
  const timer = new StageTimer("throws-sync", clock.now);
  const boom = new Error("bad prompt build");

  let caught: unknown = null;
  try {
    timer.timeSync("prompt_build", () => {
      clock.advance(9);
      throw boom;
    });
  } catch (err) {
    caught = err;
  }

  assertEquals(caught, boom);
  assertEquals(timer.report().stages[0].totalMs, 9);
  assertEquals(timer.report().stages[0].failed, true);
});

Deno.test("a throwing stage does not corrupt the timings of its siblings", async () => {
  const clock = fakeClock();
  const timer = new StageTimer("mixed", clock.now);

  timer.start("ok_before");
  clock.advance(10);
  timer.end("ok_before");

  await timer.time("bad", () => {
    clock.advance(5);
    return Promise.reject(new Error("x"));
  }).catch(() => {});

  timer.start("ok_after");
  clock.advance(20);
  timer.end("ok_after");

  assertEquals(timer.report().stages.map((s) => [s.name, s.totalMs, s.failed]), [
    ["ok_after", 20, false],
    ["ok_before", 10, false],
    ["bad", 5, true],
  ]);
});

// ── Instrumentation must never throw ─────────────────────────────────────────

Deno.test("end() on an unknown or already-closed stage is a silent no-op", () => {
  const clock = fakeClock();
  const timer = new StageTimer("noop", clock.now);

  timer.end("never_started"); // must not throw
  timer.start("once");
  clock.advance(4);
  timer.end("once");
  clock.advance(100);
  timer.end("once"); // second close must not extend the recorded duration

  const r = timer.report();
  assertEquals(r.stages.length, 1);
  assertEquals(r.stages[0].totalMs, 4);
});

Deno.test("blank and non-string stage names are coerced, never thrown on", () => {
  const clock = fakeClock();
  const timer = new StageTimer("", clock.now);
  timer.start("   ");
  clock.advance(3);
  timer.end("   ");
  const r = timer.report();
  assertEquals(r.label, "pipeline");
  assertEquals(r.stages[0].name, "unnamed");
});

Deno.test("summary() on an empty timer is still a valid single line", () => {
  const line = new StageTimer("empty").summary();
  assertStringIncludes(line, "STAGE TIMINGS [empty]");
  assertStringIncludes(line, "stages=0");
  assertStringIncludes(line, "none");
  assertEquals(line.includes("\n"), false);
});

// ── Summary line shape ───────────────────────────────────────────────────────

Deno.test("summary() is exactly one greppable line with total and per-stage ms", () => {
  const clock = fakeClock();
  const timer = new StageTimer("analyze-item", clock.now);

  timer.start("slab_ocr");
  clock.advance(9_800);
  timer.end("slab_ocr");
  timer.start("pass2_listing");
  clock.advance(21_000);
  timer.end("pass2_listing");

  const line = timer.summary();
  assertEquals(line.includes("\n"), false, "must be a single line for Supabase log grepping");
  assertStringIncludes(line, "⏱️ STAGE TIMINGS [analyze-item]");
  assertStringIncludes(line, "total=30800ms");
  assertStringIncludes(line, "accounted=30800ms");
  assertStringIncludes(line, "overlap=0ms");
  assertStringIncludes(line, "untimed=0ms");
  assertStringIncludes(line, "stages=2");
  assertStringIncludes(line, "pass2_listing=21000ms slab_ocr=9800ms");
  assertStringIncludes(line, "open=none");
  assertStringIncludes(line, "failed=none");
  // Descending order must hold in the rendered line, not just in report().
  assert(line.indexOf("pass2_listing=") < line.indexOf("slab_ocr="));
});

Deno.test("log() emits exactly one console.log call", () => {
  const clock = fakeClock();
  const timer = new StageTimer("once", clock.now);
  timer.start("a");
  clock.advance(1);
  timer.end("a");

  const original = console.log;
  const calls: string[] = [];
  console.log = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  try {
    timer.log("[abc123]");
  } finally {
    console.log = original;
  }

  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0], "[abc123] ⏱️ STAGE TIMINGS [once]");
});

// ── Merging a sub-component's timings into one summary ───────────────────────

Deno.test("merge() folds a sub-timer's stages into the parent summary", () => {
  const clock = fakeClock();
  const parent = new StageTimer("analyze-item", clock.now);
  const child = new StageTimer("controller", clock.now);

  parent.start("agent_controller");
  child.start("pass1_identification");
  clock.advance(7_000);
  child.end("pass1_identification");
  child.start("visual_agent");
  clock.advance(88_000);
  child.end("visual_agent");
  parent.end("agent_controller");

  parent.merge(child);

  const r = parent.report();
  assertEquals(r.stages.map((s) => s.name), [
    "agent_controller",
    "visual_agent",
    "pass1_identification",
  ]);
  // The parent wrapper overlaps its children entirely: union must stay at the
  // wrapper's own span rather than 95s + 88s + 7s of imaginary time.
  assertEquals(r.accountedMs, 95_000);
  assertEquals(r.overlapMs, 95_000);
  assertEquals(r.untimedMs, 0);
});

Deno.test("merge() applies a prefix and ignores a self-merge", () => {
  const clock = fakeClock();
  const parent = new StageTimer("p", clock.now);
  const child = new StageTimer("c", clock.now);
  child.start("visual_agent");
  clock.advance(2);
  child.end("visual_agent");

  parent.merge(child, "agent.");
  parent.merge(parent, "loop.");

  assertEquals(parent.report().stages.map((s) => s.name), ["agent.visual_agent"]);
});
