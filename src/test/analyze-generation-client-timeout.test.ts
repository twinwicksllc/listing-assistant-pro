import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsFetchError } from "@supabase/supabase-js";

/**
 * Regression coverage for the 2026-09-16 finding: `_helpers/sentry.ts`'s
 * `captureException` only fires from inside analyze-item's own catch block,
 * so a platform-level gateway kill (no exception, no catch, nothing logged)
 * is structurally invisible to it. supabase-js throws `FunctionsFetchError`
 * specifically for "never received a response" -- distinct from
 * `FunctionsHttpError`, a real HTTP error the function returned -- and the
 * frontend is the only party that can observe this, so it must detect it
 * and report it to `report-analysis-timeout` rather than treating it like
 * any other failure.
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

function setup(overrides: Record<string, unknown> = {}) {
  const onSuccess = vi.fn();
  const { result } = renderHook(() =>
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
  return { result, onSuccess };
}

describe("useAnalyzeGeneration — client-observed timeout reporting", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    __resetInFlightRequests();
    vi.mocked(toast.error).mockClear();
  });

  it("reports to report-analysis-timeout and shows a distinct message on FunctionsFetchError", async () => {
    invokeMock.mockImplementation(
      (fn: string, opts: { body: Record<string, unknown> }) => {
        if (fn === "analyze-item") {
          expect(typeof opts.body.clientRequestId).toBe("string");
          return Promise.reject(
            new FunctionsFetchError("network fetch failed"),
          );
        }
        if (fn === "report-analysis-timeout") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        throw new Error(`unexpected function ${fn}`);
      },
    );

    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });

    // The distinct, uncertainty-acknowledging message -- not the generic
    // "Failed to analyze item" toast every other error path uses.
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("connection was lost"),
    );

    // report-analysis-timeout was invoked with the SAME clientRequestId that
    // was sent to analyze-item, so the two rows can be correlated.
    const analyzeCall = invokeMock.mock.calls.find(
      ([fn]) => fn === "analyze-item",
    );
    const reportCall = invokeMock.mock.calls.find(
      ([fn]) => fn === "report-analysis-timeout",
    );
    expect(reportCall).toBeDefined();
    expect(reportCall![1].body.clientRequestId).toBe(
      analyzeCall![1].body.clientRequestId,
    );
  });

  it("does NOT report to report-analysis-timeout for a normal HTTP/application error", async () => {
    invokeMock.mockImplementation((fn: string) => {
      if (fn === "analyze-item") {
        return Promise.reject(new Error("some ordinary application error"));
      }
      throw new Error(`unexpected function ${fn}`);
    });

    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(toast.error).toHaveBeenCalledWith("some ordinary application error");
    const reportCall = invokeMock.mock.calls.find(
      ([fn]) => fn === "report-analysis-timeout",
    );
    expect(reportCall).toBeUndefined();
  });

  it("a duplicate that adopts an in-flight request also reports on FunctionsFetchError, using the SAME clientRequestId", async () => {
    let resolveDelay: (() => void) | undefined;
    const delay = new Promise<void>((r) => {
      resolveDelay = r;
    });

    invokeMock.mockImplementation(
      async (fn: string, opts: { body: Record<string, unknown> }) => {
        if (fn === "analyze-item") {
          await delay;
          throw new FunctionsFetchError("network fetch failed");
        }
        if (fn === "report-analysis-timeout") {
          return { data: { ok: true }, error: null };
        }
        throw new Error(`unexpected function ${fn}`);
      },
    );

    const { result } = setup();

    let firstCall: Promise<void>;
    act(() => {
      firstCall = result.current.handleGenerate();
    });
    let secondCall: Promise<void>;
    act(() => {
      secondCall = result.current.handleGenerate();
    });

    await act(async () => {
      resolveDelay?.();
      await Promise.all([firstCall!, secondCall!]);
    });

    const analyzeCalls = invokeMock.mock.calls.filter(
      ([fn]) => fn === "analyze-item",
    );
    expect(analyzeCalls.length).toBe(1); // still exactly one backend invocation

    const reportCalls = invokeMock.mock.calls.filter(
      ([fn]) => fn === "report-analysis-timeout",
    );
    // Both the originating caller and the adopting duplicate report, but with
    // the SAME clientRequestId -- they're describing the same failed attempt.
    expect(reportCalls.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(
      reportCalls.map(
        ([, opts]: [string, { body: { clientRequestId: string } }]) =>
          opts.body.clientRequestId,
      ),
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(analyzeCalls[0][1].body.clientRequestId);
  });
});
