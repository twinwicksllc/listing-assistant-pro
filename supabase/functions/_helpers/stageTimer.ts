/**
 * stageTimer.ts
 *
 * Per-stage wall-clock instrumentation for long multi-stage Edge Functions.
 *
 * Why this exists: `analyze-item` runs a six-stage pipeline against a 150s
 * gateway ceiling (EDGE_GATEWAY_TIMEOUT_MS) and, until this helper landed, it
 * logged exactly ONE duration -- the total. Every performance discussion was
 * therefore a reconstruction from timestamps in interleaved log lines. This
 * records a start/end per named stage and emits ONE greppable summary line, so
 * the next performance pass is measured rather than guessed.
 *
 * Design constraints this file deliberately honours:
 *
 * - **Instrumentation must never change behaviour.** Nothing here throws.
 *   `time()` rethrows the wrapped work's error unchanged after recording the
 *   elapsed time -- a stage that fails is exactly the stage you most want a
 *   duration for. `end()` on an unknown or already-closed stage is a no-op
 *   rather than an error.
 * - **Overlap is reported, not hidden.** Concurrent stages (the controller's
 *   `Promise.allSettled` visual+market burst) have genuinely overlapping
 *   wall-clock intervals. Naively summing them double-counts ~88s and makes the
 *   total look impossible. So each stage keeps its own real start/end, and the
 *   summary reports `accounted` (union of all intervals -- real elapsed time
 *   covered by some stage) alongside `overlap` (sum minus union) so the numbers
 *   reconcile against the request total.
 * - **One line.** Concurrent invocations interleave in Supabase logs, so a
 *   multi-line table is unreadable in practice. `summary()` returns a single
 *   string and `log()` makes a single `console.log` call.
 *
 * Never pass anything but a stage name here: no secrets, no tokens, no image
 * data, no customer data. Durations and stage names only.
 */

/** One recorded stage interval. `endedAt === null` means still in flight. */
export interface StageRecord {
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  /** True when the stage was closed because the wrapped work threw. */
  failed: boolean;
}

/** Aggregated view of one stage name (repeated starts of a name are summed). */
export interface StageTotal {
  name: string;
  totalMs: number;
  count: number;
  open: boolean;
  failed: boolean;
}

export interface StageSummary {
  label: string;
  /** Timer lifetime: construction -> summary. Approximates request elapsed. */
  totalMs: number;
  /** Union of all stage intervals -- elapsed time covered by some stage. */
  accountedMs: number;
  /**
   * Sum of per-stage durations minus the union: concurrency, not lost time.
   * Note this counts NESTING as overlap too -- a bracketing stage such as
   * `agent_controller`, which contains `pass1_identification` and the
   * visual/market burst, contributes its whole span. So overlapMs can exceed
   * totalMs and that is correct; `accountedMs` is the figure to compare against
   * the request total.
   */
  overlapMs: number;
  /** Timer lifetime not covered by any stage -- uninstrumented work. */
  untimedMs: number;
  /** Per-name totals, sorted by duration descending. */
  stages: StageTotal[];
  openNames: string[];
  failedNames: string[];
}

function safeName(name: unknown, fallback = "unnamed"): string {
  const s = typeof name === "string" ? name : String(name);
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : fallback;
}

/**
 * Records named wall-clock intervals and emits one compact summary line.
 *
 * Two ways to record, pick whichever reads cleaner at the call site:
 *
 * ```ts
 * // 1. Wrapping form -- throw-safe, best for a single awaited expression.
 * const resp = await timer.time("pass2_listing", () => fetchWithTimeout(...));
 *
 * // 2. Bracketing form -- best for a multi-statement region you don't want to
 * //    reindent into a closure. A region that throws past `end()` is reported
 * //    as `(open)`, which pinpoints where the request died.
 * timer.start("slab_ocr");
 * try { ... } finally { timer.end("slab_ocr"); }
 * ```
 */
export class StageTimer {
  private readonly label: string;
  private readonly createdAt: number;
  private readonly clock: () => number;
  private readonly records: StageRecord[] = [];

  constructor(label = "pipeline", clock: () => number = () => Date.now()) {
    this.label = safeName(label, "pipeline");
    this.clock = clock;
    this.createdAt = this.clock();
  }

  /**
   * Open a stage interval. Returns a function that closes it -- handy when the
   * close site is a callback and re-typing the name would risk a typo.
   * Starting a name that is already open is allowed (both intervals are kept);
   * `end()` closes the most recently opened one.
   */
  start(name: string): () => void {
    const record: StageRecord = {
      name: safeName(name),
      startedAt: this.clock(),
      endedAt: null,
      durationMs: null,
      failed: false,
    };
    this.records.push(record);
    return () => this.close(record, false);
  }

