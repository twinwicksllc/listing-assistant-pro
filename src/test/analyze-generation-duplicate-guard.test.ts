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
 * `generating === false`. The fix is a ref, which updates synchronously.
 *
 * AnalyzePage.tsx auto-fires handleGenerate() from a mount effect AND exposes a
 * Retry button, so a remount, a double-click, or any future StrictMode adoption
 * can all double-fire it.
 */

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import {
  __resetInFlightRequests,
  useAnalyzeGeneration,
} from "@/hooks/useAnalyzeGeneration";

/** Defers resolution so we can hold a call "in flight" while firing another. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
});
