import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface UseAnalyzeGenerationParams {
  canAnalyze: boolean;
  analysisLimit: number;
  imageUrls: string[];
  voiceNote: string;
  ebayCategoryId: string;
  onRequireBilling: () => void;
  onRequireSettings: () => void;
  onSuccess: (data: any) => void;
}

/**
 * Module-scoped in-flight registry, keyed by request identity.
 *
 * A per-instance ref cannot survive a remount: React gives the new instance a
 * fresh ref initialized to false, so an unmount/remount mid-request starts a
 * second full analysis. That is not hypothetical -- the 2026-09-14 logs show
 * analyze-item booting four times for one analysis as TWO PAIRS 580ms apart.
 * The 27ms within each pair is a same-tick double-fire (a ref fixes that); the
 * 580ms between pairs is far too long for one tick and is the remount signature.
 *
 * Keying on the request payload rather than using a single global flag keeps two
 * genuinely different analyses independent, while making a remount of the SAME
 * analysis a no-op. Module scope is what gives it a lifetime longer than the
 * component's, which is the entire point.
 */
interface InFlightEntry {
  startedAt: number;
  /**
   * The outstanding invoke promise. Storing it -- rather than just a timestamp
   * -- is what lets a duplicate trigger ADOPT the running request instead of
   * merely being turned away. A remounted component has no other route back to
   * a result its predecessor started, and turning it away silently was what
   * showed the user a "Retry Analysis" button over live work (2026-09-14).
   *
   * Rejections are consumed by whoever awaits this; the `.catch` attached at
   * store time keeps an unadopted rejection from surfacing as an unhandled
   * promise rejection.
   */
  promise: Promise<{ data: unknown; error: unknown }>;
  /**
   * The id sent to analyze-item as `clientRequestId`, so a duplicate that
   * adopts this entry can still report a FunctionsFetchError against the
   * SAME analysis_attempts row the originating caller's request created.
   */
  clientRequestId: string;
}

const inFlightRequests = new Map<string, InFlightEntry>();

/**
 * Safety valve. Entries are removed in `finally`, so this only matters if a
 * request neither resolves nor rejects (page suspended mid-flight, for
 * example). Without it a leaked key would block that analysis for the lifetime
 * of the tab -- a worse failure than the duplicate it prevents, since the user
 * would have no way to recover. Comfortably longer than the 150s gateway kill.
 */
const IN_FLIGHT_TTL_MS = 180_000;

function requestKey(
  imageUrls: string[],
  voiceNote: string,
  ebayCategoryId: string,
): string {
  return JSON.stringify([imageUrls, voiceNote, ebayCategoryId]);
}

/**
 * Returns the live entry for `key`, or null if there is none (or the existing
 * one has aged past the TTL safety valve and should be treated as abandoned).
 */
function findInFlight(key: string): InFlightEntry | null {
  const existing = inFlightRequests.get(key);
  if (existing && Date.now() - existing.startedAt < IN_FLIGHT_TTL_MS) {
    return existing;
  }
  return null;
}

/**
 * Fire-and-forget report of a network-level analysis failure to
 * `report-analysis-timeout`. `FunctionsFetchError` means supabase-js never
 * received ANY response (as opposed to `FunctionsHttpError`, a real HTTP
 * error the function returned) -- this is the one failure mode
 * `_helpers/sentry.ts`'s `captureException` structurally cannot see, since a
 * platform-level gateway kill of analyze-item never reaches its own catch
 * block. See `analysis_attempts`'s migration comment for the full rationale.
 *
 * Deliberately swallows its own errors -- reporting a timeout must never
 * itself throw and mask the user-facing toast for the timeout it's reporting.
 */
function reportClientObservedTimeout(clientRequestId: string): void {
  supabase.functions
    .invoke("report-analysis-timeout", { body: { clientRequestId } })
    .catch((reportErr) => {
      console.warn(
        "[useAnalyzeGeneration] Failed to report client-observed timeout (non-blocking):",
        reportErr,
      );
    });
}

/** Exposed for tests: module state outlives a component, so it must be resettable. */
export function __resetInFlightRequests(): void {
  inFlightRequests.clear();
}

