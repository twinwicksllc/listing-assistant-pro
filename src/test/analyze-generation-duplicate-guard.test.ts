import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for duplicate analyze-item invocations (2026-09-14).
 *
 * Production logs showed the function booting FOUR times for a single analysis
 * (two pairs ~27ms apart), each boot running a full Gemini pipeline: double AI
 * spend, and double pressure on the same upstream rate limits the real request
 * needs. `setGenerating(true)` cannot prevent this -- React state does not
 * update until the next render, so two calls in the same tick both observe
 * `generating === false`. The guard is a module-scoped registry claimed
 * synchronously, which covers the same-tick race AND survives a remount (a
 * per-instance ref would die with the instance).
 *
 * AnalyzePage.tsx auto-fires handleGenerate() from a mount effect AND exposes a
 * Retry button, so a remount, a double-click, or any future StrictMode adoption
 * can all double-fire it.
 *
 * The registry stores the in-flight PROMISE, not just a timestamp, so a
 * suppressed duplicate adopts the running request rather than being turned away
 * with no feedback -- see the adoption tests at the bottom of this file.
 */

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";

import {
  __resetInFlightRequests,
  useAnalyzeGeneration,
} from "@/hooks/useAnalyzeGeneration";

/** Defers resolution so we can hold a call "in flight" while firing another. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Record<string, unknown> = {}) {
  const onSuccess = vi.fn();
  const { result, unmount } = renderHook(() =>
    useAnalyzeGeneration({
      canAnalyze: true,
      analysisLimit: 100,
      imageUrls: ["data:image/jpeg;base64,AAAA"],
      voiceNote: "",
      ebayCategoryId: "",
      onRequireBilling: vi.fn(),
      onRequireSettings: vi.fn(),
      onSuccess,
      ...overrides,
    } as never),
  );
  return { result, onSuccess, unmount };
}

describe("useAnalyzeGeneration in-flight guard", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // The in-flight registry is module state and so outlives a component --
    // that is the point of it, and it means tests must clear it explicitly.
    __resetInFlightRequests();
    vi.mocked(toast.error).mockClear();
  });

  it("collapses two same-tick triggers into ONE backend call", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const { result } = setup();

    // Both fire before any re-render — exactly the mount-effect + click race.
    await act(async () => {
      void result.current.handleGenerate();
      void result.current.handleGenerate();
      d.resolve({ data: { title: "ok" }, error: null });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("collapses a rapid burst of triggers into ONE backend call", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const { result } = setup();

    await act(async () => {
      for (let i = 0; i < 5; i++) void result.current.handleGenerate();
      d.resolve({ data: { title: "ok" }, error: null });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("still invokes the backend exactly once on a single trigger", async () => {
    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    const { result, onSuccess } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("releases the guard so a later retry works (guard is not a one-shot latch)", async () => {
    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("releases the guard after a FAILED call so Retry is not dead", async () => {
    // The 2026-09-14 504 is exactly this path: first attempt fails, user
    // retries. If the guard leaked on the error path, Retry would be inert.
    invokeMock.mockRejectedValueOnce(new Error("gateway timeout"));
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    await act(async () => {
      await result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("releases the guard after an early-return error branch", async () => {
    // data.error short-circuits with a `return`, not a throw — the release must
    // come from `finally`, not from the happy path.
    invokeMock.mockResolvedValueOnce({
      data: { error: "ebay_account_required" },
      error: null,
    });
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });

    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("does not call the backend at all when the plan limit is reached", async () => {
    const { result } = setup({ canAnalyze: false });

    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("leaves the guard clear after a limit rejection so an upgrade can proceed", async () => {
    // canAnalyze is checked BEFORE the guard is set; a leak here would block
    // the first real analysis after the user upgrades.
    const { result } = setup({ canAnalyze: false });
    await act(async () => {
      await result.current.handleGenerate();
    });
    expect(invokeMock).not.toHaveBeenCalled();

    const { result: r2 } = setup({ canAnalyze: true });
    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    await act(async () => {
      await r2.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
  // ── Remount coverage (Copilot review, PR #564) ─────────────────────────────
  //
  // The ref alone dies with the component instance: a remount gives the new
  // instance a fresh `false` and fires a second full analysis. Re-reading the
  // 2026-09-14 timestamps with that in mind, the four boots were TWO PAIRS
  // 580ms apart -- 27ms within a pair is a same-tick double-fire (the ref's
  // case), but 580ms between pairs is far too long for one tick and is the
  // remount signature. So the ref addressed roughly half the duplication; the
  // module-scoped registry covers the rest.

  it("does NOT re-invoke when the page remounts mid-request", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup();
    await act(async () => {
      void first.result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Unmount while the request is still in flight, then remount — exactly what
    // AnalyzePage's mount effect does on the way back in.
    first.unmount();
    const second = setup();
    await act(async () => {
      void second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ data: { title: "ok" }, error: null });
    });
  });

  it("allows a fresh analysis after the in-flight one completes", async () => {
    // The registry must not become a permanent lock: once the request settles,
    // a remount is entitled to analyze again.
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup();
    await act(async () => {
      void first.result.current.handleGenerate();
      d.resolve({ data: { title: "ok" }, error: null });
    });
    first.unmount();

    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    const second = setup();
    await act(async () => {
      await second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("releases the registry key after a FAILED request so Retry still works", async () => {
    // The 504 path. A leak here would make the whole app refuse to retry the
    // one analysis the user most wants to retry — worse than the duplicate.
    invokeMock.mockRejectedValueOnce(new Error("gateway timeout"));
    const first = setup();
    await act(async () => {
      await first.result.current.handleGenerate();
    });
    first.unmount();

    invokeMock.mockResolvedValue({ data: { title: "ok" }, error: null });
    const second = setup();
    await act(async () => {
      await second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("treats a DIFFERENT analysis as independent, not a duplicate", async () => {
    // Keying on the payload is what makes this safe: two genuinely different
    // items must both run even if one is still in flight.
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup({ imageUrls: ["data:image/jpeg;base64,AAAA"] });
    await act(async () => {
      void first.result.current.handleGenerate();
    });

    const second = setup({ imageUrls: ["data:image/jpeg;base64,BBBB"] });
    await act(async () => {
      void second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      d.resolve({ data: { title: "ok" }, error: null });
    });
  });

  it("treats a changed category as a different analysis", async () => {
    // A user re-running the same photos under a corrected category is a real
    // request, not a duplicate.
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup({ ebayCategoryId: "" });
    await act(async () => {
      void first.result.current.handleGenerate();
    });

    const second = setup({ ebayCategoryId: "11116" });
    await act(async () => {
      void second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      d.resolve({ data: { title: "ok" }, error: null });
    });
  });

  // ----------------------------------------------------------------------
  // Adoption: a suppressed duplicate must still get feedback and a result.
  //
  // De-duplicating the backend call was correct, but bailing out silently left
  // the caller with no result and no spinner -- and AnalyzePage renders
  // "Retry Analysis" whenever `!generating && !generated`. So a duplicate
  // trigger dropped the user onto a retry prompt while the real request still
  // had ~70s to run. Reported 2026-09-14: "it immediately asked me to retry".
  //
  // The remount cases below are the load-bearing ones: within a single instance
  // the first caller has already set `generating`, so the stranded-UI symptom
  // needs the instance that issued the request to be GONE.
  // ----------------------------------------------------------------------

  it("delivers the result to a duplicate that adopted the in-flight request", async () => {
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const { result, onSuccess } = setup();

    await act(async () => {
      void result.current.handleGenerate();
      void result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ data: { title: "1oz Silver Eagle" }, error: null });
    });

    // Both callers resolve from the one request, so onSuccess fires for each.
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith({ title: "1oz Silver Eagle" });
  });

  it("gives a REMOUNTED component the result of the request it adopted", async () => {
    // The reported bug. The instance that issued the request is gone, so
    // without adoption the new instance has no route to the result at all --
    // it sits on a Retry button while the work completes invisibly.
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup();
    await act(async () => {
      void first.result.current.handleGenerate();
    });
    first.unmount();

    const second = setup();
    await act(async () => {
      void second.result.current.handleGenerate();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    // Spinner, not "Retry Analysis", while the adopted request is still live.
    expect(second.result.current.generating).toBe(true);

    await act(async () => {
      d.resolve({ data: { title: "adopted" }, error: null });
    });

    expect(second.onSuccess).toHaveBeenCalledWith({ title: "adopted" });
    expect(second.result.current.generating).toBe(false);
  });

  it("routes a shared failure through the adopter's OWN error path", async () => {
    // The other half of adoption. Note the user sees an error toast either way
    // here -- the original instance's `catch` still fires even though it has
    // unmounted -- so failure is NOT where this fix earns its keep. What this
    // pins down is that the adopter handles the shared rejection itself
    // (its own toast, its own `finally`) rather than inheriting an unhandled
    // rejection or a stuck spinner. Hence the count of 2.
    const d = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(d.promise);

    const first = setup();
    await act(async () => {
      void first.result.current.handleGenerate();
    });
    first.unmount();

    const second = setup();
    await act(async () => {
      void second.result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.reject(new Error("gateway timeout"));
    });

    // One from the original caller, one from the adopter.
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith("gateway timeout");
    expect(second.result.current.generating).toBe(false);
  });

  it("lets a NEW analysis run once the shared request has settled", async () => {
    // Adoption must not leak: the registry entry is deleted in `finally`, so a
    // genuine retry after completion still reaches the backend.
    const first = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(first.promise);

    const { result } = setup();
    await act(async () => {
      void result.current.handleGenerate();
      void result.current.handleGenerate();
    });
    await act(async () => {
      first.resolve({ data: { title: "first" }, error: null });
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    const second = deferred<{ data: unknown; error: null }>();
    invokeMock.mockReturnValue(second.promise);
    await act(async () => {
      void result.current.handleGenerate();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve({ data: { title: "second" }, error: null });
    });
    expect(result.current.generating).toBe(false);
  });
});
