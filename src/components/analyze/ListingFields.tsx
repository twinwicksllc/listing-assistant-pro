import {
  Tag,
  Crown,
  ShieldCheck,
  AlertTriangle,
  Check,
  X as XIcon,
  UserCircle,
  AlertCircle,
} from "lucide-react";
import PriceRecommenderCard from "@/components/PriceRecommenderCard";
import CogsInput from "@/components/CogsInput";
import { isCoinConditionDetailComplete } from "@/types/listing";
import type { ItemSpecifics, CoinConditionDetail } from "@/types/listing";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import {
  validateCoinConditionDetail,
  formatValidationErrors,
  describeCoinCondition,
  isCoinConditionValid,
} from "@/lib/coinConditionValidator";

const COIN_GRADING_COMPANIES = ["PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"] as const;
const COIN_RAW_CONDITIONS = [
  "Uncirculated",
  "Extremely Fine to About Uncirculated",
  "Fine to Very Fine",
  "Below Fine",
] as const;

interface SuggestedCategory {
  categoryId: string;
  categoryName: string;
  reason: string;
  breadcrumb?: string;
}

interface AnalysisMeta {
  tier: string;
  creditsUsed: number;
  creditsRemaining: number;
  creditsResetAt: string;
}

interface EbayMetadata {
  requiredAspects: string[];
  suggestedAspects: string[];
  allowedConditions: string[];
}

interface PlanFeatures {
  hasCogsTracking: boolean;
  hasMeltProtection: boolean;
}

interface ConditionOption {
  value: string;
  label: string;
}

interface ListingFieldsProps {
  // Credit meta
  analysisMeta: AnalysisMeta | null;
  currentPlan: string;
  // Title / description
  title: string;
  updateTitle: (v: string) => void;
  description: string;
  updateDescription: (v: string) => void;
  includeAiFooter: boolean;
  toggleAiFooter: (v: boolean) => void;
  // Item specifics
  displaySpecifics: [string, unknown][];
  ebayMetadata: EbayMetadata | null;
  updateItemSpecificValue: (key: string, value: string) => void;
  // Category
  ebayCategoryId: string;
  suggestedCategories: SuggestedCategory[];
  isCustomCategoryMode: boolean;
  customCategoryInput: string;
  hasSelectedCategoryInSuggestions: boolean;
  selectedSuggestedCategory: SuggestedCategory | undefined;
  handleCategorySelectChange: (value: string) => void;
  updateCustomCategoryInput: (v: string) => void;
  handleCustomCategoryInputKeyDown: (key: string) => void;
  confirmCustomCategoryInput: () => void;
  cancelCustomCategoryMode: () => void;
  // Condition
  condition: string;
  conditionOptions: ConditionOption[];
  updateCondition: (v: string) => void;
  coinConditionDetail: CoinConditionDetail | null;
  coinConditionDetailRequired: boolean;
  updateCoinConditionDetail: (detail: CoinConditionDetail) => void;
  setCoinConditionDetailType: (type: "graded" | "raw") => void;
  // Grade
  suggestedGrade: string;
  isSlabbed: boolean;
  domain: string;
  gradeConfirmed: boolean;
  gradingRationale: string;
  acceptSuggestedGrade: (grade: string) => void;
  dismissSuggestedGrade: () => void;
  undoGradeConfirmation: () => void;
  // Consignor
  consignor: string;
  updateConsignor: (v: string) => void;
  // COGS
  cogs: number | undefined;
  setCogs: (v: number | undefined) => void;
  planFeatures: PlanFeatures;
  // Price recommender
  listingPriceForCogs: number;
  priceMin: number;
  priceMax: number;
  metalType: string;
  metalWeightOz: number;
  meltValue: number | null;
  spotPrices: { gold: number; silver: number; platinum: number } | null;
  applyRecommendedPrice: (price: number) => void;
  // Navigation (for upgrade link)
  onNavigateToBilling: () => void;
}