export function useAnalyzeGeneration({
  canAnalyze,
  analysisLimit,
  imageUrls,
  voiceNote,
  ebayCategoryId,
  onRequireBilling,
  onRequireSettings,
  onSuccess,
}: UseAnalyzeGenerationParams) {
  const [generating, setGenerating] = useState(false);
  /**
   * Shared outcome handling for both the originating call and any adopted
   * duplicate. Extracted so the two paths cannot drift: an adopted caller must
   * get the same toasts, the same billing/settings redirects and the same
   * onSuccess as the caller that actually issued the request.
   *
   * Throws for the generic failure cases so the caller's catch renders one
   * error toast; returns normally for the cases that have already shown their
   * own specific toast.
   */
  const handleResult = useCallback(
    // deno-lint-ignore no-explicit-any -- mirrors the loose supabase-js
    // invoke() result typing already used throughout this hook.
    async (data: any, error: any) => {
      if (error) {
        if (error.status === 429) {
          toast.error(
            "Monthly AI analysis limit reached. Upgrade to Pro or Unlimited.",
          );
          onRequireSettings();
          return;
        }
        throw new Error(error.message || "Analysis failed");
      }

      if (data?.error) {
        if (data.error === "ebay_account_required") {
          toast.error("Connect an eBay account to start generating listings", {
            description: "The free tier requires an active eBay connection.",
            action: {
              label: "Connect",
              onClick: onRequireSettings,
            },
          });
          return;
        }

        if (data.error.includes("limit")) {
          toast.error(data.error);
          onRequireSettings();
          return;
        }

        throw new Error(data.error);
      }

      onSuccess(data);
    },
    [onRequireSettings, onSuccess],
  );

  const handleGenerate = useCallback(async () => {
    if (!canAnalyze) {
      toast.error(
        `Monthly analysis limit reached (${analysisLimit}). Upgrade for more listings.`,
      );
      onRequireBilling();
      return;
    }

    /**
     * One key, one in-flight analysis -- this single guard now covers BOTH
     * failure modes the 2026-09-14 logs showed (analyze-item booting four
     * times for one analysis: two pairs 27ms apart, 580ms between pairs).
     *
     * Same-tick double-fire: `findInFlight` and the `set` below run with no
     * await between them, so the second synchronous call in the same tick
     * already sees the entry. (`generating` state cannot do this -- it does not
     * update until the next render, so both calls would read false.)
     *
     * Remount mid-request: the registry is module-scoped, so it outlives the
     * component instance that started the request.
     *
     * A per-instance ref used to cover the first case, but it is redundant now
     * that the registry is claimed synchronously, and it could not cover the
     * second at all.
     */
    const key = requestKey(imageUrls, voiceNote, ebayCategoryId);
    const existing = findInFlight(key);

    // A duplicate trigger ADOPTS the running request rather than being turned
    // away. Returning early here used to leave `generating` false, and
    // AnalyzePage renders its "Retry Analysis" button whenever
    // `!generating && !generated` -- so suppressing a duplicate dropped the
    // user onto a retry prompt while the real request still had ~70s to run
    // (reported 2026-09-14: "it immediately asked me to retry"). Awaiting the
    // same promise means the second caller keeps the spinner and receives the
    // same result, so de-duplicating the BACKEND call no longer costs the user
    // their feedback. Still exactly one analyze-item invocation.
    if (existing) {
      console.warn(
        "[useAnalyzeGeneration] Identical analysis already in flight — adopting its result instead of re-invoking",
      );
      setGenerating(true);
      try {
        const { data, error } = await existing.promise;
        await handleResult(data, error);
      } catch (err: any) {
        console.error("Analysis error (adopted):", err);
        if (err instanceof FunctionsFetchError) {
          reportClientObservedTimeout(existing.clientRequestId);
          toast.error(
            "The analysis took too long and the connection was lost. This can happen with complex items — check your credits if you're unsure whether this attempt was charged.",
          );
        } else {
          toast.error(
            err.message || "Failed to analyze item. Please try again.",
          );
        }
      } finally {
        setGenerating(false);
      }
      return;
    }

    // Sent to analyze-item as `clientRequestId` and used as the correlation
    // key for the analysis_attempts diagnostic table -- generated BEFORE the
    // call so it survives even a response the client never receives (a
    // FunctionsFetchError below has no server-assigned id to report against,
    // since no response ever arrived).
    const clientRequestId = crypto.randomUUID();
    setGenerating(true);
    const pending = supabase.functions.invoke("analyze-item", {
      body: {
        images: imageUrls,
        voiceNote,
        clientRequestId,
        ...(ebayCategoryId ? { categoryId: ebayCategoryId } : {}),
      },
    }) as Promise<{ data: unknown; error: unknown }>;
    // Attached before anyone awaits, so a rejection nobody adopted does not
    // surface as an unhandled promise rejection.
    pending.catch(() => {});
    inFlightRequests.set(key, {
      startedAt: Date.now(),
      promise: pending,
      clientRequestId,
    });

    try {
      const { data, error } = await pending;
      await handleResult(data, error);
    } catch (err: any) {
      console.error("Analysis error:", err);
      if (err instanceof FunctionsFetchError) {
        reportClientObservedTimeout(clientRequestId);
        toast.error(
          "The analysis took too long and the connection was lost. This can happen with complex items — check your credits if you're unsure whether this attempt was charged.",
        );
      } else {
        toast.error(err.message || "Failed to analyze item. Please try again.");
      }
    } finally {
      inFlightRequests.delete(key);
      setGenerating(false);
    }
  }, [
    canAnalyze,
    analysisLimit,
    imageUrls,
    voiceNote,
    ebayCategoryId,
    onRequireBilling,
    handleResult,
  ]);

  return {
    generating,
    handleGenerate,
  };
}
