import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2, Crown } from "lucide-react";
import CategoryConfirmDialog from "@/components/CategoryConfirmDialog";
import { useDrafts } from "@/hooks/useDrafts";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics, CoinConditionDetail } from "@/types/listing";
import { isCoinConditionDetailComplete, isCoinConditionDetailRequired } from "@/types/listing";
import { useAuth } from "@/contexts/AuthContext";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import type { SelectedPolicies } from "@/types/ebay-policies";
import { useAnalyzePublish } from "@/hooks/useAnalyzePublish";
import { useAnalyzeGeneration } from "@/hooks/useAnalyzeGeneration";
import { useAnalyzeSave } from "@/hooks/useAnalyzeSave";
import { useAnalyzeCategorySelection } from "@/hooks/useAnalyzeCategorySelection";
import { useAnalyzeExport } from "@/hooks/useAnalyzeExport";
import { useAnalyzePolicyToken } from "@/hooks/useAnalyzePolicyToken";
import { useAnalyzePublishPayload } from "@/hooks/useAnalyzePublishPayload";
import { useAnalyzeExportPreferences } from "@/hooks/useAnalyzeExportPreferences";
import { useAnalyzeImageCarousel } from "@/hooks/useAnalyzeImageCarousel";
import { useAnalyzePricingControls } from "@/hooks/useAnalyzePricingControls";
import { useAnalyzeVideoHandlers } from "@/hooks/useAnalyzeVideoHandlers";
import { useAnalyzeBestOfferControls } from "@/hooks/useAnalyzeBestOfferControls";
import { useAnalyzeConditionOptions } from "@/hooks/useAnalyzeConditionOptions";
import { useAnalyzeGradeControls } from "@/hooks/useAnalyzeGradeControls";
import { useAnalyzeListingFieldHandlers } from "@/hooks/useAnalyzeListingFieldHandlers";
import { useVideoFrameExtraction } from "@/hooks/useVideoFrameExtraction";
import { useAnalyzeCategoryAspects } from "@/hooks/useAnalyzeCategoryAspects";

// Sub-components
import { VideoOnlyView } from "@/components/analyze/VideoOnlyView";
import { ImageCarousel } from "@/components/analyze/ImageCarousel";
import { ListingFields } from "@/components/analyze/ListingFields";
import { ListingFormatPrice } from "@/components/analyze/ListingFormatPrice";
import { PolicyAndVideo } from "@/components/analyze/PolicyAndVideo";
import { ExportSection } from "@/components/analyze/ExportSection";
import { ActionButtons } from "@/components/analyze/ActionButtons";


