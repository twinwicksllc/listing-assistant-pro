import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Send, Tag, Crown, Download, FileSpreadsheet, Sheet, ShieldCheck, AlertTriangle, Check, X as XIcon, Lock, UserCircle, DollarSign, Gavel, ShoppingCart } from "lucide-react";
import PricingCard from "@/components/PricingCard";
import PriceRecommenderCard from "@/components/PriceRecommenderCard";
import CogsInput from "@/components/CogsInput";
import CategoryConfirmDialog from "@/components/CategoryConfirmDialog";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics, ListingFormat } from "@/types/listing";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { exportListing, type ExportPlatform, type ExportFormat } from "@/lib/exportCSV";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import { uploadListingImages, uploadListingImage } from "@/lib/imageUpload";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import type { SelectedPolicies } from "@/types/ebay-policies";

export default function AnalyzePage() {
  const { canAnalyze, canPublish, isPro, isShop, isUnlimited, isPaid, usage, recordUsage, isOwner, isLister, currentPlanLimits, planFeatures, currentPlan, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();

  const state = location.state as any;
  const imageUrls: string[] = state?.imageUrls ?? (state?.imageUrl ? [state.imageUrl] : []);
  const voiceNote: string = state?.voiceNote || "";

  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [activePhoto, setActivePhoto] = useState(0);
  const [publishing, setPublishing] = useState(false);
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
  const [pricingNotes, setPricingNotes] = useState<string>("");
  const [spotPrices, setSpotPrices] = useState<{ gold: number; silver: number; platinum: number } | null>(null);
  const [competitorData, setCompetitorData] = useState<{
    competitorCount: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    medianPrice: number;
    fromCache: boolean;
  } | null>(null);
  const [consignor, setConsignor] = useState("");
  const [cogs, setCogs] = useState<number | undefined>(undefined);
  const [includeAiFooter, setIncludeAiFooter] = useState(true);
  const [showCategoryConfirm, setShowCategoryConfirm] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string>("");
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);

  // Domain from Pass 1 AI identification — used to conditionally show domain-specific UI
  const [domain, setDomain] = useState<string>("general");

  // Phase 2: Credit tracking metadata from analyze-item response
  const [analysisMeta, setAnalysisMeta] = useState<{
    tier: string;
    creditsUsed: number;
    creditsRemaining: number;
    creditsResetAt: string;
  } | null>(null);

  // eBay business policies — selected by the user on this page
  const [ebayTokenForPolicies, setEbayTokenForPolicies] = useState<string | null>(null);
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

  // Fetch the stored eBay token once when analysis results are shown
  // so the EbayPolicySelector can load policies without waiting for publish
  useEffect(() => {
    if (!generated || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (!cancelled) {
          setEbayTokenForPolicies(data?.token ?? localStorage.getItem("ebay-user-token"));
        }
      } catch {
        if (!cancelled) setEbayTokenForPolicies(localStorage.getItem("ebay-user-token"));
      }
    })();
    return () => { cancelled = true; };
  }, [generated, user?.id]);

  const AI_FOOTER = "\n\n---\nListing generated by Teckstart AI Assistant. All details should be verified by the buyer.";
  const getDescriptionWithFooter = () => includeAiFooter ? description + AI_FOOTER : description;

  const handleGenerate = async () => {
    if (!canAnalyze) {
      toast.error(`Monthly analysis limit reached (${currentPlanLimits.analysisLimit}). Upgrade for more listings.`);
      navigate("/billing");
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-item", {
        body: { images: imageUrls, voiceNote },
      });

      if (error) {
        if (error.status === 429) {
          toast.error("Monthly AI analysis limit reached. Upgrade to Pro or Unlimited.");
          navigate("/settings?tab=billing");
          setGenerating(false);
          return;
        }
        throw new Error(error.message || "Analysis failed");
      }
      
      if (data?.error) {
        // Starter tier without eBay account connected
        if (data.error === "ebay_account_required") {
          toast.error("Connect an eBay account to start generating listings", {
            description: "The free tier requires an active eBay connection.",
            action: {
              label: "Connect",
              onClick: () => navigate("/settings"),
            },
          });
          setGenerating(false);
          return;
        }
        if (data.error.includes("limit")) {
          toast.error(data.error);
          navigate("/settings?tab=billing");
          setGenerating(false);
          return;
        }
        throw new Error(data.error);
      }

      // Extract metadata if available
      if (data._meta) {
        setAnalysisMeta(data._meta);
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
      setCompetitorData(data.competitorData ?? null);
      setPricingNotes(data.pricingNotes || "");
      setGradeConfirmed(false);
      setDomain(data.domain || "general");
      // Pre-fill listing price with AI midpoint as a starting suggestion
      const aiMid = ((data.priceMin || 0) + (data.priceMax || data.priceMin || 0)) / 2;
      setListingPrice(parseFloat(aiMid.toFixed(2)) || 0);
      setAuctionStartPrice(parseFloat((data.priceMin || 0).toFixed(2)) || 0);
      setGenerated(true);
      // OQ-12: recordUsage removed — analyze-item edge function inserts server-side usage row
    } catch (err: unknown) {
      console.error("Analysis error:", err);
      toast.error(err.message || "Failed to analyze item. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  // Auto-trigger AI analysis on mount — skip the redundant "Generate Listing" step
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { handleGenerate(); }, []);

  if (imageUrls.length === 0) {
    navigate("/home");
    return null;
  }

  const handleSave = async () => {
    // Upload base64 images to Supabase Storage so the draft stores a public URL.
    // eBay (and other platforms) require real HTTPS URLs — data: URLs are rejected.
    let uploadedUrls = imageUrls;
    if (user?.id) {
      uploadedUrls = await uploadListingImages(imageUrls, user.id);
    }
    const success = await addDraft({
      id: crypto.randomUUID(),
      imageUrl: uploadedUrls[0],
      imageUrls: uploadedUrls,
      title,
      description: getDescriptionWithFooter(),
      priceMin,
      priceMax,
      listingPrice: listingPrice > 0 ? listingPrice : auctionStartPrice > 0 ? auctionStartPrice : parseFloat(((priceMin + priceMax) / 2).toFixed(2)),
      listingFormat: listingFormat as ListingFormat,
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
      bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
      bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
    });
    if (success) {
      toast.success("Draft saved!");
      navigate("/drafts");
    }
  };

  const handlePublish = async () => {
    if (!canPublish) {
      toast.error(`Monthly publish limit reached (${currentPlanLimits.publishLimit}). Upgrade for more listings.`);
      navigate("/billing");
      return;
    }
    setPublishing(true);
    try {
      // Token lookup order mirrors usePublishDraft:
      // 1. Server-side stored token in Supabase profiles (secure, preferred)
      // 2. localStorage fallback for backwards compatibility
      let ebayToken: string | null = null;
      let postalCode: string | null = null;
      let city: string | null = null;

      if (user?.id) {
        try {
          const { data: tokenData } = await supabase.functions.invoke("ebay-publish", {
            body: { action: "get_stored_token", userId: user.id },
          });
          if (tokenData?.token) {
            ebayToken = tokenData.token;
            postalCode = tokenData.postalCode ?? null;
            city = tokenData.city ?? null;
            console.log("AnalyzePage: retrieved stored token data", {
              hasToken: !!tokenData.token,
              postalCode,
              city,
            });
          } else {
            // Token retrieval failed, but we can still get postal_code from database
            // This happens when eBay token is expired but profile is set
            postalCode = tokenData?.postalCode ?? null;
            city = tokenData?.city ?? null;
            console.log("AnalyzePage: no token but got location data from database", {
              postalCode,
              city,
            });
          }
        } catch (e) {
          console.error("AnalyzePage: get_stored_token error", e);
          // fall through to localStorage
        }
      }
      if (!ebayToken) {
        ebayToken = localStorage.getItem("ebay-user-token");
      }

      if (!ebayToken) {
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_auth_url" },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to get auth URL");

        // Store all image URLs in pending listing so we can resume publish with full images after auth
        localStorage.setItem("pending_listing", JSON.stringify({
          title,
          description: getDescriptionWithFooter(),
          listingFormat,
          listingPrice,
          auctionStartPrice,
          auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
          imageUrls: imageUrls,
          ebayCategoryId,
          itemSpecifics,
          condition,
          postalCode: postalCode || undefined,
          city: city || undefined,
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
          paymentPolicyId: selectedPolicies.paymentPolicyId,
          returnPolicyId: selectedPolicies.returnPolicyId,
          bestOfferEnabled: bestOfferEnabled || undefined,
          bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
          bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
        }));
        window.location.href = data.authUrl;
        return;
      }

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          postalCode: postalCode || undefined,
          city: city || undefined,
          title,
          description: getDescriptionWithFooter(),
          listingFormat,
          listingPrice,
          auctionStartPrice,
          auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
          // Upload all images and pass the array to the server so the final eBay payload includes every image.
          imageUrls: user?.id ? await uploadListingImages(imageUrls, user.id) : imageUrls,
          condition,
          ebayCategoryId,
          itemSpecifics,
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId || undefined,
          paymentPolicyId: selectedPolicies.paymentPolicyId || undefined,
          returnPolicyId: selectedPolicies.returnPolicyId || undefined,
          bestOfferEnabled: bestOfferEnabled || undefined,
          bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
          bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
        },
      });

      if (error || data?.error) {
        // Only treat as session expired if it's a real auth failure (not a publish policy error).
        // publishFailed=true means the offer was created but eBay rejected it for policy reasons
        // (e.g. errorId 25019 grade policy) — those errors can contain "401" in the error body text
        // but are NOT token expiry issues. We only clear the token for true 401 auth failures.
        const isPublishPolicyError = data?.publishFailed === true;
        const isTokenExpiry = !isPublishPolicyError && (
          data?.error?.includes("401 ") ||
          data?.error === "401" ||
          (data?.error?.includes("expired") && !data?.error?.includes("code has expired")) ||
          error?.message?.includes("401")
        );
        if (isTokenExpiry) {
          // Clear stale token from both storage locations
          localStorage.removeItem("ebay-user-token");
          toast.error("eBay session expired. Please reconnect eBay in Settings.");
          return;
        }
        // Missing business policies — guide user to Seller Hub
        if (data?.missingPolicies) {
          toast.error("eBay business policies not configured", {
            description: data.error,
            action: {
              label: "Open Seller Hub",
              onClick: () => window.open("https://www.ebay.com/sh/ovw/policies", "_blank"),
            },
            duration: 10000,
          });
          return;
        }
        // Offer created but publish step failed — extract clean eBay error message
        if (data?.publishFailed) {
          // Try to extract a clean human-readable message from the raw eBay error JSON
          let publishErrMsg = data.error as string;
          try {
            // Error format: "Offer created (ID: X) but publish failed: 400 {\"errors\":[{\"message\":\"...\"}]}"
            const jsonStart = publishErrMsg.indexOf("{");
            if (jsonStart !== -1) {
              const errJson = JSON.parse(publishErrMsg.slice(jsonStart));
              const firstErr = errJson?.errors?.[0];
              if (firstErr?.message) {
                // eBay error messages can be very long HTML — truncate to first sentence
                const cleanMsg = firstErr.message.replace(/<[^>]+>/g, "").split(".")[0].trim();
                publishErrMsg = cleanMsg || publishErrMsg;
              }
            }
          } catch { /* keep raw error */ }
          toast.error("eBay rejected the listing", {
            description: publishErrMsg,
            duration: 10000,
          });
          return;
        }
        throw new Error(data?.error || error?.message || "Publish failed");
      }

      const successMsg = data.listingId
        ? `Listing published live on eBay! (ID: ${data.listingId})`
        : `Listing created on eBay (Offer ID: ${data.offerId})`;
      toast.success(successMsg, {
        description: data.affiliateUrl
          ? `Affiliate link ready — share it to earn EPN commissions.`
          : undefined,
        action: data.affiliateUrl
          ? { label: "Copy Link", onClick: () => navigator.clipboard.writeText(data.affiliateUrl) }
          : undefined,
        duration: 5000,
      });
      await recordUsage("ebay_publish");

      // Success — navigate back to capture page for the next item
      navigate("/home");
    } catch (err: unknown) {
      console.error("Publish error:", err);
      toast.error(err.message || "Failed to publish to eBay.");
    } finally {
      setPublishing(false);
    }
  };

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
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__custom__") {
                            setIsCustomCategoryMode(true);
                            setCustomCategoryInput("");
                          } else {
                            setEbayCategoryId(val);
                            setCustomCategoryInput("");
                          }
                        }}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {suggestedCategories.length > 0 ? (
                          suggestedCategories.map((cat) => (
                            <option key={cat.categoryId} value={cat.categoryId}>
                              #{cat.categoryId} — {cat.breadcrumb || cat.categoryName || getEbayCategoryBreadcrumb(cat.categoryId)}
                            </option>
                          ))
                        ) : (
                          <option value="">No category selected</option>
                        )}
                        {ebayCategoryId && !suggestedCategories.find(c => c.categoryId === ebayCategoryId) && (
                          <option value={ebayCategoryId}>
                            #{ebayCategoryId} — {getEbayCategoryBreadcrumb(ebayCategoryId) || "Custom category"}
                          </option>
                        )}
                        <option value="__custom__">✏️ Enter custom category ID...</option>
                      </select>
                      {suggestedCategories.find(c => c.categoryId === ebayCategoryId)?.reason && (
                        <p className="text-[10px] text-muted-foreground italic px-1">
                          {suggestedCategories.find(c => c.categoryId === ebayCategoryId)?.reason}
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
                            const v = customCategoryInput.trim();
                            if (v) {
                              setPendingCategoryId(v);
                              setShowCategoryConfirm(true);
                            }
                          }
                        }}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const v = customCategoryInput.trim();
                            if (v) {
                              setPendingCategoryId(v);
                              setShowCategoryConfirm(true);
                            }
                          }}
                          disabled={!customCategoryInput.trim()}
                          className="flex-1 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium transition-colors"
                        >
                          Confirm ID
                        </button>
                        <button
                          onClick={() => {
                            setIsCustomCategoryMode(false);
                            setCustomCategoryInput("");
                          }}
                          className="flex-1 py-1.5 text-xs rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-card border border-border rounded-lg divide-y divide-border">
                  {displaySpecifics.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs font-medium text-muted-foreground">{key}</span>
                      <input
                        value={value || ""}
                        onChange={(e) => setItemSpecifics(prev => ({ ...prev, [key]: e.target.value }))}
                        className="text-xs text-foreground text-right bg-transparent border-none focus:outline-none focus:ring-0 max-w-[55%]"
                      />
                    </div>
                  ))}
                </div>
                {/* Condition */}
                <div className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">Condition</span>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="text-xs text-foreground bg-transparent border-none focus:outline-none cursor-pointer text-right"
                  >
                    <option value="NEW">New / Uncirculated</option>
                    <option value="LIKE_NEW">Like New</option>
                    <option value="NEW_OTHER">New Other (without tags)</option>
                    <option value="NEW_WITH_DEFECTS">New with Defects</option>
                    <option value="USED_EXCELLENT">Used – Excellent (lightly used/circulated)</option>
                    <option value="USED_VERY_GOOD">Used – Very Good (moderate wear)</option>
                    <option value="USED_GOOD">Used – Good (heavy wear)</option>
                    <option value="USED_ACCEPTABLE">Used – Acceptable (significant wear)</option>
                    <option value="CERTIFIED_REFURBISHED">Certified Refurbished</option>
                    <option value="SELLER_REFURBISHED">Seller Refurbished</option>
                    <option value="FOR_PARTS_OR_NOT_WORKING">For Parts or Not Working</option>
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
                onClick={() => {
                  exportListing(exportPlatform, exportFormat, {
                    title,
                    description,
                    priceMin,
                    priceMax,
                    imageUrls: imageUrls,
                    ebayCategoryId,
                    itemSpecifics,
                    condition,
                    fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId ?? undefined,
                    paymentPolicyId: selectedPolicies.paymentPolicyId ?? undefined,
                    returnPolicyId: selectedPolicies.returnPolicyId ?? undefined,
                  });
                  recordUsage("export");
                  const platformLabel = exportPlatform === "ebay_file_exchange" ? "eBay" : "Facebook";
                  const formatLabel = exportFormat === "csv" ? "CSV" : exportFormat === "excel" ? "Excel" : "Google Sheets";
                  toast.success(`${platformLabel} listing exported as ${formatLabel}`);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm transition-all hover:bg-secondary/80 active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                Download {exportFormat === "csv" ? "CSV" : exportFormat === "excel" ? "Excel" : "Sheets"}
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
                  disabled={publishing}
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
            </div>
          </div>
        )}
      </div>

      {/* Category Confirmation Dialog */}
      <CategoryConfirmDialog
        open={showCategoryConfirm}
        categoryId={pendingCategoryId}
        suggestedCategories={suggestedCategories}
        onConfirm={(categoryId) => {
          setEbayCategoryId(categoryId);
          setCustomCategoryInput("");
          setShowCategoryConfirm(false);
          toast.success(`Category ${categoryId} confirmed`);
        }}
        onCancel={() => {
          setShowCategoryConfirm(false);
          setPendingCategoryId("");
          // Don't reset customCategoryInput — user might want to try a different ID
        }}
      />
    </div>
  );
}