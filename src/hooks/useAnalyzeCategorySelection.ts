import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { deriveDomainFromCategory } from "@/types/listing";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import type { CoinConditionDetail, ItemSpecifics } from "@/types/listing";

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
  // Category-change side-effect callbacks
  setDomain: (value: string) => void;
  setItemSpecifics: (value: ItemSpecifics) => void;
  setCoinConditionDetail: (value: CoinConditionDetail | null) => void;
  setCondition: (value: string) => void;
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
  setDomain,
  setItemSpecifics,
  setCoinConditionDetail,
  setCondition,
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

  const updateCustomCategoryInput = useCallback((rawValue: string) => {
    setCustomCategoryInput(rawValue.replace(/\D/g, ""));
  }, [setCustomCategoryInput]);

  const handleCustomCategoryInputKeyDown = useCallback((key: string) => {
    if (key === "Enter") {
      confirmCustomCategoryInput();
    }
  }, [confirmCustomCategoryInput]);

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

  /**
   * Called when the user confirms a category override (custom ID or suggestion switch).
   * In addition to updating the category ID, this refreshes all domain-dependent state
   * so that condition options, item specifics, and the coin condition panel all match
   * the newly selected category — preventing stale coin fields from appearing on
   * non-coin categories and vice versa.
   */
  const handleCategoryDialogConfirm = useCallback((categoryId: string) => {
    setEbayCategoryId(categoryId);
    setCustomCategoryInput("");
    setShowCategoryConfirm(false);

    // --- Refresh domain-dependent state for the new category ---
    const breadcrumb = getEbayCategoryBreadcrumb(categoryId);
    const newDomain = deriveDomainFromCategory(categoryId, breadcrumb);
    setDomain(newDomain);

    // Clear coin condition detail if the new category is not a coin category
    const isCoinDomain = newDomain === "coins_bullion";
    if (!isCoinDomain) {
      setCoinConditionDetail(null);
    }

    // Clear stale item specifics — they were built for the old category.
    // Keep any user-edited free-text fields that are category-agnostic.
    setItemSpecifics({});

    // Reset condition to a sensible default for the new domain
    if (isCoinDomain) {
      setCondition("NEW");
    } else if (newDomain === "trading_cards") {
      setCondition("LIKE_NEW");
    } else {
      setCondition("USED_EXCELLENT");
    }

    toast.success(`Category updated to ${categoryId} — item specifics refreshed`);
  }, [
    setEbayCategoryId,
    setCustomCategoryInput,
    setShowCategoryConfirm,
    setDomain,
    setCoinConditionDetail,
    setItemSpecifics,
    setCondition,
  ]);

  const handleCategoryDialogCancel = useCallback(() => {
    setShowCategoryConfirm(false);
    setPendingCategoryId("");
  }, [setPendingCategoryId, setShowCategoryConfirm]);

  return {
    selectedSuggestedCategory,
    hasSelectedCategoryInSuggestions,
    confirmCustomCategoryInput,
    updateCustomCategoryInput,
    handleCustomCategoryInputKeyDown,
    cancelCustomCategoryMode,
    handleCategorySelectChange,
    handleCategoryDialogConfirm,
    handleCategoryDialogCancel,
  };
}
