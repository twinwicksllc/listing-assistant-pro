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
   * In-flight guard. `generating` is React state, so it does not update until
   * the next render -- two calls to handleGenerate() in the same tick both read
   * `generating === false` and both fire. A ref updates synchronously and so
   * actually blocks the second call.
   *
   * This is not theoretical: on 2026-09-14 production logs showed analyze-item
   * booting four times for a single analysis (pairs ~27ms apart), each pair
   * running a full Gemini pipeline -- double AI spend and double pressure on
   * the same upstream rate limits the real request needs. AnalyzePage.tsx
   * auto-fires this on mount AND exposes a Retry button, so a remount, a
   * double-click, or any future StrictMode adoption can all double-fire it.
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
