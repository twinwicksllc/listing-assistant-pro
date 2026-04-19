import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Send, Tag, Crown, Download, FileSpreadsheet, Sheet, ShieldCheck, AlertTriangle, Check, X as XIcon, Lock, UserCircle, DollarSign, Gavel } from "lucide-react";
import PriceRecommenderCard from "@/components/PriceRecommenderCard";
import CogsInput from "@/components/CogsInput";
import CategoryConfirmDialog from "@/components/CategoryConfirmDialog";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics } from "@/types/listing";
import { getConditionsForCategory } from "@/types/listing";
import { useAuth } from "@/contexts/AuthContext";
import type { ExportPlatform, ExportFormat } from "@/lib/exportCSV";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import type { SelectedPolicies } from "@/types/ebay-policies";
import { VideoUploadInput } from "@/components/VideoUploadInput";
import { useAnalyzePublish } from "@/hooks/useAnalyzePublish";
import { useAnalyzeGeneration } from "@/hooks/useAnalyzeGeneration";
import { useAnalyzeSave } from "@/hooks/useAnalyzeSave";
import { useAnalyzeCategorySelection } from "@/hooks/useAnalyzeCategorySelection";
import { useAnalyzeExport } from "@/hooks/useAnalyzeExport";
import { useAnalyzePolicyToken } from "@/hooks/useAnalyzePolicyToken";

