import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
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
const inFlightRequests = new Map<string, number>();

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

function claimInFlight(key: string): boolean {
  const startedAt = inFlightRequests.get(key);
  if (startedAt !== undefined && Date.now() - startedAt < IN_FLIGHT_TTL_MS) {
    return false;
  }
  inFlightRequests.set(key, Date.now());
  return true;
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
   * Same-tick guard (layer 1 of 2; see inFlightRequests above for layer 2).
   *
   * `generating` is React state, so it does not update until the next render --
   * two calls to handleGenerate() in the same tick both read
   * `generating === false` and both fire. A ref updates synchronously and so
   * actually blocks the second call.
   *
   * This ref alone is NOT sufficient: it dies with the component instance, so a
   * remount mid-request slips past it. The module-scoped registry covers that;
   * this covers the cheaper and more common same-tick case without touching
   * shared state.
   *
   * The incident: on 2026-09-14 production logs showed analyze-item booting
   * four times for a single analysis, each boot running a full Gemini pipeline
   * -- double AI spend and double pressure on the same upstream rate limits the
   * real request needs. AnalyzePage.tsx auto-fires this from a mount effect AND
   * exposes a Retry button, so a remount, a double-click, or any future
   * StrictMode adoption can all double-fire it.
   */
  const inFlightRef = useRef(false);

  const handleGenerate = useCallback(async () => {
    if (inFlightRef.current) {
      console.warn(
        "[useAnalyzeGeneration] Analysis already in flight — ignoring duplicate trigger",
      );
      return;
    }

    if (!canAnalyze) {
      toast.error(
        `Monthly analysis limit reached (${analysisLimit}). Upgrade for more listings.`,
      );
      onRequireBilling();
      return;
    }

    // Survives a remount, unlike the ref above.
    const key = requestKey(imageUrls, voiceNote, ebayCategoryId);
    if (!claimInFlight(key)) {
      console.warn(
        "[useAnalyzeGeneration] Identical analysis already in flight (remount?) — ignoring duplicate trigger",
      );
      return;
    }

    inFlightRef.current = true;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-item", {
        body: {
          images: imageUrls,
          voiceNote,
          ...(ebayCategoryId ? { categoryId: ebayCategoryId } : {}),
        },
      });

      if (error) {
        if (error.status === 429) {
          toast.error(
            "Monthly AI analysis limit reached. Upgrade to Pro or Unlimited.",
          );
          onRequireSettings();
          setGenerating(false);
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
          setGenerating(false);
          return;
        }

        if (data.error.includes("limit")) {
          toast.error(data.error);
          onRequireSettings();
          setGenerating(false);
          return;
        }

        throw new Error(data.error);
      }

      onSuccess(data);
    } catch (err: any) {
      console.error("Analysis error:", err);
      toast.error(err.message || "Failed to analyze item. Please try again.");
    } finally {
      inFlightRequests.delete(key);
      inFlightRef.current = false;
      setGenerating(false);
    }
  }, [
    canAnalyze,
    analysisLimit,
    imageUrls,
    voiceNote,
    ebayCategoryId,
    onRequireBilling,
    onRequireSettings,
    onSuccess,
  ]);

  return {
    generating,
    handleGenerate,
  };
}
