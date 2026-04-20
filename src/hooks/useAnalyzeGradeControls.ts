import { useCallback } from "react";
import { toast } from "sonner";
import type { ItemSpecifics } from "@/types/listing";

type SetItemSpecifics = (updater: (prev: ItemSpecifics) => ItemSpecifics) => void;

interface UseAnalyzeGradeControlsParams {
  setGradeConfirmed: (value: boolean) => void;
  setItemSpecifics: SetItemSpecifics;
  setSuggestedGrade: (value: string) => void;
  setGradingRationale: (value: string) => void;
}

export function useAnalyzeGradeControls({
  setGradeConfirmed,
  setItemSpecifics,
  setSuggestedGrade,
  setGradingRationale,
}: UseAnalyzeGradeControlsParams) {
  const acceptSuggestedGrade = useCallback((grade: string) => {
    setGradeConfirmed(true);
    setItemSpecifics((prev) => ({ ...prev, Grade: grade }));
    toast.success(`Grade ${grade} applied to item specifics`);
  }, [setGradeConfirmed, setItemSpecifics]);

  const dismissSuggestedGrade = useCallback(() => {
    setSuggestedGrade("");
    setGradingRationale("");
    setItemSpecifics((prev) => ({ ...prev, Grade: "Ungraded" }));
    toast("Grade dismissed - set to Ungraded");
  }, [setGradingRationale, setItemSpecifics, setSuggestedGrade]);

  const undoGradeConfirmation = useCallback(() => {
    setGradeConfirmed(false);
    setItemSpecifics((prev) => ({ ...prev, Grade: "Ungraded" }));
  }, [setGradeConfirmed, setItemSpecifics]);

  return {
    acceptSuggestedGrade,
    dismissSuggestedGrade,
    undoGradeConfirmation,
  };
}