  /**
   * Close the most recently opened interval for `name`. No-op when the stage
   * was never started or is already closed -- instrumentation must not throw.
   */
  end(name: string, failed = false): void {
    const wanted = safeName(name);
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i];
      if (record.name === wanted && record.endedAt === null) {
        this.close(record, failed);
        return;
      }
    }
  }

  /**
   * Time an async (or sync) unit of work. The result is returned unchanged and
   * a thrown error is recorded then RETHROWN -- this must never swallow a
   * failure or alter control flow.
   */
  async time<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const record = this.open(name);
    try {
      const result = await fn();
      this.close(record, false);
      return result;
    } catch (err) {
      this.close(record, true);
      throw err;
    }
  }

  /** Synchronous sibling of `time()`. Same rethrow guarantee. */
  timeSync<T>(name: string, fn: () => T): T {
    const record = this.open(name);
    try {
      const result = fn();
      this.close(record, false);
      return result;
    } catch (err) {
      this.close(record, true);
      throw err;
    }
  }

  /**
   * Absorb another timer's records so a sub-component (e.g. the agent
   * controller) can report into the caller's single summary line. Only used
   * when threading the timer itself through is not clean.
   */
  merge(other: StageTimer, prefix = ""): void {
    if (!other || other === this) return;
    const p = typeof prefix === "string" ? prefix : "";
    for (const record of other.records) {
      this.records.push({ ...record, name: safeName(p + record.name) });
    }
  }

  /** Snapshot of the raw intervals, in start order. Mainly for tests. */
  snapshot(): StageRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  /** Structured summary. Never throws. */
  report(): StageSummary {
    const now = this.clock();
    const totals = new Map<string, StageTotal>();
    const intervals: Array<[number, number]> = [];
    let sumMs = 0;

    for (const record of this.records) {
      const open = record.endedAt === null;
      const end = record.endedAt ?? now;
      const duration = record.durationMs ?? Math.max(0, end - record.startedAt);
      sumMs += duration;
      intervals.push([record.startedAt, end]);

      const existing = totals.get(record.name);
      if (existing) {
        existing.totalMs += duration;
        existing.count += 1;
        existing.open = existing.open || open;
        existing.failed = existing.failed || record.failed;
      } else {
        totals.set(record.name, {
          name: record.name,
          totalMs: duration,
          count: 1,
          open,
          failed: record.failed,
        });
      }
    }

    // Union of intervals: real elapsed time during which some stage was live.
    // Without this, concurrent stages double-count and the numbers stop
    // reconciling against the request total.
    intervals.sort((a, b) => a[0] - b[0]);
    let accountedMs = 0;
    let cursorStart = Number.NaN;
    let cursorEnd = Number.NaN;
    for (const [start, end] of intervals) {
      if (Number.isNaN(cursorStart)) {
        cursorStart = start;
        cursorEnd = end;
        continue;
      }
      if (start > cursorEnd) {
        accountedMs += cursorEnd - cursorStart;
        cursorStart = start;
        cursorEnd = end;
      } else if (end > cursorEnd) {
        cursorEnd = end;
      }
    }
    if (!Number.isNaN(cursorStart)) accountedMs += cursorEnd - cursorStart;

    const stages = [...totals.values()].sort((a, b) => b.totalMs - a.totalMs);
    const totalMs = Math.max(0, now - this.createdAt);

    return {
      label: this.label,
      totalMs,
      accountedMs,
      overlapMs: Math.max(0, sumMs - accountedMs),
      untimedMs: Math.max(0, totalMs - accountedMs),
      stages,
      openNames: stages.filter((s) => s.open).map((s) => s.name),
      failedNames: stages.filter((s) => s.failed).map((s) => s.name),
    };
  }

  /**
   * One-line, greppable summary. Shape:
   *
   * ```
   * ⏱️ STAGE TIMINGS [analyze-item] total=151422ms accounted=150242ms
   *   overlap=200940ms untimed=1180ms stages=19 |
   *   agent_controller=95540ms parallel_burst=88000ms visual_agent=88000ms
   *   pass2_listing=21200ms market_agent=17400ms slab_ocr=9800ms ... |
   *   open=none failed=none
   * ```
   *
   * (wrapped here for readability -- it is emitted as a single line). A stage
   * still in flight is suffixed `(open)`, one whose work threw `(failed)`, and
   * a name recorded more than once `(xN)`. Compare `accounted` against the
   * request total, not `overlap` -- see `StageSummary.overlapMs`.
   */
  summary(): string {
    try {
      const r = this.report();
      const stageParts = r.stages.map((s) => {
        const flags = [
          s.count > 1 ? `x${s.count}` : "",
          s.open ? "open" : "",
          s.failed ? "failed" : "",
        ].filter(Boolean);
        return `${s.name}=${s.totalMs}ms${flags.length > 0 ? `(${flags.join(",")})` : ""}`;
      });
      return [
        `⏱️ STAGE TIMINGS [${r.label}]`,
        `total=${r.totalMs}ms`,
        `accounted=${r.accountedMs}ms`,
        `overlap=${r.overlapMs}ms`,
        `untimed=${r.untimedMs}ms`,
        `stages=${r.stages.length}`,
        "|",
        stageParts.length > 0 ? stageParts.join(" ") : "none",
        "|",
        `open=${r.openNames.length > 0 ? r.openNames.join(",") : "none"}`,
        `failed=${r.failedNames.length > 0 ? r.failedNames.join(",") : "none"}`,
      ].join(" ");
    } catch {
      // A broken summary must never take down a request that otherwise worked.
      return `⏱️ STAGE TIMINGS [${this.label}] unavailable`;
    }
  }

  /** Emit `summary()` as a single console.log. Never throws. */
  log(prefix = ""): void {
    try {
      const line = this.summary();
      console.log(prefix ? `${prefix} ${line}` : line);
    } catch {
      // Intentionally silent -- see class doc.
    }
  }

  private open(name: string): StageRecord {
    const record: StageRecord = {
      name: safeName(name),
      startedAt: this.clock(),
      endedAt: null,
      durationMs: null,
      failed: false,
    };
    this.records.push(record);
    return record;
  }

  private close(record: StageRecord, failed: boolean): void {
    if (record.endedAt !== null) return;
    const end = this.clock();
    record.endedAt = end;
    record.durationMs = Math.max(0, end - record.startedAt);
    record.failed = failed;
  }
}