// Sanitise AI responses that occasionally return HTML tags instead of markdown
function htmlToPlainMarkdown(text: string): string {
  if (!text) return text;
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<ul>/gi, "")
    .replace(/<\/ul>/gi, "")
    .replace(/<li>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<h[1-3]>(.*?)<\/h[1-3]>/gi, "**$1**\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function AnalyzePage() {
  const { canAnalyze, canPublish, usage, recordUsage, isOwner, currentPlanLimits, planFeatures, currentPlan, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();

  const state = location.state as any;
  const imageUrls: string[] = state?.imageUrls ?? (state?.imageUrl ? [state.imageUrl] : []);
  const videoOnlyMode = !!state?.videoOnly && imageUrls.length === 0;
  const selectedVideoFile = state?.selectedVideoFile instanceof File ? state.selectedVideoFile : undefined;
  const voiceNote: string = state?.voiceNote || "";

  const [generated, setGenerated] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const { activePhoto, selectPhoto, goToNextPhoto, goToPreviousPhoto } =
    useAnalyzeImageCarousel(imageUrls.length);
  const [metalType, setMetalType] = useState<string>("none");
  const [metalWeightOz, setMetalWeightOz] = useState<number>(0);
  const [ebayCategoryId, setEbayCategoryId] = useState<string>("");
  const [suggestedCategories, setSuggestedCategories] = useState<Array<{ categoryId: string; categoryName: string; reason: string; breadcrumb?: string }>>([]);
  const [itemSpecifics, setItemSpecifics] = useState<ItemSpecifics>({});
  const [condition, setCondition] = useState<string>("USED_EXCELLENT");
  const { exportPlatform, exportFormat, setExportPlatform, setExportFormat } =
    useAnalyzeExportPreferences();
  const [suggestedGrade, setSuggestedGrade] = useState<string>("");
  const [gradingRationale, setGradingRationale] = useState<string>("");
  const [isSlabbed, setIsSlabbed] = useState(false);
  const [gradeConfirmed, setGradeConfirmed] = useState(false);
  const [coinConditionDetail, setCoinConditionDetail] = useState<CoinConditionDetail | null>(null);
  const [meltValue, setMeltValue] = useState<number | null>(null);
  const [spotPrices, setSpotPrices] = useState<{ gold: number; silver: number; platinum: number } | null>(null);
  const [consignor, setConsignor] = useState("");
  const [cogs, setCogs] = useState<number | undefined>(undefined);
  const [includeAiFooter, setIncludeAiFooter] = useState(true);
  const [showCategoryConfirm, setShowCategoryConfirm] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string>("");
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
  const [domain, setDomain] = useState<string>("general");
  const [ebayMetadata, setEbayMetadata] = useState<{
    requiredAspects: string[];
    suggestedAspects: string[];
    allowedConditions: string[];
  } | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<{
    tier: string;
    creditsUsed: number;
    creditsRemaining: number;
    creditsResetAt: string;
  } | null>(null);
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });
  const [listingFormat, setListingFormat] = useState<"FIXED_PRICE" | "AUCTION">("FIXED_PRICE");
  const [listingPrice, setListingPrice] = useState(0);
  const [auctionStartPrice, setAuctionStartPrice] = useState(0);
  const [auctionBuyItNowEnabled, setAuctionBuyItNowEnabled] = useState(false);
  const [auctionBuyItNow, setAuctionBuyItNow] = useState(0);
  const [bestOfferEnabled, setBestOfferEnabled] = useState(false);
  const [bestOfferAutoAcceptPrice, setBestOfferAutoAcceptPrice] = useState<number>(0);
  const [bestOfferAutoDeclinePrice, setBestOfferAutoDeclinePrice] = useState<number>(0);
  const [quantity, setQuantity] = useState(1);
  const [pricingMode, setPricingMode] = useState<"per_item" | "total">("per_item");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [ebayVideoId, setEbayVideoId] = useState<string | null>(null);
  const [ebayVideoStatus, setEbayVideoStatus] = useState<string | null>(null);
  const videoIsProcessing = !!ebayVideoId && ebayVideoStatus !== "LIVE" && ebayVideoStatus !== "FAILED";

  const AI_FOOTER = "\n\n---\nListing generated by Teckstart AI Assistant. All details should be verified by the buyer.";
  const getDescriptionWithFooter = () => (includeAiFooter ? description + AI_FOOTER : description);
  const categoryBreadcrumb = getEbayCategoryBreadcrumb(ebayCategoryId) || undefined;
  const coinConditionDetailRequired = isCoinConditionDetailRequired(ebayCategoryId, domain, categoryBreadcrumb);
  const coinConditionDetailComplete = isCoinConditionDetailComplete(coinConditionDetail);

  // ── Hooks ──────────────────────────────────────────────────────────────────────────

  const {
    extractingFrames,
    extractedFrames,
    extractedFrameDataUrls,
    extractFramesMessage,
    extractFramesErrorCode,
    handleExtractFrames,
    handleExtractFramesFallback,
    handleAnalyzeExtractedFrames,
  } = useVideoFrameExtraction({ videoUrl, voiceNote });

  const { buildPublishPayload } = useAnalyzePublishPayload({
    title,
    descriptionWithFooter: getDescriptionWithFooter(),
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNowEnabled,
    auctionBuyItNow,
    condition,
    ebayCategoryId,
    itemSpecifics,
    coinConditionDetail,
    selectedPolicies,
    bestOfferEnabled,
    bestOfferAutoAcceptPrice,
    bestOfferAutoDeclinePrice,
    quantity,
    pricingMode,
    ebayVideoId,
    ebayVideoStatus,
  });

  const handlePublishSuccess = async (data: any) => {
    await recordUsage("ebay_publish");
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
    coinConditionDetailRequired,
    coinConditionDetailComplete,
    buildPublishPayload,
    onRequireBilling: () => navigate("/billing"),
    onPublishSuccess: handlePublishSuccess,
  });

  const handleAnalyzeSuccess = (data: any) => {
    const nextCoinConditionDetail = data.coinConditionDetail ?? null;
    if (data._meta) setAnalysisMeta(data._meta);
    if (data._ebayMetadata) {
      setEbayMetadata(data._ebayMetadata);
    } else {
      setEbayMetadata(null);
    }
    setTitle((data.title || "").slice(0, 80));
    setDescription(htmlToPlainMarkdown(data.description || ""));
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
    setIsSlabbed(nextCoinConditionDetail?.type === "graded" ? true : (data.isSlabbed ?? false));
    setCoinConditionDetail(nextCoinConditionDetail);
    setMeltValue(data.meltValue ?? null);
    setSpotPrices(data.spotPrices ?? null);
    setGradeConfirmed(false);
    setDomain(data.domain || "general");
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
    listingPrice:
      listingPrice > 0 ? listingPrice : auctionStartPrice > 0 ? auctionStartPrice : parseFloat(((priceMin + priceMax) / 2).toFixed(2)),
    listingFormat,
    createdAt: new Date(),
    ebayCategoryId,
    ebayCategoryBreadcrumb: categoryBreadcrumb,
    itemSpecifics,
    coinConditionDetail,
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
    bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
    bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
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
    updateCustomCategoryInput,
    handleCustomCategoryInputKeyDown,
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
    setDomain,
    setItemSpecifics,
    setCoinConditionDetail,
    setCondition,
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

  const {
    listingPriceForCogs,
    applyRecommendedPrice,
    selectFixedPriceFormat,
    selectAuctionFormat,
    updateListingPriceFromInput,
    updateAuctionStartPriceFromInput,
    updateQuantityFromInput,
    selectPricingMode,
    toggleAuctionBuyItNow,
    updateAuctionBuyItNowFromInput,
  } = useAnalyzePricingControls({
    listingPrice,
    auctionStartPrice,
    priceMin,
    priceMax,
    setListingPrice,
    setAuctionStartPrice,
    setListingFormat,
    setQuantity,
    setPricingMode,
    setAuctionBuyItNowEnabled,
    setAuctionBuyItNow,
  });

  const { onVideoReady, onVideoRemoved, onVideoStatusChange } = useAnalyzeVideoHandlers({
    setEbayVideoId,
    setVideoUrl,
    setEbayVideoStatus,
  });

  const { toggleBestOffer, updateBestOfferAutoAccept, updateBestOfferAutoDecline } =
    useAnalyzeBestOfferControls({
      setBestOfferEnabled,
      setBestOfferAutoAcceptPrice,
      setBestOfferAutoDeclinePrice,
    });

  const { conditionOptions, updateCondition } = useAnalyzeConditionOptions({
    ebayMetadata,
    ebayCategoryId,
    domain,
    setCondition,
  });

  const { acceptSuggestedGrade, dismissSuggestedGrade, undoGradeConfirmation } =
    useAnalyzeGradeControls({
      setGradeConfirmed,
      setItemSpecifics,
      setSuggestedGrade,
      setGradingRationale,
    });

  const { updateTitle, updateDescription, toggleAiFooter, updateConsignor, updateItemSpecificValue } =
    useAnalyzeListingFieldHandlers({
      setTitle,
      setDescription,
      setIncludeAiFooter,
      setConsignor,
      setItemSpecifics,
    });

  const setCoinConditionDetailType = (type: "graded" | "raw") => {
    if (type === "graded") {
      const gradedDetail = coinConditionDetail?.type === "graded"
        ? coinConditionDetail
        : { type: "graded" as const, gradingCompany: "PCGS" as const, grade: "", certificationNumber: undefined };
      setCoinConditionDetail(gradedDetail);
      setIsSlabbed(true);
      return;
    }

    const rawDetail = coinConditionDetail?.type === "raw"
      ? coinConditionDetail
      : { type: "raw" as const, rawCondition: "Uncirculated" as const };
    setCoinConditionDetail(rawDetail);
    setIsSlabbed(false);
  };

  const updateCoinConditionDetail = (detail: CoinConditionDetail) => {
    setCoinConditionDetail(detail);
    setIsSlabbed(detail.type === "graded");
  };

  // Auto-trigger AI analysis on mount
  useEffect(() => {
    if (imageUrls.length > 0) {
      handleGenerate();
    }
  }, []); // mount-only intentional

  // Fetch + seed eBay aspects when the category changes after initial analysis
  // (e.g. user overrides AI category). Seeds itemSpecifics with empty rows for
  // required/suggested aspects so they appear as editable fields in the UI.
  useAnalyzeCategoryAspects({
    ebayCategoryId,
    generated,
    itemSpecifics,
    setItemSpecifics,
    setEbayMetadata,
    currentEbayMetadata: ebayMetadata,
  });

  // ── Guards ─────────────────────────────────────────────────────────────────────────

  if (imageUrls.length === 0 && !videoOnlyMode) {
    navigate("/home");
    return null;
  }

  // Show all item specifics entries — including empty ones seeded from eBay aspects
  // so the user can see and fill in required/suggested fields for the new category.
  // We only exclude the internal _coinConditionDetail key (prefixed with _).
  const displaySpecifics = Object.entries(itemSpecifics).filter(
    ([k, v]) => !k.startsWith("_") && (v !== null && v !== undefined),
  );

  // ── Video-only early return ──────────────────────────────────────────────────────────────

  if (videoOnlyMode) {
    return (
      <VideoOnlyView
        ebayTokenForPolicies={ebayTokenForPolicies}
        title={title}
        initialVideoFile={selectedVideoFile}
        videoIsProcessing={videoIsProcessing}
        videoUrl={videoUrl}
        extractingFrames={extractingFrames}
        extractedFrames={extractedFrames}
        extractedFrameDataUrls={extractedFrameDataUrls}
        extractFramesMessage={extractFramesMessage}
        extractFramesErrorCode={extractFramesErrorCode}
        onVideoReady={onVideoReady}
        onVideoRemoved={onVideoRemoved}
        onVideoStatusChange={onVideoStatusChange}
        onExtractFrames={handleExtractFrames}
        onExtractFramesFallback={handleExtractFramesFallback}
        onAnalyzeExtractedFrames={handleAnalyzeExtractedFrames}
        onBack={() => navigate("/home")}
      />
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate("/home")}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-foreground">Analyze Item</h1>
        <span className="ml-auto text-xs text-muted-foreground">
          {imageUrls.length} photo{imageUrls.length !== 1 && "s"}
        </span>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto space-y-4">
        <ImageCarousel
          imageUrls={imageUrls}
          activePhoto={activePhoto}
          onSelectPhoto={selectPhoto}
          onGoToPreviousPhoto={goToPreviousPhoto}
          onGoToNextPhoto={goToNextPhoto}
        />

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
                <button
                  onClick={() => navigate("/billing")}
                  className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  <Crown className="w-3 h-3" /> Upgrade
                </button>
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ListingFields
              analysisMeta={analysisMeta}
              currentPlan={currentPlan}
              title={title}
              updateTitle={updateTitle}
              description={description}
              updateDescription={updateDescription}
              includeAiFooter={includeAiFooter}
              toggleAiFooter={toggleAiFooter}
              displaySpecifics={displaySpecifics}
              ebayMetadata={ebayMetadata}
              updateItemSpecificValue={updateItemSpecificValue}
              ebayCategoryId={ebayCategoryId}
              suggestedCategories={suggestedCategories}
              isCustomCategoryMode={isCustomCategoryMode}
              customCategoryInput={customCategoryInput}
              hasSelectedCategoryInSuggestions={hasSelectedCategoryInSuggestions}
              selectedSuggestedCategory={selectedSuggestedCategory}
              handleCategorySelectChange={handleCategorySelectChange}
              updateCustomCategoryInput={updateCustomCategoryInput}
              handleCustomCategoryInputKeyDown={handleCustomCategoryInputKeyDown}
              confirmCustomCategoryInput={confirmCustomCategoryInput}
              cancelCustomCategoryMode={cancelCustomCategoryMode}
              condition={condition}
              conditionOptions={conditionOptions}
              updateCondition={updateCondition}
              coinConditionDetail={coinConditionDetail}
              coinConditionDetailRequired={coinConditionDetailRequired}
              updateCoinConditionDetail={updateCoinConditionDetail}
              setCoinConditionDetailType={setCoinConditionDetailType}
              suggestedGrade={suggestedGrade}
              isSlabbed={isSlabbed}
              domain={domain}
              gradeConfirmed={gradeConfirmed}
              gradingRationale={gradingRationale}
              acceptSuggestedGrade={acceptSuggestedGrade}
              dismissSuggestedGrade={dismissSuggestedGrade}
              undoGradeConfirmation={undoGradeConfirmation}
              consignor={consignor}
              updateConsignor={updateConsignor}
              cogs={cogs}
              setCogs={setCogs}
              planFeatures={planFeatures}
              listingPriceForCogs={listingPriceForCogs}
              priceMin={priceMin}
              priceMax={priceMax}
              metalType={metalType}
              metalWeightOz={metalWeightOz}
              meltValue={meltValue}
              spotPrices={spotPrices}
              applyRecommendedPrice={applyRecommendedPrice}
              onNavigateToBilling={() => navigate("/billing")}
            />

            <ListingFormatPrice
              listingFormat={listingFormat}
              onSelectFixedPrice={selectFixedPriceFormat}
              onSelectAuction={selectAuctionFormat}
              listingPrice={listingPrice}
              onUpdateListingPrice={updateListingPriceFromInput}
              quantity={quantity}
              onUpdateQuantity={updateQuantityFromInput}
              pricingMode={pricingMode}
              onSelectPricingMode={selectPricingMode}
              bestOfferEnabled={bestOfferEnabled}
              onToggleBestOffer={toggleBestOffer}
              bestOfferAutoAcceptPrice={bestOfferAutoAcceptPrice}
              onUpdateBestOfferAutoAccept={updateBestOfferAutoAccept}
              bestOfferAutoDeclinePrice={bestOfferAutoDeclinePrice}
              onUpdateBestOfferAutoDecline={updateBestOfferAutoDecline}
              auctionStartPrice={auctionStartPrice}
              onUpdateAuctionStartPrice={updateAuctionStartPriceFromInput}
              auctionBuyItNowEnabled={auctionBuyItNowEnabled}
              onToggleAuctionBuyItNow={toggleAuctionBuyItNow}
              auctionBuyItNow={auctionBuyItNow}
              onUpdateAuctionBuyItNow={updateAuctionBuyItNowFromInput}
            />

            <PolicyAndVideo
              ebayTokenForPolicies={ebayTokenForPolicies}
              title={title}
              publishing={publishing}
              onPoliciesSelected={setSelectedPolicies}
              onVideoReady={onVideoReady}
              onVideoRemoved={onVideoRemoved}
              onVideoStatusChange={onVideoStatusChange}
            />

            <ExportSection
              exportPlatform={exportPlatform}
              onSetExportPlatform={setExportPlatform}
              exportFormat={exportFormat}
              onSetExportFormat={setExportFormat}
              downloadLabel={downloadLabel}
              onExport={handleExport}
            />

            <ActionButtons
              onSave={handleSave}
              onPublish={handlePublish}
              publishing={publishing}
              videoIsProcessing={videoIsProcessing}
              isOwner={isOwner}
            />
          </div>
        )}
      </div>

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
