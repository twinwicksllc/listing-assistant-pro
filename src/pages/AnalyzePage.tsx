import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Send, Tag, Crown, Download, FileSpreadsheet, Sheet, ShieldCheck, AlertTriangle, Check, X as XIcon, Lock, UserCircle, DollarSign, Gavel, LockOpen, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import PricingCard from "@/components/PricingCard";
import { useDrafts } from "@/hooks/useDrafts";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics } from "@/types/listing";
import type { SelectedPolicies } from "@/types/ebay-policies";
import { listingFormSchema, type ListingFormData, getPolicyValidationErrors } from "@/types/listing-form";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { exportListing, type ExportPlatform, type ExportFormat } from "@/lib/exportCSV";
import {
  getCategorySuggestions,
  getRequiredAspects,
  validateAspects,
  type CategorySuggestion,
  type AspectRequirements,
  type ValidationResult,
} from "@/lib/ebayTaxonomy";

export default function AnalyzePage() {
  const { canAnalyze, canPublish, isPro, isUnlimited, isPaid, usage, recordUsage, isOwner, isLister, currentPlanLimits } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();

  const state = location.state as any;
  const imageUrls: string[] = state?.imageUrls ?? (state?.imageUrl ? [state.imageUrl] : []);
  const voiceNote: string = state?.voiceNote || "";
  const ebayToken = localStorage.getItem("ebay-user-token");

  // Form state
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
  const [includeAiFooter, setIncludeAiFooter] = useState(true);

  // Listing format and price — separate from AI pricing research (priceMin/priceMax
  // are read-only AI suggestions; these are what actually gets submitted to eBay)
  const [listingFormat, setListingFormat] = useState<"FIXED_PRICE" | "AUCTION">("FIXED_PRICE");
  const [listingPrice, setListingPrice] = useState(0);
  const [auctionStartPrice, setAuctionStartPrice] = useState(0);
  const [auctionBuyItNowEnabled, setAuctionBuyItNowEnabled] = useState(false);
  const [auctionBuyItNow, setAuctionBuyItNow] = useState(0);
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });

  // Category and aspect discovery state
  const [categoryId, setCategoryId] = useState<string>("");
  const [categoryName, setCategoryName] = useState<string>("");
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([]);
  const [aspects, setAspects] = useState<AspectRequirements | null>(null);
  const [aspectValidation, setAspectValidation] = useState<ValidationResult | null>(null);
  const [loadingCategory, setLoadingCategory] = useState(false);

  // Initialize React Hook Form with validation schema
  const {
    formState: { errors, isValid },
  } = useForm<ListingFormData>({
    resolver: zodResolver(listingFormSchema),
    mode: "onChange",
    defaultValues: {
      title,
      description,
      listingFormat,
      listingPrice,
      auctionStartPrice,
      auctionBuyItNowEnabled,
      auctionBuyItNow,
      ebayCategoryId,
      fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
      paymentPolicyId: selectedPolicies.paymentPolicyId,
      returnPolicyId: selectedPolicies.returnPolicyId,
    },
  });

  const AI_FOOTER = "\n\n---\nListing generated by Teckstart AI Assistant. All details should be verified by the buyer.";
  const getDescriptionWithFooter = () => includeAiFooter ? description + AI_FOOTER : description;

  // Get policy validation errors for display
  const policyValidationErrors = getPolicyValidationErrors(selectedPolicies);

  if (imageUrls.length === 0) {
    navigate("/home");
    return null;
  }

  const handleGenerate = async () => {
    if (!canAnalyze) {
      toast.error(`Monthly AI analysis limit reached (${PLANS.starter.analysisLimit}). Upgrade to Pro for unlimited.`);
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
        if (data.error.includes("limit")) {
          toast.error(data.error);
          navigate("/settings?tab=billing");
          setGenerating(false);
          return;
        }
        throw new Error(data.error);
      }

      setTitle((data.title || "").slice(0, 80));
      setDescription(data.description || "");
      setPriceMin(data.priceMin || 0);
      setPriceMax(data.priceMax || 0);
      setMetalType(data.metalType || "none");
      setMetalWeightOz(data.metalWeightOz || 0);
      setEbayCategoryId(data.ebayCategoryId || "");
      setItemSpecifics(data.itemSpecifics || {});
      setCondition(data.condition || "USED_EXCELLENT");
      setSuggestedGrade(data.suggestedGrade || "");
      setGradingRationale(data.gradingRationale || "");
      setIsSlabbed(data.isSlabbed ?? false);
      setMeltValue(data.meltValue ?? null);
      setSpotPrices(data.spotPrices ?? null);
      setGradeConfirmed(false);
      // Reset category discovery for fresh taxonomy lookup
      setCategoryId("");
      setCategoryName("");
      setAspects(null);
      setAspectValidation(null);
      setCategorySuggestions([]);
      // Pre-fill listing price with AI midpoint as a starting suggestion
      const aiMid = ((data.priceMin || 0) + (data.priceMax || data.priceMin || 0)) / 2;
      setListingPrice(parseFloat(aiMid.toFixed(2)) || 0);
      setAuctionStartPrice(parseFloat((data.priceMin || 0).toFixed(2)) || 0);
      setGenerated(true);
      await recordUsage("ai_analysis");
    } catch (err: any) {
      console.error("Analysis error:", err);
      toast.error(err.message || "Failed to analyze item. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    const success = await addDraft({
      id: crypto.randomUUID(),
      imageUrl: imageUrls[0],
      imageUrls,
      title,
      description: getDescriptionWithFooter(),
      priceMin,
      priceMax,
      createdAt: new Date(),
      ebayCategoryId,
      itemSpecifics,
      condition,
      consignor,
      listingFormat,
      listingPrice,
      auctionStartPrice,
      auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
    });
    if (success) {
      toast.success("Draft staged! Capture your next item.", {
        action: { label: "View Drafts", onClick: () => navigate("/drafts") },
      });
      navigate("/home");
    }
  };

  const handlePublish = async () => {
    if (!canPublish) {
      toast.error(`Monthly publish limit reached (${PLANS.starter.publishLimit}). Upgrade to Pro for unlimited.`);
      navigate("/billing");
      return;
    }
    // Validate that policies are selected
    if (!selectedPolicies.fulfillmentPolicyId || !selectedPolicies.paymentPolicyId || !selectedPolicies.returnPolicyId) {
      toast.error("Please select all required eBay policies before publishing", {
        description: "Shipping, Payment, and Return policies are required.",
      });
      return;
    }
    // NEW: Check category is selected
    if (!categoryId) {
      toast.error("Please discover and select a category first", {
        description: "Use the 'Discover Category' button to find the right eBay category.",
      });
      return;
    }
    // NEW: Validate aspects before publishing
    const aspectsValid = await validateItemAspects();
    if (!aspectsValid) {
      return;
    }
    setPublishing(true);
    try {
      if (!ebayToken) {
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_auth_url" },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to get auth URL");

        localStorage.setItem("pending_listing", JSON.stringify({ title, description: getDescriptionWithFooter(), listingFormat, listingPrice, auctionStartPrice, auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null, imageUrl: imageUrls[0], ebayCategoryId: categoryId, itemSpecifics, condition }));
        window.location.href = data.authUrl;
        return;
      }

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          title,
          description: getDescriptionWithFooter(),
          listingFormat,
          listingPrice,
          auctionStartPrice,
          auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
          imageUrl: imageUrls[0],
          condition,
          ebayCategoryId: categoryId,
          itemSpecifics,
          listingPolicies: {
            fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
            paymentPolicyId: selectedPolicies.paymentPolicyId,
            returnPolicyId: selectedPolicies.returnPolicyId,
          },
        },
      });

      if (error || data?.error) {
        if (data?.error?.includes("401") || data?.error?.includes("expired")) {
          localStorage.removeItem("ebay-user-token");
          toast.error("eBay session expired. Please connect again.");
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
        // Offer created but publish step failed — show offerId for debugging
        if (data?.publishFailed) {
          toast.error("Offer created but couldn't go live", {
            description: data.error,
            duration: 8000,
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
      });
      await recordUsage("ebay_publish");
      navigate("/dashboard");
    } catch (err: any) {
      console.error("Publish error:", err);
      toast.error(err.message || "Failed to publish to eBay.");
    } finally {
      setPublishing(false);
    }
  };

  // Filter out empty item specifics for display
  const displaySpecifics = Object.entries(itemSpecifics).filter(([, v]) => v && v.trim() !== "");

  const handleCategoryDiscovery = async () => {
    if (!title || !ebayToken) {
      toast.error("Title and eBay connection required");
      return;
    }

    setLoadingCategory(true);
    try {
      // Get category suggestions
      const suggestions = await getCategorySuggestions(title, ebayToken);
      
      if (suggestions.length === 0) {
        toast.error("No matching categories found. Try a different description.");
        setCategorySuggestions([]);
        setLoadingCategory(false);
        return;
      }

      setCategorySuggestions(suggestions);
      
      // Auto-select the first (most relevant) suggestion
      const selected = suggestions[0];
      setCategoryId(selected.categoryId);
      setCategoryName(selected.categoryName);

      // Fetch required aspects for this category
      const requirements = await getRequiredAspects(selected.categoryId, ebayToken);
      setAspects(requirements);

      toast.success(`Category selected: ${selected.categoryName}`);
    } catch (error) {
      console.error("Category discovery error:", error);
      const message = error instanceof Error ? error.message : "Failed to discover category";
      toast.error(message);
    } finally {
      setLoadingCategory(false);
    }
  };

  const validateItemAspects = async () => {
    if (!categoryId || !ebayToken) {
      toast.error("Category not selected");
      return false;
    }

    try {
      // Build provided aspects from current form state
      const provided: Record<string, string[]> = {};
      
      // Add any filled-in specifics from itemSpecifics
      if (itemSpecifics) {
        for (const [key, value] of Object.entries(itemSpecifics)) {
          if (value && value.trim()) {
            provided[key] = [value];
          }
        }
      }

      // Validate
      const result = await validateAspects(categoryId, provided, ebayToken);
      setAspectValidation(result);

      if (!result.isValid) {
        const errors = [
          ...result.missingRequired.map(name => `Missing required: ${name}`),
          ...result.invalidValues.map(
            inv => `${inv.aspectName}: "${inv.providedValue}" not in allowed values`
          ),
        ];
        toast.error(`Validation failed:\n${errors.join("\n")}`);
        return false;
      }

      if (result.missingSuggested.length > 0) {
        toast.info(
          `Consider filling in: ${result.missingSuggested.join(", ")}`
        );
      }

      toast.success("All required aspects valid!");
      return true;
    } catch (error) {
      console.error("Aspect validation error:", error);
      const message = error instanceof Error ? error.message : "Validation failed";
      toast.error(message);
      return false;
    }
  };

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

        {!generated ? (
          <div className="space-y-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing {imageUrls.length} photo{imageUrls.length !== 1 && "s"} with AI...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Listing
                </>
              )}
            </button>
            {!isUnlimited && (
              <p className="text-center text-xs text-muted-foreground">
                {usage.aiAnalysis}/{currentPlanLimits.analysisLimit === Infinity ? "∞" : currentPlanLimits.analysisLimit} analyses used this month
                {!canAnalyze && (
                  <button onClick={() => navigate("/billing")} className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5">
                    <Crown className="w-3 h-3" /> Upgrade
                  </button>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Validation Error Summary */}
            {generated && !isValid && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3.5 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-destructive">
                      {Object.keys(errors).length + Object.keys(policyValidationErrors).length} field{Object.keys(errors).length + Object.keys(policyValidationErrors).length !== 1 ? "s" : ""} need attention
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {errors.title && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {errors.title.message}
                        </li>
                      )}
                      {errors.description && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {errors.description.message}
                        </li>
                      )}
                      {errors.listingPrice && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {errors.listingPrice.message}
                        </li>
                      )}
                      {errors.auctionStartPrice && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {errors.auctionStartPrice.message}
                        </li>
                      )}
                      {errors.auctionBuyItNow && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {errors.auctionBuyItNow.message}
                        </li>
                      )}
                      {policyValidationErrors.fulfillmentPolicyId && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {policyValidationErrors.fulfillmentPolicyId}
                        </li>
                      )}
                      {policyValidationErrors.paymentPolicyId && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {policyValidationErrors.paymentPolicyId}
                        </li>
                      )}
                      {policyValidationErrors.returnPolicyId && (
                        <li className="text-xs text-destructive flex items-center gap-1">
                          • {policyValidationErrors.returnPolicyId}
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className={`text-xs font-medium text-muted-foreground uppercase tracking-wide ${
                  errors.title ? "text-destructive" : ""
                }`}>
                  eBay Title
                  {errors.title && <span className="text-destructive ml-1">*</span>}
                </label>
                <span className="text-xs text-muted-foreground">{title.length}/80</span>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors ${
                  errors.title
                    ? "border-destructive focus:ring-destructive/50"
                    : "border-border focus:ring-ring"
                }`}
              />
              {errors.title && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={`text-xs font-medium text-muted-foreground uppercase tracking-wide ${
                errors.description ? "text-destructive" : ""
              }`}>
                Item Description
                {errors.description && <span className="text-destructive ml-1">*</span>}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 resize-none transition-colors ${
                  errors.description
                    ? "border-destructive focus:ring-destructive/50"
                    : "border-border focus:ring-ring"
                }`}
              />
              {errors.description && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {errors.description.message}
                </p>
              )}
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
                  {ebayCategoryId && (
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Cat: {ebayCategoryId}
                    </span>
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
                    <option value="NEW">New</option>
                    <option value="LIKE_NEW">Like New</option>
                    <option value="USED_EXCELLENT">Used - Excellent</option>
                    <option value="USED_VERY_GOOD">Used - Very Good</option>
                    <option value="USED_GOOD">Used - Good</option>
                    <option value="USED_ACCEPTABLE">Used - Acceptable</option>
                  </select>
                </div>
              </div>
            )}

            {/* AI Suggested Grade */}
            {suggestedGrade && !isSlabbed && (
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

            {/* eBay Category Discovery */}
            {generated && (
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-primary" />
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    eBay Category Discovery
                  </label>
                </div>

                {!categoryId ? (
                  <button
                    onClick={handleCategoryDiscovery}
                    disabled={loadingCategory || !title}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-foreground text-xs font-medium transition-all hover:bg-secondary/80 active:scale-[0.98] disabled:opacity-60"
                  >
                    {loadingCategory ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Discovering category...
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        Discover Category
                      </>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-card border border-border rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Selected Category</p>
                      <p className="text-sm font-semibold text-foreground">{categoryName}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">ID: {categoryId}</p>
                    </div>

                    {aspects && (
                      <div className="bg-muted/40 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">
                          Required Specifics ({aspects.required.length})
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {aspects.required.map((aspect) => (
                            <div
                              key={aspect.name}
                              className="text-[10px] text-muted-foreground bg-card rounded px-2 py-1"
                            >
                              {aspect.name}
                              {aspect.allowedValues && (
                                <span className="block text-[9px] text-primary/70">
                                  {aspect.allowedValues.length} options
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setCategoryId("");
                        setCategoryName("");
                        setAspects(null);
                        setAspectValidation(null);
                        setCategorySuggestions([]);
                      }}
                      className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    >
                      Change Category
                    </button>
                  </div>
                )}

                {categorySuggestions.length > 1 && categoryId && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Other suggestions ({categorySuggestions.length - 1})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {categorySuggestions.slice(1).map((cat) => (
                        <button
                          key={cat.categoryId}
                          onClick={async () => {
                            setCategoryId(cat.categoryId);
                            setCategoryName(cat.categoryName);
                            const reqs = await getRequiredAspects(cat.categoryId, ebayToken!);
                            setAspects(reqs);
                            toast.success(`Switched to ${cat.categoryName}`);
                          }}
                          className="block text-left w-full text-primary hover:underline py-1"
                        >
                          {cat.categoryName}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
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

            {/* Pricing */}
            <PricingCard priceMin={priceMin} priceMax={priceMax} searchQuery={title} metalType={metalType} metalWeightOz={metalWeightOz} initialMeltValue={meltValue} initialSpotPrices={spotPrices} />

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

              {/* Buy It Now — single price */}
              {listingFormat === "FIXED_PRICE" && (
                <div className="space-y-1">
                  <label className={`text-xs text-muted-foreground ${
                    errors.listingPrice ? "text-destructive" : ""
                  }`}>
                    Listing Price ($)
                    {errors.listingPrice && <span className="text-destructive ml-1">*</span>}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={listingPrice || ""}
                    placeholder="0.00"
                    onChange={(e) => setListingPrice(parseFloat(e.target.value) || 0)}
                    className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors ${
                      errors.listingPrice
                        ? "border-destructive focus:ring-destructive/50"
                        : "border-border focus:ring-ring"
                    }`}
                  />
                  {errors.listingPrice && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {errors.listingPrice.message}
                    </p>
                  )}
                </div>
              )}

              {/* Auction — starting bid + optional Buy It Now */}
              {listingFormat === "AUCTION" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className={`text-xs text-muted-foreground ${
                      errors.auctionStartPrice ? "text-destructive" : ""
                    }`}>
                      Starting Bid ($)
                      {errors.auctionStartPrice && <span className="text-destructive ml-1">*</span>}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={auctionStartPrice || ""}
                      placeholder="0.00"
                      onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value) || 0)}
                      className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors ${
                        errors.auctionStartPrice
                          ? "border-destructive focus:ring-destructive/50"
                          : "border-border focus:ring-ring"
                      }`}
                    />
                    {errors.auctionStartPrice && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        {errors.auctionStartPrice.message}
                      </p>
                    )}
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
                      <label className={`text-xs text-muted-foreground ${
                        errors.auctionBuyItNow ? "text-destructive" : ""
                      }`}>
                        Buy It Now Price ($)
                        {errors.auctionBuyItNow && <span className="text-destructive ml-1">*</span>}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={auctionBuyItNow || ""}
                        placeholder="0.00"
                        onChange={(e) => setAuctionBuyItNow(parseFloat(e.target.value) || 0)}
                        className={`w-full bg-card border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors ${
                          errors.auctionBuyItNow
                            ? "border-destructive focus:ring-destructive/50"
                            : "border-border focus:ring-ring"
                        }`}
                      />
                      {errors.auctionBuyItNow && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          {errors.auctionBuyItNow.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                    title, description, priceMin, priceMax,
                    imageUrl: imageUrls[0],
                    ebayCategoryId, itemSpecifics, condition,
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

            {/* eBay Business Policies */}
            {ebayToken && (
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-center gap-1.5">
                  <LockOpen className="w-3.5 h-3.5 text-primary" />
                  <label className={`text-xs font-medium uppercase tracking-wide ${
                    Object.keys(policyValidationErrors).length > 0 ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    eBay Policies
                    {Object.keys(policyValidationErrors).length > 0 && <span className="text-destructive ml-1">*</span>}
                  </label>
                </div>
                <EbayPolicySelector
                  userToken={ebayToken}
                  onPoliciesSelected={setSelectedPolicies}
                  showDetails={false}
                  disabled={publishing}
                  policyErrors={policyValidationErrors}
                />
              </div>
            )}

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
                  disabled={publishing || !isValid || !categoryId}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                  title={
                    !isValid
                      ? "Please fill in all required fields correctly"
                      : !categoryId
                      ? "Discover and select a category first"
                      : "Publish listing to eBay"
                  }
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
    </div>
  );
}