export function ListingFields({
  analysisMeta,
  currentPlan,
  title,
  updateTitle,
  description,
  updateDescription,
  includeAiFooter,
  toggleAiFooter,
  displaySpecifics,
  ebayMetadata,
  updateItemSpecificValue,
  ebayCategoryId,
  suggestedCategories,
  isCustomCategoryMode,
  customCategoryInput,
  hasSelectedCategoryInSuggestions,
  selectedSuggestedCategory,
  handleCategorySelectChange,
  updateCustomCategoryInput,
  handleCustomCategoryInputKeyDown,
  confirmCustomCategoryInput,
  cancelCustomCategoryMode,
  condition,
  conditionOptions,
  updateCondition,
  coinConditionDetail,
  coinConditionDetailRequired,
  updateCoinConditionDetail,
  setCoinConditionDetailType,
  suggestedGrade,
  isSlabbed,
  domain,
  gradeConfirmed,
  gradingRationale,
  acceptSuggestedGrade,
  dismissSuggestedGrade,
  undoGradeConfirmation,
  consignor,
  updateConsignor,
  cogs,
  setCogs,
  planFeatures,
  listingPriceForCogs,
  priceMin,
  priceMax,
  metalType,
  metalWeightOz,
  meltValue,
  spotPrices,
  applyRecommendedPrice,
  onNavigateToBilling,
}: ListingFieldsProps) {
  const coinConditionType = coinConditionDetail?.type ?? (isSlabbed ? "graded" : "raw");
  const gradedDetail = coinConditionDetail?.type === "graded"
    ? coinConditionDetail
    : { type: "graded" as const, gradingCompany: "PCGS" as const, grade: "", certificationNumber: "" };
  const rawDetail = coinConditionDetail?.type === "raw"
    ? coinConditionDetail
    : { type: "raw" as const, rawCondition: "Uncirculated" as const };
  const coinConditionComplete = isCoinConditionDetailComplete(coinConditionDetail);

  return (
    <div className="space-y-4">
      {/* Credit tracking info for free tier */}
      {analysisMeta && currentPlan === "starter" && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Free Tier Credits</p>
              <p className="text-sm font-bold text-blue-900 dark:text-blue-100 mt-0.5">
                {analysisMeta.creditsRemaining} / {analysisMeta.creditsUsed + analysisMeta.creditsRemaining}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                {analysisMeta.creditsRemaining === 0 ? "Limit reached" : `${analysisMeta.creditsRemaining} remaining`}
              </p>
              <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1">
                Resets {new Date(analysisMeta.creditsResetAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          {analysisMeta.creditsRemaining <= 2 && analysisMeta.creditsRemaining > 0 && (
            <p className="text-xs text-blue-700 dark:text-blue-300">
              💡 Running low on credits — upgrade to Pro for unlimited analyses
            </p>
          )}
        </div>
      )}

      {/* Title */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Title</label>
          <span className="text-xs text-muted-foreground">{title.length}/80</span>
        </div>
        <input
          value={title}
          onChange={(e) => updateTitle(e.target.value)}
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Description</label>
        <textarea
          value={description}
          onChange={(e) => updateDescription(e.target.value)}
          rows={5}
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeAiFooter}
            onChange={(e) => toggleAiFooter(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-ring accent-primary"
          />
          <span className="text-xs text-muted-foreground">Append AI disclosure footer</span>
        </label>
        {includeAiFooter && (
          <p className="text-[10px] text-muted-foreground italic bg-muted rounded-md px-2.5 py-1.5">
            "Listing generated by Teckstart AI Assistant. All details should be verified by the buyer."
          </p>
        )}
      </div>

      {/* Item Specifics + Category + Condition */}
      {(displaySpecifics.length > 0 || coinConditionDetailRequired || !!ebayCategoryId) && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-primary" />
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Item Specifics</label>
          </div>

          {/* Category selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">eBay Category</label>
            {!isCustomCategoryMode ? (
              <>
                <select
                  value={ebayCategoryId}
                  onChange={(e) => handleCategorySelectChange(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {suggestedCategories.length > 0 ? (
                    suggestedCategories.map((cat) => {
                      const displayBreadcrumb =
                        cat.breadcrumb ||
                        getEbayCategoryBreadcrumb(cat.categoryId) ||
                        cat.categoryName ||
                        `Category #${cat.categoryId}`;
                      return (
                        <option key={cat.categoryId} value={cat.categoryId}>
                          {displayBreadcrumb}
                        </option>
                      );
                    })
                  ) : (
                    <option value="">No category selected</option>
                  )}
                  {ebayCategoryId && !hasSelectedCategoryInSuggestions && (
                    <option value={ebayCategoryId}>
                      {getEbayCategoryBreadcrumb(ebayCategoryId) || `Category #${ebayCategoryId}`}
                    </option>
                  )}
                  <option value="__custom__">✏️ Enter custom category ID...</option>
                </select>
                {selectedSuggestedCategory?.reason && (
                  <p className="text-[10px] text-muted-foreground italic px-1">
                    {selectedSuggestedCategory.reason}
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2 p-3 bg-card border border-primary rounded-lg">
                <p className="text-[10px] font-medium text-muted-foreground">Enter custom eBay category ID</p>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 39455 for Wheat Penny"
                  value={customCategoryInput}
                  onChange={(e) => updateCustomCategoryInput(e.target.value)}
                  onKeyDown={(e) => handleCustomCategoryInputKeyDown(e.key)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <button
                    onClick={confirmCustomCategoryInput}
                    disabled={!customCategoryInput.trim()}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium transition-colors"
                  >
                    Confirm ID
                  </button>
                  <button
                    onClick={cancelCustomCategoryMode}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Specifics table */}
          {displaySpecifics.length > 0 && (
            <div className="bg-card border border-border rounded-lg divide-y divide-border">
              {displaySpecifics.map(([key, value]) => {
                const isRequired = ebayMetadata?.requiredAspects?.includes(key);
                const isSuggested = ebayMetadata?.suggestedAspects?.includes(key);
                return (
                  <div key={key} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      {key}
                      {isRequired && (
                        <span className="text-[9px] font-semibold text-red-500 uppercase tracking-wide">req</span>
                      )}
                      {isSuggested && !isRequired && (
                        <span className="text-[9px] text-primary/60 uppercase tracking-wide">opt</span>
                      )}
                    </span>
                    <input
                      value={(value as string) || ""}
                      onChange={(e) => updateItemSpecificValue(key, e.target.value)}
                      className="text-xs text-foreground text-right bg-transparent border-none focus:outline-none focus:ring-0 max-w-[55%]"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Condition */}
          <div className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Condition</span>
            <select
              value={condition}
              onChange={(e) => updateCondition(e.target.value)}
              className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right"
            >
              {conditionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {coinConditionDetailRequired && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Coin Condition Details</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Required by eBay for Coins & Paper Money listings.
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  Required
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCoinConditionDetailType("graded")}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${coinConditionType === "graded" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  Graded coin
                </button>
                <button
                  type="button"
                  onClick={() => setCoinConditionDetailType("raw")}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${coinConditionType === "raw" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  Raw coin
                </button>
              </div>

              {coinConditionType === "graded" ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Grading Company</span>
                      <select
                        value={coinConditionDetail?.type === "graded" ? coinConditionDetail.gradingCompany : ""}
                        onChange={(e) => updateCoinConditionDetail({
                          type: "graded",
                          gradingCompany: e.target.value as CoinConditionDetail & { type: "graded" }["gradingCompany"],
                          grade: coinConditionDetail?.type === "graded" ? coinConditionDetail.grade : "",
                          certificationNumber: coinConditionDetail?.type === "graded" ? coinConditionDetail.certificationNumber : undefined,
                        })}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">— Select a grading company —</option>
                        {COIN_GRADING_COMPANIES.map((company) => (
                          <option key={company} value={company}>{company}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Grade</span>
                      <input
                        value={coinConditionDetail?.type === "graded" ? coinConditionDetail.grade : ""}
                        onChange={(e) => updateCoinConditionDetail({
                          type: "graded",
                          gradingCompany: coinConditionDetail?.type === "graded" ? coinConditionDetail.gradingCompany : "PCGS",
                          grade: e.target.value,
                          certificationNumber: coinConditionDetail?.type === "graded" ? coinConditionDetail.certificationNumber : undefined,
                        })}
                        placeholder="MS 65"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <p className="text-[9px] text-muted-foreground italic">Format: &quot;MS 65&quot; or &quot;PR 70 DCAM&quot;</p>
                    </label>
                  </div>

                  <label className="space-y-1 block">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Certification Number</span>
                    <input
                      value={coinConditionDetail?.type === "graded" ? coinConditionDetail.certificationNumber ?? "" : ""}
                      onChange={(e) => updateCoinConditionDetail({
                        type: "graded",
                        gradingCompany: coinConditionDetail?.type === "graded" ? coinConditionDetail.gradingCompany : "PCGS",
                        grade: coinConditionDetail?.type === "graded" ? coinConditionDetail.grade : "",
                        certificationNumber: e.target.value.trim() || undefined,
                      })}
                      placeholder="Optional if not visible"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  {/* Real-time validation feedback for graded coins */}
                  {coinConditionDetail && coinConditionDetail.type === "graded" && !isCoinConditionValid(coinConditionDetail) && (
                    <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950 rounded-lg p-2.5 border border-red-200 dark:border-red-800">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-[10px] text-red-700 dark:text-red-300">
                        {formatValidationErrors(
                          validateCoinConditionDetail(coinConditionDetail).errors,
                        ).split("\n").map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Raw Coin Condition</span>
                    <select
                      value={coinConditionDetail?.type === "raw" ? coinConditionDetail.rawCondition : ""}
                      onChange={(e) => updateCoinConditionDetail({
                        type: "raw",
                        rawCondition: e.target.value as CoinConditionDetail & { type: "raw" }["rawCondition"],
                      })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">— Select a condition tier —</option>
                      {COIN_RAW_CONDITIONS.map((rawCondition) => (
                        <option key={rawCondition} value={rawCondition}>{rawCondition}</option>
                      ))}
                    </select>
                  </label>

                  {/* Real-time validation feedback for raw coins */}
                  {coinConditionDetail && coinConditionDetail.type === "raw" && !isCoinConditionValid(coinConditionDetail) && (
                    <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950 rounded-lg p-2.5 border border-red-200 dark:border-red-800">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-[10px] text-red-700 dark:text-red-300">
                        {formatValidationErrors(
                          validateCoinConditionDetail(coinConditionDetail).errors,
                        ).split("\n").map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!coinConditionComplete ? (
                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950 rounded-lg p-2.5 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-300">
                    Complete these fields before publishing this coin listing.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 bg-green-50 dark:bg-green-950 rounded-lg p-2.5 border border-green-200 dark:border-green-800">
                  <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-green-700 dark:text-green-300">
                    ✓ {describeCoinCondition(coinConditionDetail!)} — Ready to publish
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Suggested Grade — coins/cards only */}
      {suggestedGrade && !isSlabbed && (domain === "coins_bullion" || domain === "trading_cards") && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI-Estimated Grade</label>
          </div>

          <div className={`bg-card border rounded-xl p-4 space-y-3 ${gradeConfirmed ? "border-primary" : "border-accent"}`}>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-foreground">{suggestedGrade}</span>
              {gradeConfirmed ? (
                <span className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                  <Check className="w-3 h-3" /> Confirmed
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-accent-foreground bg-accent px-2 py-1 rounded-full">
                  <AlertTriangle className="w-3 h-3" /> Pending
                </span>
              )}
            </div>

            {gradingRationale && (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Grading Rationale</p>
                <p className="text-xs text-foreground leading-relaxed">{gradingRationale}</p>
              </div>
            )}

            <div className="flex items-start gap-2 bg-accent/30 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-accent-foreground flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-accent-foreground leading-relaxed">
                <strong>Disclaimer:</strong> This is an AI-estimated grade based on photo analysis only. It is NOT a
                substitute for professional grading by PCGS, NGC, or other certification services. Actual grade may
                differ.
              </p>
            </div>

            {!gradeConfirmed ? (
              <div className="flex gap-2">
                <button
                  onClick={() => acceptSuggestedGrade(suggestedGrade)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                >
                  <Check className="w-3.5 h-3.5" />
                  Accept Grade
                </button>
                <button
                  onClick={dismissSuggestedGrade}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-secondary text-foreground text-xs font-semibold transition-all hover:bg-secondary/80 active:scale-[0.98]"
                >
                  <XIcon className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </div>
            ) : (
              <button
                onClick={undoGradeConfirmation}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Undo confirmation
              </button>
            )}
          </div>
        </div>
      )}

      {/* Consignor */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <UserCircle className="w-3.5 h-3.5 text-primary" />
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Consignor</label>
          <span className="text-[10px] text-muted-foreground/60 ml-auto">Optional</span>
        </div>
        <input
          value={consignor}
          onChange={(e) => updateConsignor(e.target.value)}
          placeholder="Who does this item belong to?"
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Item Cost (COGS) */}
      <CogsInput
        cogs={cogs}
        listingPrice={listingPriceForCogs}
        onChange={setCogs}
        disabled={!planFeatures.hasCogsTracking}
        domain={domain}
      />

      {/* Smart Price Recommender */}
      <PriceRecommenderCard
        title={title}
        condition={condition}
        priceMin={priceMin}
        priceMax={priceMax}
        metalType={planFeatures.hasMeltProtection && metalType !== "none" ? metalType : undefined}
        metalWeightOz={planFeatures.hasMeltProtection && metalType !== "none" ? metalWeightOz : undefined}
        meltValue={planFeatures.hasMeltProtection && metalType !== "none" ? meltValue : null}
        spotPrices={planFeatures.hasMeltProtection && metalType !== "none" ? spotPrices : null}
        onApplyPrice={applyRecommendedPrice}
      />
    </div>
  );
}
