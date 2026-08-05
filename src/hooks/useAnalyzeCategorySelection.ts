import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { deriveDomainFromCategory, isBullionCategory } from "@/types/listing";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import type { CoinConditionDetail, ItemSpecifics } from "@/types/listing";

interface SuggestedCategory {
  categoryId: string;
  categoryName: string;
  reason: string;
  breadcrumb?: string;
}

interface EbayMetadata {
  requiredAspects: string[];
  suggestedAspects: string[];
  allowedConditions: string[];
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
  setItemSpecifics: Dispatch<SetStateAction<ItemSpecifics>>;
  setCoinConditionDetail: (value: CoinConditionDetail | null) => void;
  setCondition: (value: string) => void;
  /** Clear stale required/suggested aspects from the old category */
  setEbayMetadata: (meta: EbayMetadata | null) => void;
  /** Current coin condition detail — used to warn when a graded coin is put in bullion */
  coinConditionDetail?: CoinConditionDetail | null;
  /** Whether the analyzed coin is in a professional grading slab */
  isSlabbed?: boolean;
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
  setEbayMetadata,
  coinConditionDetail,
  isSlabbed,
}: UseAnalyzeCategorySelectionParams) {
  /**
   * Warn the user if they route a GRADED / SLABBED coin into a Bullion category.
   * eBay bullion leaves have no Grade item specific, so the Grade field will
   * disappear and the graded value can't be captured. This is the #1 cause of
   * "I switched to silver bullion but there's no place to enter the grade."
   */
  const warnIfGradedIntoBullion = useCallback((categoryId: string) => {
    const isGraded = coinConditionDetail?.type === "graded" || !!isSlabbed;
    if (!isGraded) return;
    const breadcrumb = getEbayCategoryBreadcrumb(categoryId) || undefined;
    if (isBullionCategory(categoryId, breadcrumb)) {
      toast.warning(
        "This is a graded/slabbed coin, but bullion categories don't have a Grade field. " +
          "Use a Coins: World or Coins: US category (e.g. South Pacific 3392 for Cook Islands) so the grade shows and can be published.",
        { duration: 8000 },
      );
    }
  }, [coinConditionDetail, isSlabbed]);

  const keepFilledSpecificsOnly = useCallback((prev: ItemSpecifics): ItemSpecifics => {
    const next: ItemSpecifics = {};
    for (const [key, value] of Object.entries(prev)) {
      if (key.startsWith("_")) {
        next[key] = value;
        continue;
      }
      if (typeof value === "string") {
        if (value.trim().length > 0) next[key] = value;
        continue;
      }
      if (value !== null && value !== undefined) {
        next[key] = value;
      }
    }
    return next;
  }, []);

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

  /**
   * Called when the user picks a category from the dropdown (not the custom-ID dialog).
   * Applies the same full state refresh as handleCategoryDialogConfirm so that:
   *   - Stale item specifics from the previous category are cleared
   *   - Stale ebayMetadata (requiredAspects / suggestedAspects) from the previous
   *     category are cleared immediately — preventing the "Missing required eBay
   *     fields: Sport" (or similar) toast from firing for the OLD category's fields
   *     while useAnalyzeCategoryAspects is still fetching aspects for the new one.
   *   - Domain and condition are reset to sensible defaults for the new category.
   * useAnalyzeCategoryAspects will re-populate ebayMetadata once its async fetch
   * for the new category ID completes.
   */
  const handleCategorySelectChange = useCallback((value: string) => {
    if (value === "__custom__") {
      setIsCustomCategoryMode(true);
      setCustomCategoryInput("");
      return;
    }

    // Same as handleCategoryDialogConfirm but without the confirm-dialog step
    setEbayCategoryId(value);
    setCustomCategoryInput("");
    warnIfGradedIntoBullion(value);

    // Derive new domain from the selected category
    const breadcrumb = getEbayCategoryBreadcrumb(value);
    const newDomain = deriveDomainFromCategory(value, breadcrumb);
    setDomain(newDomain);

    // Clear coin condition detail if switching away from a coin category
    const isCoinDomain = newDomain === "coins_bullion";
    if (!isCoinDomain) {
      setCoinConditionDetail(null);
    }

    // Preserve user-entered specifics while switching categories.
    // useAnalyzeCategoryAspects will seed any missing fields for the new category.
    setItemSpecifics((prev) => keepFilledSpecificsOnly(prev));

    // *** KEY FIX: clear stale requiredAspects / suggestedAspects immediately.
    // If we leave the old metadata in place the publish-time validation will fire
    // "Missing required eBay fields: Sport" (or whatever the OLD category required)
    // even after the user has correctly switched to a coin/bullion category.
    // useAnalyzeCategoryAspects will repopulate this once the async fetch finishes.
    setEbayMetadata(null);

    // Reset condition to a sensible default for the new domain
    if (isCoinDomain) {
      setCondition("NEW");
    } else if (newDomain === "trading_cards") {
      setCondition("LIKE_NEW");
    } else {
      setCondition("USED_EXCELLENT");
    }
  }, [
    setCustomCategoryInput,
    setEbayCategoryId,
    setIsCustomCategoryMode,
    setDomain,
    setCoinConditionDetail,
    setItemSpecifics,
    setEbayMetadata,
    setCondition,
    keepFilledSpecificsOnly,
    warnIfGradedIntoBullion,
  ]);

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
    // Exit custom-input mode so the dropdown (now showing the confirmed
    // category as its active selection) is rendered instead of the text box.
    // Without this the page can stay stuck on the "Enter custom category ID"
    // input and the user never sees the category they just confirmed.
    setIsCustomCategoryMode(false);
    setPendingCategoryId("");
    warnIfGradedIntoBullion(categoryId);

    // --- Refresh domain-dependent state for the new category ---
    const breadcrumb = getEbayCategoryBreadcrumb(categoryId);
    const newDomain = deriveDomainFromCategory(categoryId, breadcrumb);
    setDomain(newDomain);

    // Clear coin condition detail if the new category is not a coin category
    const isCoinDomain = newDomain === "coins_bullion";
    if (!isCoinDomain) {
      setCoinConditionDetail(null);
    }

    // Preserve user-entered specifics while switching categories.
    // useAnalyzeCategoryAspects will seed any missing fields for the new category.
    setItemSpecifics((prev) => keepFilledSpecificsOnly(prev));

    // Clear stale required/suggested aspect metadata — the new category's aspects
    // will be populated by useAnalyzeCategoryAspects once its fetch completes.
    setEbayMetadata(null);

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
    setIsCustomCategoryMode,
    setPendingCategoryId,
    setDomain,
    setCoinConditionDetail,
    setItemSpecifics,
    setEbayMetadata,
    setCondition,
    keepFilledSpecificsOnly,
    warnIfGradedIntoBullion,
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
