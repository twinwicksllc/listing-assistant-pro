import { useCallback, useState } from "react";
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

  const handleGenerate = useCallback(async () => {
    if (!canAnalyze) {
      toast.error(
        `Monthly analysis limit reached (${analysisLimit}). Upgrade for more listings.`,
      );
      onRequireBilling();
      return;
    }

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
