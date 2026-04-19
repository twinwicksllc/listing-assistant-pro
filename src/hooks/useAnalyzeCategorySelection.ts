import { useCallback, useMemo } from "react";
import { toast } from "sonner";

interface SuggestedCategory {
  categoryId: string;
  categoryName: string;
  reason: string;
  breadcrumb?: string;
}

interface UseAnalyzeCategorySelectionParams {
  ebayCategoryId: string;
  suggestedCategories: SuggestedCategory[];
  customCategoryInput: string;
  setCustomCategoryInput: (value: string) => void;
  setPendingCategoryId: (value: string) => void;
  setShowCategoryConfirm: (value: boolean) => void;
  setIsCustomCategoryMode: (value: boolean) => void;
  setEbayCategoryId: (value: string) => void;
}

export function useAnalyzeCategorySelection({
  ebayCategoryId,
  suggestedCategories,
  customCategoryInput,
  setCustomCategoryInput,
  setPendingCategoryId,
  setShowCategoryConfirm,
  setIsCustomCategoryMode,
  setEbayCategoryId,
}: UseAnalyzeCategorySelectionParams) {
  const selectedSuggestedCategory = useMemo(
    () => suggestedCategories.find((c) => c.categoryId === ebayCategoryId),
    [ebayCategoryId, suggestedCategories],
  );

  const hasSelectedCategoryInSuggestions = !!selectedSuggestedCategory;

  const confirmCustomCategoryInput = useCallback(() => {
    const trimmed = customCategoryInput.trim();
    if (!trimmed) return;
    setPendingCategoryId(trimmed);
    setShowCategoryConfirm(true);
  }, [customCategoryInput, setPendingCategoryId, setShowCategoryConfirm]);

  const cancelCustomCategoryMode = useCallback(() => {
    setIsCustomCategoryMode(false);
    setCustomCategoryInput("");
  }, [setCustomCategoryInput, setIsCustomCategoryMode]);

  const handleCategorySelectChange = useCallback((value: string) => {
    if (value === "__custom__") {
      setIsCustomCategoryMode(true);
      setCustomCategoryInput("");
      return;
    }
    setEbayCategoryId(value);
    setCustomCategoryInput("");
  }, [setCustomCategoryInput, setEbayCategoryId, setIsCustomCategoryMode]);

  const handleCategoryDialogConfirm = useCallback((categoryId: string) => {
    setEbayCategoryId(categoryId);
    setCustomCategoryInput("");
    setShowCategoryConfirm(false);
    toast.success(`Category ${categoryId} confirmed`);
  }, [setCustomCategoryInput, setEbayCategoryId, setShowCategoryConfirm]);

  const handleCategoryDialogCancel = useCallback(() => {
    setShowCategoryConfirm(false);
    setPendingCategoryId("");
  }, [setPendingCategoryId, setShowCategoryConfirm]);

  return {
    selectedSuggestedCategory,
    hasSelectedCategoryInSuggestions,
    confirmCustomCategoryInput,
    cancelCustomCategoryMode,
    handleCategorySelectChange,
    handleCategoryDialogConfirm,
    handleCategoryDialogCancel,
  };
}