export default function AnalyzePage() {
  const { canAnalyze, canPublish, usage, recordUsage, isOwner, currentPlanLimits, planFeatures, currentPlan, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();

  const state = location.state as any;
  const imageUrls: string[] = state?.imageUrls ?? (state?.imageUrl ? [state.imageUrl] : []);
  const voiceNote: string = state?.voiceNote || "";

  const [generated, setGenerated] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [activePhoto, setActivePhoto] = useState(0);
  const [metalType, setMetalType] = useState<string>("none");
  const [metalWeightOz, setMetalWeightOz] = useState<number>(0);
  const [ebayCategoryId, setEbayCategoryId] = useState<string>("");
  const [suggestedCategories, setSuggestedCategories] = useState<Array<{ categoryId: string; categoryName: string; reason: string; breadcrumb?: string }>>([]);
  const [itemSpecifics, setItemSpecifics] = useState<ItemSpecifics>({});
  const [condition, setCondition] = useState<string>("USED_EXCELLENT");
  const [exportPlatform, setExportPlatform] = useState<ExportPlatform>("ebay_file_exchange");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [suggestedGrade, setSuggestedGrade] = useState<string>("");
  const [gradingRationale, setGradingRationale] = useState<string>("");
  const [isSlabbed, setIsSlabbed] = useState(false);
  const [gradeConfirmed, setGradeConfirmed] = useState(false);
  const [meltValue, setMeltValue] = useState<number | null>(null);
  const [spotPrices, setSpotPrices] = useState<{ gold: number; silver: number; platinum: number } | null>(null);
  const [consignor, setConsignor] = useState("");
  const [cogs, setCogs] = useState<number | undefined>(undefined);
  const [includeAiFooter, setIncludeAiFooter] = useState(true);
  const [showCategoryConfirm, setShowCategoryConfirm] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string>("");
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);

  // Domain from Pass 1 AI identification — used to conditionally show domain-specific UI
  const [domain, setDomain] = useState<string>("general");

  // eBay metadata returned by analyze-item when real aspects/conditions data was fetched
  const [ebayMetadata, setEbayMetadata] = useState<{
    requiredAspects: string[];
    suggestedAspects: string[];
    allowedConditions: string[];
  } | null>(null);

  // Phase 2: Credit tracking metadata from analyze-item response
  const [analysisMeta, setAnalysisMeta] = useState<{
    tier: string;
    creditsUsed: number;
    creditsRemaining: number;
    creditsResetAt: string;
  } | null>(null);

  // eBay business policies — selected by the user on this page
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });

  // Listing format and price — separate from AI pricing research (priceMin/priceMax
  // are read-only AI suggestions; these are what actually gets submitted to eBay)
  const [listingFormat, setListingFormat] = useState<"FIXED_PRICE" | "AUCTION">("FIXED_PRICE");
  const [listingPrice, setListingPrice] = useState(0);
  const [auctionStartPrice, setAuctionStartPrice] = useState(0);
  const [auctionBuyItNowEnabled, setAuctionBuyItNowEnabled] = useState(false);
  const [auctionBuyItNow, setAuctionBuyItNow] = useState(0);

  // Best Offer (Fixed Price only)
  const [bestOfferEnabled, setBestOfferEnabled] = useState(false);
  const [bestOfferAutoAcceptPrice, setBestOfferAutoAcceptPrice] = useState<number>(0);
  const [bestOfferAutoDeclinePrice, setBestOfferAutoDeclinePrice] = useState<number>(0);

  // Multi-quantity (Fixed Price only)
  const [quantity, setQuantity] = useState(1);
  const [pricingMode, setPricingMode] = useState<'per_item' | 'total'>('per_item');

  // Video upload (optional — eBay Video API)
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [ebayVideoId, setEbayVideoId] = useState<string | null>(null);
  const [ebayVideoStatus, setEbayVideoStatus] = useState<string | null>(null);
  const videoIsProcessing = !!ebayVideoId && ebayVideoStatus !== "LIVE" && ebayVideoStatus !== "FAILED";

  const AI_FOOTER = "\n\n---\nListing generated by Teckstart AI Assistant. All details should be verified by the buyer.";
  const getDescriptionWithFooter = () => includeAiFooter ? description + AI_FOOTER : description;

  const buildPublishPayload = ({
    imageUrlsForPayload,
    postalCode,
    city,
  }: {
    imageUrlsForPayload: string[];
    postalCode?: string | null;
    city?: string | null;
  }) => ({
    title,
    description: getDescriptionWithFooter(),
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
    imageUrls: imageUrlsForPayload,
    condition,
    ebayCategoryId,
    itemSpecifics,
    postalCode: postalCode || undefined,
    city: city || undefined,
    fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId || undefined,
    paymentPolicyId: selectedPolicies.paymentPolicyId || undefined,
    returnPolicyId: selectedPolicies.returnPolicyId || undefined,
    bestOfferEnabled: bestOfferEnabled || undefined,
    bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
    bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
    quantity: quantity > 1 ? quantity : undefined,
    pricingMode: quantity > 1 ? pricingMode : undefined,
    ebayVideoId: ebayVideoStatus === "LIVE" ? ebayVideoId : undefined,
  });

  const handlePublishSuccess = async (data: any) => {
    await recordUsage("ebay_publish");

    // Persist COGS to listing_cogs so the Listings detail modal and Profit Report
    // can show cost/margin data even after this session ends.
    if (cogs != null && user?.id && (data.sku || data.listingId)) {
      try {
        await (supabase as any).from("listing_cogs").insert({
          user_id: user.id,
          ebay_sku: data.sku ?? null,
          ebay_listing_id: data.listingId ?? null,
          title,
          cogs,
          cogs_source: "manual",
        });
      } catch (cogsErr) {
        console.warn("Failed to persist COGS after direct publish:", cogsErr);
      }
    }

    navigate("/home");
  };

  const { publishing, handlePublish, loadPolicyToken } = useAnalyzePublish({
    canPublish,
    publishLimit: currentPlanLimits.publishLimit,
    userId: user?.id,
    imageUrls,
    itemSpecifics,
    ebayMetadata,
    buildPublishPayload,
    onRequireBilling: () => navigate("/billing"),
    onPublishSuccess: handlePublishSuccess,
  });

  const handleAnalyzeSuccess = (data: any) => {
    if (data._meta) {
      setAnalysisMeta(data._meta);
    }
    if (data._ebayMetadata) {
      setEbayMetadata(data._ebayMetadata);
    } else {
      setEbayMetadata(null);
    }

    setTitle((data.title || "").slice(0, 80));
    setDescription(data.description || "");
    setPriceMin(data.priceMin || 0);
    setPriceMax(data.priceMax || 0);
    setMetalType(data.metalType || "none");
    setMetalWeightOz(data.metalWeightOz || 0);
    setEbayCategoryId(data.ebayCategoryId || "");
    setIsCustomCategoryMode(false);
    setSuggestedCategories(data.suggestedCategories || []);
    setItemSpecifics(data.itemSpecifics || {});
    setCondition(data.condition || "USED_EXCELLENT");
    setSuggestedGrade(data.suggestedGrade || "");
    setGradingRationale(data.gradingRationale || "");
    setIsSlabbed(data.isSlabbed ?? false);
    setMeltValue(data.meltValue ?? null);
    setSpotPrices(data.spotPrices ?? null);
    setGradeConfirmed(false);
    setDomain(data.domain || "general");

    // Pre-fill listing price with AI midpoint as a starting suggestion
    const aiMid = ((data.priceMin || 0) + (data.priceMax || data.priceMin || 0)) / 2;
    setListingPrice(parseFloat(aiMid.toFixed(2)) || 0);
    setAuctionStartPrice(parseFloat((data.priceMin || 0).toFixed(2)) || 0);
    setGenerated(true);
  };

  const { generating, handleGenerate } = useAnalyzeGeneration({
    canAnalyze,
    analysisLimit: currentPlanLimits.analysisLimit,
    imageUrls,
    voiceNote,
    ebayCategoryId,
    onRequireBilling: () => navigate("/billing"),
    onRequireSettings: () => navigate("/settings?tab=billing"),
    onSuccess: handleAnalyzeSuccess,
  });

  const buildDraftPayload = (uploadedUrls: string[]) => ({
    id: crypto.randomUUID(),
    imageUrl: uploadedUrls[0],
    imageUrls: uploadedUrls,
    title,
    description: getDescriptionWithFooter(),
    priceMin,
    priceMax,
    listingPrice: listingPrice > 0
      ? listingPrice
      : auctionStartPrice > 0
      ? auctionStartPrice
      : parseFloat(((priceMin + priceMax) / 2).toFixed(2)),
    listingFormat,
    createdAt: new Date(),
    ebayCategoryId,
    ebayCategoryBreadcrumb: getEbayCategoryBreadcrumb(ebayCategoryId),
    itemSpecifics,
    condition,
    consignor,
    cogs: cogs ?? undefined,
    cogsSource: cogs != null ? "manual" : undefined,
    fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId ?? undefined,
    paymentPolicyId: selectedPolicies.paymentPolicyId ?? undefined,
    returnPolicyId: selectedPolicies.returnPolicyId ?? undefined,
    metalType: metalType !== "none" ? metalType : undefined,
    metalWeightOz: metalWeightOz > 0 ? metalWeightOz : undefined,
    bestOfferEnabled: bestOfferEnabled || undefined,
    bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0
      ? bestOfferAutoAcceptPrice
      : undefined,
    bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0
      ? bestOfferAutoDeclinePrice
      : undefined,
    quantity: quantity > 1 ? quantity : undefined,
    pricingMode: quantity > 1 ? pricingMode : undefined,
    videoUrl: videoUrl ?? undefined,
    ebayVideoId: ebayVideoId ?? undefined,
    ebayVideoStatus: ebayVideoStatus ?? undefined,
  });

  const { handleSave } = useAnalyzeSave({
    userId: user?.id,
    imageUrls,
    addDraft,
    buildDraftPayload,
    onSaved: () => navigate("/drafts"),
  });

  const {
    selectedSuggestedCategory,
    hasSelectedCategoryInSuggestions,
    confirmCustomCategoryInput,
    cancelCustomCategoryMode,
    handleCategorySelectChange,
    handleCategoryDialogConfirm,
    handleCategoryDialogCancel,
  } = useAnalyzeCategorySelection({
    ebayCategoryId,
    suggestedCategories,
    customCategoryInput,
    setCustomCategoryInput,
    setPendingCategoryId,
    setShowCategoryConfirm,
    setIsCustomCategoryMode,
    setEbayCategoryId,
  });

  const { downloadLabel, handleExport } = useAnalyzeExport({
    exportPlatform,
    exportFormat,
    title,
    description,
    priceMin,
    priceMax,
    imageUrls,
    ebayCategoryId,
    itemSpecifics,
    condition,
    selectedPolicies,
    recordUsage,
  });

  const { ebayTokenForPolicies } = useAnalyzePolicyToken({
    generated,
    userId: user?.id,
    loadPolicyToken,
  });

  // Auto-trigger AI analysis on mount — skip the redundant "Generate Listing" step
  useEffect(() => { handleGenerate(); }, []); // mount-only intentional

  if (imageUrls.length === 0) {
    navigate("/home");
    return null;
  }

  // Filter out empty item specifics for display
  const displaySpecifics = Object.entries(itemSpecifics).filter(([, v]) => v && v.trim() !== "");

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-foreground">Analyze Item</h1>
        <span className="ml-auto text-xs text-muted-foreground">{imageUrls.length} photo{imageUrls.length !== 1 && "s"}</span>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto space-y-4">
        {/* Image carousel */}
        <div className="relative rounded-xl overflow-hidden border border-border aspect-square bg-secondary">
          <img src={imageUrls[activePhoto]} alt={`Item photo ${activePhoto + 1}`} className="w-full h-full object-cover" />
          {imageUrls.length > 1 && (
            <>
              <button
                onClick={() => setActivePhoto((p) => (p - 1 + imageUrls.length) % imageUrls.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-background/90 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActivePhoto((p) => (p + 1) % imageUrls.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-background/90 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                {imageUrls.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePhoto(i)}
                    className={`w-2 h-2 rounded-full transition-colors ${i === activePhoto ? "bg-primary" : "bg-background/60"}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Thumbnail strip */}
        {imageUrls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {imageUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => setActivePhoto(i)}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === activePhoto ? "border-primary" : "border-border"}`}
              >
                <img src={url} alt={`Thumb ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {generating && !generated ? (
          <div className="space-y-2">
            <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary/10 text-primary font-semibold text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing {imageUrls.length} photo{imageUrls.length !== 1 && "s"} with AI...
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {usage.aiAnalysis}/{currentPlanLimits.analysisLimit} analyses used this month
            </p>
          </div>
        ) : !generated ? (
          // Analysis failed — let user retry
          <div className="space-y-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              Retry Analysis
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {usage.aiAnalysis}/{currentPlanLimits.analysisLimit} analyses used this month
              {!canAnalyze && (
                <button onClick={() => navigate("/billing")} className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5">
                  <Crown className="w-3 h-3" /> Upgrade
                </button>
              )}
            </p>
          </div>
        ) : (
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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Title</label>
                <span className="text-xs text-muted-foreground">{title.length}/80</span>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAiFooter}
                  onChange={(e) => setIncludeAiFooter(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  Append AI disclosure footer
                </span>
              </label>
              {includeAiFooter && (
                <p className="text-[10px] text-muted-foreground italic bg-muted rounded-md px-2.5 py-1.5">
                  "Listing generated by Teckstart AI Assistant. All details should be verified by the buyer."
                </p>
              )}
            </div>
            {displaySpecifics.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-primary" />
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Item Specifics</label>
                </div>
                {/* Category selector — top 3 AI suggestions + manual override */}
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
                            // Always prioritize breadcrumb, then use frontend map as fallback
                            const displayBreadcrumb = cat.breadcrumb || getEbayCategoryBreadcrumb(cat.categoryId) || cat.categoryName || `Category #${cat.categoryId}`;
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
                        onChange={(e) => setCustomCategoryInput(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            confirmCustomCategoryInput();
                          }
                        }}
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
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {displaySpecifics.map(([key, value]) => {
                    const isRequired = ebayMetadata?.requiredAspects?.includes(key);
                    const isSuggested = ebayMetadata?.suggestedAspects?.includes(key);
                    return (
                      <div key={key} className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          {key}
                          {isRequired && <span className="text-[9px] font-semibold text-red-500 uppercase tracking-wide">req</span>}
                          {isSuggested && !isRequired && <span className="text-[9px] text-primary/60 uppercase tracking-wide">opt</span>}
                        </span>
                        <input
                          value={(value as string) || ""}
                          onChange={(e) => setItemSpecifics(prev => ({ ...prev, [key]: e.target.value }))}
                          className="text-xs text-foreground text-right bg-transparent border-none focus:outline-none focus:ring-0 max-w-[55%]"
                        />
                      </div>
                    );
                  })}
                </div>
{/* Condition */}
                <div className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">Condition</span>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right"
                  >
                    {ebayMetadata?.allowedConditions && ebayMetadata.allowedConditions.length > 0
                      ? ebayMetadata.allowedConditions.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))
                      : getConditionsForCategory(ebayCategoryId || undefined, domain, getEbayCategoryBreadcrumb(ebayCategoryId) || undefined).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))
                    }
                  </select>
                </div>
              </div>
            )}

            {/* AI Suggested Grade — only relevant for coin/card domains */}
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
                      <strong>Disclaimer:</strong> This is an AI-estimated grade based on photo analysis only. It is NOT a substitute for professional grading by PCGS, NGC, or other certification services. Actual grade may differ.
                    </p>
                  </div>

                  {!gradeConfirmed ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setGradeConfirmed(true);
                          setItemSpecifics(prev => ({ ...prev, Grade: suggestedGrade }));
                          toast.success(`Grade ${suggestedGrade} applied to item specifics`);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Accept Grade
                      </button>
                      <button
                        onClick={() => {
                          setSuggestedGrade("");
                          setGradingRationale("");
                          setItemSpecifics(prev => ({ ...prev, Grade: "Ungraded" }));
                          toast("Grade dismissed — set to Ungraded");
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-secondary text-foreground text-xs font-semibold transition-all hover:bg-secondary/80 active:scale-[0.98]"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setGradeConfirmed(false);
                        setItemSpecifics(prev => ({ ...prev, Grade: "Ungraded" }));
                      }}
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
                onChange={(e) => setConsignor(e.target.value)}
                placeholder="Who does this item belong to?"
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Item Cost (COGS) */}
            <CogsInput
              cogs={cogs}
              listingPrice={listingPrice > 0 ? listingPrice : auctionStartPrice > 0 ? auctionStartPrice : (priceMin + priceMax) / 2}
              onChange={setCogs}
              disabled={!planFeatures.hasCogsTracking}
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
              onApplyPrice={(price) => {
                setListingPrice(price);
                setAuctionStartPrice(price);
              }}
            />

            {/* Listing Format + Price */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Listing Format & Price</label>
              </div>

              {/* Format selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setListingFormat("FIXED_PRICE")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                    listingFormat === "FIXED_PRICE"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  Buy It Now
                </button>
                <button
                  onClick={() => setListingFormat("AUCTION")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                    listingFormat === "AUCTION"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <Gavel className="w-3.5 h-3.5" />
                  Auction
                </button>
              </div>

              {/* Buy It Now — single price + Best Offer */}
              {listingFormat === "FIXED_PRICE" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Listing Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={listingPrice || ""}
                      placeholder="0.00"
                      onChange={(e) => setListingPrice(parseFloat(e.target.value) || 0)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  {/* Quantity — Fixed Price only */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-muted-foreground">Quantity Available</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={quantity}
                          onChange={(e) => {
                            const q = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
                            setQuantity(q);
                            if (q === 1) setPricingMode('per_item');
                          }}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                    {quantity > 1 && (
                      <div className="space-y-1 pl-1">
                        <label className="text-xs text-muted-foreground">Listing price is…</label>
                        <div className="flex gap-2">
                          {(['per_item', 'total'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setPricingMode(mode)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                                pricingMode === mode
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border bg-card text-muted-foreground hover:border-primary/40'
                              }`}
                            >
                              {mode === 'per_item' ? 'Per item' : 'Total for all'}
                            </button>
                          ))}
                        </div>
                        {pricingMode === 'total' && listingPrice > 0 && (
                          <p className="text-xs text-muted-foreground pt-0.5">
                            eBay will list at <span className="font-medium text-foreground">${(listingPrice / quantity).toFixed(2)}</span> per item
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Best Offer toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={bestOfferEnabled}
                      onChange={(e) => setBestOfferEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="text-xs text-muted-foreground">Accept Best Offers from buyers</span>
                  </label>

                  {/* Best Offer threshold prices — optional */}
                  {bestOfferEnabled && (
                    <div className="space-y-2 pl-6 border-l-2 border-primary/20">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          Auto-Accept Price ($)
                          <span className="ml-1 text-muted-foreground/60 italic">optional — auto-accept offers at or above this</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={bestOfferAutoAcceptPrice || ""}
                          placeholder="Leave blank to review manually"
                          onChange={(e) => setBestOfferAutoAcceptPrice(parseFloat(e.target.value) || 0)}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          Auto-Decline Price ($)
                          <span className="ml-1 text-muted-foreground/60 italic">optional — auto-decline offers at or below this</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={bestOfferAutoDeclinePrice || ""}
                          placeholder="Leave blank to review manually"
                          onChange={(e) => setBestOfferAutoDeclinePrice(parseFloat(e.target.value) || 0)}
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Auction — starting bid + optional Buy It Now */}
              {listingFormat === "AUCTION" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Starting Bid ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={auctionStartPrice || ""}
                      placeholder="0.00"
                      onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value) || 0)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={auctionBuyItNowEnabled}
                      onChange={(e) => setAuctionBuyItNowEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="text-xs text-muted-foreground">Add Buy It Now price to auction</span>
                  </label>
                  {auctionBuyItNowEnabled && (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Buy It Now Price ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={auctionBuyItNow || ""}
                        placeholder="0.00"
                        onChange={(e) => setAuctionBuyItNow(parseFloat(e.target.value) || 0)}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* eBay Business Policies */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">eBay Business Policies</label>
              </div>
              <EbayPolicySelector
                userToken={ebayTokenForPolicies}
                onPoliciesSelected={setSelectedPolicies}
                disabled={publishing}
              />
            </div>

            {/* Video Upload (optional) */}
            {ebayTokenForPolicies && (
              <VideoUploadInput
                title={title}
                userToken={ebayTokenForPolicies}
                onVideoReady={(id, url) => {
                  setEbayVideoId(id);
                  setVideoUrl(url);
                  setEbayVideoStatus("LIVE");
                }}
                onVideoRemoved={() => {
                  setEbayVideoId(null);
                  setVideoUrl(null);
                  setEbayVideoStatus(null);
                }}
                onStatusChange={(status) => setEbayVideoStatus(status)}
              />
            )}

            {/* Export */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-primary" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Export Listing</label>
              </div>

              {/* Platform toggle */}
              <div className="flex gap-2">
                {([["ebay_file_exchange", "eBay File Exchange"], ["facebook_marketplace", "Facebook Marketplace"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setExportPlatform(key)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                      exportPlatform === key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Format toggle */}
              <div className="flex gap-2">
                {([["csv", "CSV", Download], ["excel", "Excel (.xlsx)", FileSpreadsheet], ["google_sheets", "Google Sheets", Sheet]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setExportFormat(key)}
                    className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                      exportFormat === key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExport}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm transition-all hover:bg-secondary/80 active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                Download {downloadLabel}
              </button>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              <button
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-success text-success-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
              >
                <Save className="w-4 h-4" />
                Save Draft
              </button>

              {isOwner ? (
                <button
                  onClick={handlePublish}
                  disabled={publishing || videoIsProcessing}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                >
                  {publishing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Publish Live to eBay
                    </>
                  )}
                </button>
              ) : (
                <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted text-muted-foreground font-semibold text-sm">
                  <Lock className="w-4 h-4" />
                  Publishing restricted to account owner
                </div>
              )}
              {videoIsProcessing && (
                <p className="text-xs text-center text-amber-600">
                  <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
                  Video is processing on eBay — save as draft now and publish once it's ready.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Category Confirmation Dialog */}
      <CategoryConfirmDialog
        open={showCategoryConfirm}
        categoryId={pendingCategoryId}
        suggestedCategories={suggestedCategories}
        onConfirm={handleCategoryDialogConfirm}
        onCancel={handleCategoryDialogCancel}
      />
    </div>
  );
}