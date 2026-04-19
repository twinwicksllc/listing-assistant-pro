import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ItemSpecifics } from "@/types/listing";

interface UseAnalyzeListingFieldHandlersParams {
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setIncludeAiFooter: (value: boolean) => void;
  setConsignor: (value: string) => void;
  setItemSpecifics: Dispatch<SetStateAction<ItemSpecifics>>;
}

export function useAnalyzeListingFieldHandlers({
  setTitle,
  setDescription,
  setIncludeAiFooter,
  setConsignor,
  setItemSpecifics,
}: UseAnalyzeListingFieldHandlersParams) {
  const updateTitle = useCallback((rawValue: string) => {
    setTitle(rawValue.slice(0, 80));
  }, [setTitle]);

  const updateDescription = useCallback((value: string) => {
    setDescription(value);
  }, [setDescription]);

  const toggleAiFooter = useCallback((checked: boolean) => {
    setIncludeAiFooter(checked);
  }, [setIncludeAiFooter]);

  const updateConsignor = useCallback((value: string) => {
    setConsignor(value);
  }, [setConsignor]);

  const updateItemSpecificValue = useCallback((key: string, value: string) => {
    setItemSpecifics((prev) => ({ ...prev, [key]: value }));
  }, [setItemSpecifics]);

  return {
    updateTitle,
    updateDescription,
    toggleAiFooter,
    updateConsignor,
    updateItemSpecificValue,
  };
}