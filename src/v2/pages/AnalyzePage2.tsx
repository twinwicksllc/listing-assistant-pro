import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Send,
  Tag, Crown, Download, FileSpreadsheet, Sheet, ShieldCheck, AlertTriangle,
  Check, X as XIcon, Lock, UserCircle, DollarSign, Gavel, ShoppingCart,
} from "lucide-react";
import PricingCard from "@/components/PricingCard";
import PriceRecommenderCard from "@/components/PriceRecommenderCard";
import CogsInput from "@/components/CogsInput";
import CategoryConfirmDialog from "@/components/CategoryConfirmDialog";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics, ListingFormat } from "@/types/listing";
import { getConditionsForCategory } from "@/types/listing";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { exportListing, type ExportPlatform, type ExportFormat } from "@/lib/exportCSV";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import { uploadListingImages } from "@/lib/imageUpload";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import type { SelectedPolicies } from "@/types/ebay-policies";
import AppShell from "@/v2/components/AppShell";
import {
  COLORS, SHADOWS, FONT,
  cardStyle, cardHeaderStyle, cardTitleStyle, cardInnerStyle,
  btnPrimaryStyle, btnOutlineStyle, btnSuccessStyle, btnDangerStyle,
  inputStyle, labelStyle, badgeStyle,
} from "@/v2/theme";

// ─── local style helpers ──────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
    backgroundAttachment: "fixed" as const,
    fontFamily: FONT,
    paddingBottom: "2rem",
  } as React.CSSProperties,

  inner: {
    maxWidth: 560,
    margin: "0 auto",
    padding: "1.25rem 1rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1.25rem",
  } as React.CSSProperties,

  header: {
    position: "sticky" as const,
    top: 0,
    zIndex: 40,
    background: "rgba(255,255,255,0.90)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: `1px solid ${COLORS.border}`,
    padding: "0.875rem 1rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  } as React.CSSProperties,

  // Image carousel
  carousel: {
    position: "relative" as const,
    borderRadius: 16,
    overflow: "hidden",
    border: `1px solid ${COLORS.border}`,
    aspectRatio: "1",
    background: "#f0f4f8",
    boxShadow: SHADOWS.card,
  } as React.CSSProperties,

  carouselBtn: {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(6px)",
    border: `1px solid ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: SHADOWS.btn,
  } as React.CSSProperties,

  thumb: (active: boolean): React.CSSProperties => ({
    flexShrink: 0,
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: "hidden",
    border: `2px solid ${active ? COLORS.brand : COLORS.border}`,
    cursor: "pointer",
    transition: "border-color 0.15s",
  }),

  // Section card
  section: {
    ...cardStyle,
  } as React.CSSProperties,

  sectionHeader: {
    ...cardHeaderStyle,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  } as React.CSSProperties,

  sectionBody: {
    padding: "1.25rem 1.5rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  } as React.CSSProperties,

  // Form field
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.375rem",
  } as React.CSSProperties,

  label: { ...labelStyle } as React.CSSProperties,

  input: {
    ...inputStyle,
  } as React.CSSProperties,

  textarea: {
    ...inputStyle,
    resize: "none" as const,
    lineHeight: 1.6,
  } as React.CSSProperties,

  charCount: {
    fontSize: "0.75rem",
    color: COLORS.textSubtle,
    textAlign: "right" as const,
  } as React.CSSProperties,

  // Format toggle pills
  toggleGroup: {
    display: "flex",
    gap: "0.5rem",
  } as React.CSSProperties,

  toggleBtn: (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.375rem",
    padding: "0.625rem 0.5rem",
    border: `1px solid ${active ? COLORS.brand : COLORS.border}`,
    borderRadius: 8,
    background: active ? `rgba(0,118,182,0.08)` : "#fff",
    color: active ? COLORS.brand : COLORS.textMuted,
    fontSize: "0.8125rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
  }),

  // Specifics table
  specificsTable: {
    ...cardInnerStyle,
    overflow: "hidden",
  } as React.CSSProperties,

  specificsRow: (last: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.625rem 0.875rem",
    borderBottom: last ? "none" : `1px solid ${COLORS.border}`,
    gap: "0.5rem",
  }),

  specificsKey: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    color: COLORS.textMuted,
    flexShrink: 0,
  } as React.CSSProperties,

  specificsVal: {
    fontSize: "0.8125rem",
    color: COLORS.textPrimary,
    textAlign: "right" as const,
    background: "transparent",
    border: "none",
    outline: "none",
    maxWidth: "55%",
    width: "55%",
  } as React.CSSProperties,

  // Inline badges
  reqBadge: {
    fontSize: "0.625rem",
    fontWeight: 700,
    color: "#dc2626",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    background: "#fff5f5",
    border: "1px solid #fca5a5",
    borderRadius: 4,
    padding: "1px 4px",
  } as React.CSSProperties,

  optBadge: {
    fontSize: "0.625rem",
    color: COLORS.brand,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    opacity: 0.7,
  } as React.CSSProperties,

  // Grade card
  gradeCard: (confirmed: boolean): React.CSSProperties => ({
    ...cardInnerStyle,
    border: `1px solid ${confirmed ? COLORS.brand : "#fbbf24"}`,
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  }),

  // Action buttons row
  actionRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.625rem",
  } as React.CSSProperties,

  btnPrimary: {
    ...btnPrimaryStyle,
    width: "100%",
    padding: "0.875rem 1.5rem",
    fontSize: "0.9375rem",
  } as React.CSSProperties,

  btnSuccess: {
    ...btnSuccessStyle,
    width: "100%",
    padding: "0.875rem 1.5rem",
    fontSize: "0.9375rem",
  } as React.CSSProperties,

  btnOutline: {
    ...btnOutlineStyle,
    width: "100%",
    padding: "0.75rem 1.5rem",
  } as React.CSSProperties,

  btnDisabled: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.875rem 1.5rem",
    background: "#f0f4f8",
    color: COLORS.textMuted,
    fontSize: "0.9375rem",
    fontWeight: 600,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    cursor: "not-allowed",
  } as React.CSSProperties,

  // Loading state
  loadingBox: {
    ...cardStyle,
    padding: "2rem 1.5rem",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "0.75rem",
    textAlign: "center" as const,
  } as React.CSSProperties,

  // Info / tip box
  infoBox: (color: string = COLORS.brand): React.CSSProperties => ({
    background: color === "amber" ? "rgba(245,158,11,0.06)" : "rgba(0,118,182,0.06)",
    border: `1px solid ${color === "amber" ? "rgba(245,158,11,0.25)" : "rgba(0,118,182,0.20)"}`,
    borderLeft: `3px solid ${color === "amber" ? COLORS.amber : COLORS.brand}`,
    borderRadius: 8,
    padding: "0.75rem 1rem",
  }),

  // Best offer indent section
  indentSection: {
    paddingLeft: "1rem",
    borderLeft: `2px solid rgba(0,118,182,0.20)`,
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  } as React.CSSProperties,

  // Select
  select: {
    ...inputStyle,
    cursor: "pointer",
  } as React.CSSProperties,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function AnalyzePage2() {
  const {
    canAnalyze, canPublish, isPro, isShop, isUnlimited, isPaid,
    usage, recordUsage, isOwner, isLister, currentPlanLimits,
    planFeatures, currentPlan, user,
  } = useAuth();
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
    competitorCount: number; avgPrice: number; minPrice: number;
    maxPrice: number; medianPrice: number; fromCache: boolean;
  } | null>(null);
  const [consignor, setConsignor] = useState("");
  const [cogs, setCogs] = useState<number | undefined>(undefined);
  const [includeAiFooter, setIncludeAiFooter] = useState(true);
  const [showCategoryConfirm, setShowCategoryConfirm] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string>("");
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
  const [domain, setDomain] = useState<string>("general");
  const [ebayMetadata, setEbayMetadata] = useState<{
    requiredAspects: string[]; suggestedAspects: string[]; allowedConditions: string[];
  } | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<{
    tier: string; creditsUsed: number; creditsRemaining: number; creditsResetAt: string;
  } | null>(null);
  const [ebayTokenForPolicies, setEbayTokenForPolicies] = useState<string | null>(null);
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null,
  });
  const [listingFormat, setListingFormat] = useState<"FIXED_PRICE" | "AUCTION">("FIXED_PRICE");
  const [listingPrice, setListingPrice] = useState(0);
  const [auctionStartPrice, setAuctionStartPrice] = useState(0);
  const [auctionBuyItNowEnabled, setAuctionBuyItNowEnabled] = useState(false);
  const [auctionBuyItNow, setAuctionBuyItNow] = useState(0);
  const [bestOfferEnabled, setBestOfferEnabled] = useState(false);
  const [bestOfferAutoAcceptPrice, setBestOfferAutoAcceptPrice] = useState<number>(0);
  const [bestOfferAutoDeclinePrice, setBestOfferAutoDeclinePrice] = useState<number>(0);

  useEffect(() => {
    if (!generated || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (!cancelled) setEbayTokenForPolicies(data?.token ?? localStorage.getItem("ebay-user-token"));
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
        body: { images: imageUrls, voiceNote, ...(ebayCategoryId ? { categoryId: ebayCategoryId } : {}) },
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
        if (data.error === "ebay_account_required") {
          toast.error("Connect an eBay account to start generating listings", {
            description: "The free tier requires an active eBay connection.",
            action: { label: "Connect", onClick: () => navigate("/settings") },
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
      if (data._meta) setAnalysisMeta(data._meta);
      if (data._ebayMetadata) setEbayMetadata(data._ebayMetadata);
      else setEbayMetadata(null);

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
      const aiMid = ((data.priceMin || 0) + (data.priceMax || data.priceMin || 0)) / 2;
      setListingPrice(parseFloat(aiMid.toFixed(2)) || 0);
      setAuctionStartPrice(parseFloat((data.priceMin || 0).toFixed(2)) || 0);
      setGenerated(true);
    } catch (err: unknown) {
      console.error("Analysis error:", err);
      toast.error((err as Error).message || "Failed to analyze item. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => { handleGenerate(); }, []); // mount-only intentional

  if (imageUrls.length === 0) {
    navigate("/home");
    return null;
  }

  const handleSave = async () => {
    let uploadedUrls = imageUrls;
    if (user?.id) uploadedUrls = await uploadListingImages(imageUrls, user.id);
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
    if (success) { toast.success("Draft saved!"); navigate("/drafts"); }
  };

  const handlePublish = async () => {
    if (!canPublish) {
      toast.error(`Monthly publish limit reached (${currentPlanLimits.publishLimit}). Upgrade for more listings.`);
      navigate("/billing");
      return;
    }
    if (ebayMetadata?.requiredAspects?.length) {
      const missing = ebayMetadata.requiredAspects.filter(
        (a) => !itemSpecifics[a] || String(itemSpecifics[a]).trim() === ""
      );
      if (missing.length) {
        toast.error(`Missing required eBay fields: ${missing.join(", ")}`, { description: "Fill in these fields before publishing.", duration: 6000 });
        return;
      }
    }
    setPublishing(true);
    try {
      let ebayToken: string | null = null;
      let postalCode: string | null = null;
      let city: string | null = null;
      if (user?.id) {
        try {
          const { data: td } = await supabase.functions.invoke("ebay-publish", {
            body: { action: "get_stored_token", userId: user.id },
          });
          if (td?.token) { ebayToken = td.token; postalCode = td.postalCode ?? null; city = td.city ?? null; }
          else { postalCode = td?.postalCode ?? null; city = td?.city ?? null; }
        } catch (e) { console.error("get_stored_token error", e); }
      }
      if (!ebayToken) ebayToken = localStorage.getItem("ebay-user-token");

      if (!ebayToken) {
        const { data, error } = await supabase.functions.invoke("ebay-publish", { body: { action: "get_auth_url" } });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to get auth URL");
        localStorage.setItem("pending_listing", JSON.stringify({
          title, description: getDescriptionWithFooter(), listingFormat, listingPrice, auctionStartPrice,
          auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null, imageUrls, ebayCategoryId,
          itemSpecifics, condition, postalCode: postalCode || undefined, city: city || undefined,
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId, paymentPolicyId: selectedPolicies.paymentPolicyId,
          returnPolicyId: selectedPolicies.returnPolicyId, bestOfferEnabled: bestOfferEnabled || undefined,
          bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
          bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
        }));
        window.location.href = data.authUrl;
        return;
      }

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft", userToken: ebayToken, postalCode: postalCode || undefined, city: city || undefined,
          title, description: getDescriptionWithFooter(), listingFormat, listingPrice, auctionStartPrice,
          auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
          imageUrls: user?.id ? await uploadListingImages(imageUrls, user.id) : imageUrls,
          condition, ebayCategoryId, itemSpecifics,
          fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId || undefined,
          paymentPolicyId: selectedPolicies.paymentPolicyId || undefined,
          returnPolicyId: selectedPolicies.returnPolicyId || undefined,
          bestOfferEnabled: bestOfferEnabled || undefined,
          bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
          bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
        },
      });

      if (error || data?.error) {
        const isPublishPolicyError = data?.publishFailed === true;
        const isTokenExpiry = !isPublishPolicyError && (
          data?.error?.includes("401 ") || data?.error === "401" ||
          (data?.error?.includes("expired") && !data?.error?.includes("code has expired")) ||
          error?.message?.includes("401")
        );
        if (isTokenExpiry) { localStorage.removeItem("ebay-user-token"); toast.error("eBay session expired. Please reconnect eBay in Settings."); return; }
        if (data?.missingPolicies) {
          toast.error("eBay business policies not configured", {
            description: data.error,
            action: { label: "Open Seller Hub", onClick: () => window.open("https://www.ebay.com/sh/ovw/policies", "_blank") },
            duration: 10000,
          });
          return;
        }
        if (data?.publishFailed) {
          let msg = data.error as string;
          try {
            const jsonStart = msg.indexOf("{");
            if (jsonStart !== -1) {
              const errJson = JSON.parse(msg.slice(jsonStart));
              const firstErr = errJson?.errors?.[0];
              if (firstErr?.message) msg = firstErr.message.replace(/<[^>]+>/g, "").split(".")[0].trim() || msg;
            }
          } catch { /* keep raw */ }
          toast.error("eBay rejected the listing", { description: msg, duration: 10000 });
          return;
        }
        throw new Error(data?.error || error?.message || "Publish failed");
      }

      const successMsg = data.listingId
        ? `Listing published live on eBay! (ID: ${data.listingId})`
        : `Listing created on eBay (Offer ID: ${data.offerId})`;
      toast.success(successMsg, {
        description: data.affiliateUrl ? "Affiliate link ready — share it to earn EPN commissions." : undefined,
        action: data.affiliateUrl ? { label: "Copy Link", onClick: () => navigator.clipboard.writeText(data.affiliateUrl) } : undefined,
        duration: 5000,
      });
      await recordUsage("ebay_publish");

      // Persist COGS to listing_cogs so the Listings page and Profit Report
      // can show cost/margin data even after this session ends.
      if (cogs != null && user?.id && (data.sku || data.listingId)) {
        try {
          await supabase.from("listing_cogs").insert({
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
    } catch (err: unknown) {
      console.error("Publish error:", err);
      toast.error((err as Error).message || "Failed to publish to eBay.");
    } finally {
      setPublishing(false);
    }
  };

  const displaySpecifics = Object.entries(itemSpecifics).filter(([, v]) => v && v.trim() !== "");

  return (
    <AppShell>
      <div style={S.page}>
        {/* Sticky header */}
        <div style={S.header}>
          <button
            onClick={() => navigate("/home")}
            style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted, display: "flex", alignItems: "center" }}
          >
            <ArrowLeft size={20} />
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: COLORS.textPrimary, flex: 1 }}>Analyze Item</span>
          <span style={{ fontSize: "0.75rem", color: COLORS.textMuted }}>{imageUrls.length} photo{imageUrls.length !== 1 && "s"}</span>
        </div>

        <div style={S.inner}>
          {/* ── Image carousel ── */}
          <div style={S.carousel}>
            <img
              src={imageUrls[activePhoto]}
              alt={`Item photo ${activePhoto + 1}`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {imageUrls.length > 1 && (
              <>
                <button
                  style={{ ...S.carouselBtn, left: 8 }}
                  onClick={() => setActivePhoto((p) => (p - 1 + imageUrls.length) % imageUrls.length)}
                >
                  <ChevronLeft size={16} color={COLORS.textPrimary} />
                </button>
                <button
                  style={{ ...S.carouselBtn, right: 8 }}
                  onClick={() => setActivePhoto((p) => (p + 1) % imageUrls.length)}
                >
                  <ChevronRight size={16} color={COLORS.textPrimary} />
                </button>
                <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
                  {imageUrls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActivePhoto(i)}
                      style={{
                        width: 8, height: 8, borderRadius: "50%", border: "none", cursor: "pointer",
                        background: i === activePhoto ? COLORS.brand : "rgba(255,255,255,0.6)",
                        transition: "background 0.15s",
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {imageUrls.length > 1 && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
              {imageUrls.map((url, i) => (
                <div key={i} style={S.thumb(i === activePhoto)} onClick={() => setActivePhoto(i)}>
                  <img src={url} alt={`Thumb ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ))}
            </div>
          )}

          {/* ── Loading state ── */}
          {generating && !generated && (
            <div style={S.loadingBox}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(0,118,182,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Loader2 size={24} color={COLORS.brand} className="animate-spin" />
              </div>
              <p style={{ fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Analyzing with AI…</p>
              <p style={{ fontSize: "0.875rem", color: COLORS.textMuted, margin: 0 }}>
                {imageUrls.length} photo{imageUrls.length !== 1 && "s"} — identifying item & researching prices
              </p>
              <p style={{ fontSize: "0.75rem", color: COLORS.textSubtle, margin: 0 }}>
                {usage.aiAnalysis}/{currentPlanLimits.analysisLimit} analyses used this month
              </p>
            </div>
          )}

          {/* ── Retry state ── */}
          {!generating && !generated && (
            <div style={S.loadingBox}>
              <p style={{ fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Analysis failed</p>
              <p style={{ fontSize: "0.875rem", color: COLORS.textMuted, margin: 0 }}>Check your connection and try again.</p>
              <button
                onClick={handleGenerate}
                style={{ ...S.btnPrimary, marginTop: 4 }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
              >
                <Sparkles size={16} />
                Retry Analysis
              </button>
              {!canAnalyze && (
                <button
                  onClick={() => navigate("/billing")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.brand, fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Crown size={12} /> Upgrade plan
                </button>
              )}
            </div>
          )}

          {/* ── Generated results ── */}
          {generated && (
            <>
              {/* Credit tracking — free tier */}
              {analysisMeta && currentPlan === "starter" && (
                <div style={S.infoBox()}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <p style={{ fontSize: "0.75rem", fontWeight: 700, color: COLORS.brand, margin: "0 0 2px" }}>Free Tier Credits</p>
                      <p style={{ fontSize: "1rem", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                        {analysisMeta.creditsRemaining} / {analysisMeta.creditsUsed + analysisMeta.creditsRemaining} remaining
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: "0.75rem", color: COLORS.textMuted, margin: "0 0 2px" }}>
                        Resets {new Date(analysisMeta.creditsResetAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {analysisMeta.creditsRemaining <= 2 && analysisMeta.creditsRemaining > 0 && (
                    <p style={{ fontSize: "0.8125rem", color: COLORS.brand, marginTop: 6, marginBottom: 0 }}>
                      💡 Running low — upgrade to Pro for unlimited analyses
                    </p>
                  )}
                </div>
              )}

              {/* ── Title & Description ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Sparkles size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Listing Content</span>
                </div>
                <div style={S.sectionBody}>
                  <div style={S.field}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={S.label}>eBay Title</label>
                      <span style={S.charCount}>{title.length}/80</span>
                    </div>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                      style={S.input}
                      onFocus={e => { e.currentTarget.style.borderColor = COLORS.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,118,182,0.12)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.boxShadow = "none"; }}
                    />
                  </div>

                  <div style={S.field}>
                    <label style={S.label}>Item Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      style={S.textarea}
                      onFocus={e => { e.currentTarget.style.borderColor = COLORS.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,118,182,0.12)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.boxShadow = "none"; }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.8125rem", color: COLORS.textMuted }}>
                      <input
                        type="checkbox"
                        checked={includeAiFooter}
                        onChange={(e) => setIncludeAiFooter(e.target.checked)}
                        style={{ accentColor: COLORS.brand }}
                      />
                      Append AI disclosure footer
                    </label>
                    {includeAiFooter && (
                      <p style={{ fontSize: "0.75rem", color: COLORS.textSubtle, fontStyle: "italic", background: "#f7f9fb", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "0.5rem 0.75rem", margin: 0 }}>
                        "Listing generated by Teckstart AI Assistant. All details should be verified by the buyer."
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Item Specifics & Category ── */}
              {displaySpecifics.length > 0 && (
                <div style={S.section}>
                  <div style={S.sectionHeader}>
                    <Tag size={16} color={COLORS.brand} />
                    <span style={cardTitleStyle}>eBay Item Specifics</span>
                  </div>
                  <div style={S.sectionBody}>
                    {/* Category selector */}
                    <div style={S.field}>
                      <label style={S.label}>eBay Category</label>
                      {!isCustomCategoryMode ? (
                        <>
                          <select
                            value={ebayCategoryId}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "__custom__") { setIsCustomCategoryMode(true); setCustomCategoryInput(""); }
                              else { setEbayCategoryId(val); setCustomCategoryInput(""); }
                            }}
                            style={S.select}
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
                              <option value={ebayCategoryId}>#{ebayCategoryId} — {getEbayCategoryBreadcrumb(ebayCategoryId) || "Custom category"}</option>
                            )}
                            <option value="__custom__">✏️ Enter custom category ID...</option>
                          </select>
                          {suggestedCategories.find(c => c.categoryId === ebayCategoryId)?.reason && (
                            <p style={{ fontSize: "0.75rem", color: COLORS.textMuted, fontStyle: "italic", margin: 0 }}>
                              {suggestedCategories.find(c => c.categoryId === ebayCategoryId)?.reason}
                            </p>
                          )}
                        </>
                      ) : (
                        <div style={{ ...cardInnerStyle, padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.625rem", borderColor: COLORS.brand }}>
                          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: COLORS.textMuted, margin: 0 }}>Enter custom eBay category ID</p>
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
                                if (v) { setPendingCategoryId(v); setShowCategoryConfirm(true); }
                              }
                            }}
                            style={S.input}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={() => { const v = customCategoryInput.trim(); if (v) { setPendingCategoryId(v); setShowCategoryConfirm(true); } }}
                              disabled={!customCategoryInput.trim()}
                              style={{ ...btnPrimaryStyle, flex: 1, padding: "0.5rem", fontSize: "0.8125rem" }}
                            >
                              Confirm ID
                            </button>
                            <button
                              onClick={() => { setIsCustomCategoryMode(false); setCustomCategoryInput(""); }}
                              style={{ ...btnOutlineStyle, flex: 1, padding: "0.5rem", fontSize: "0.8125rem" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Specifics table */}
                    <div style={S.specificsTable}>
                      {displaySpecifics.map(([key, value], idx) => {
                        const isRequired = ebayMetadata?.requiredAspects?.includes(key);
                        const isSuggested = ebayMetadata?.suggestedAspects?.includes(key);
                        const isLast = idx === displaySpecifics.length - 1;
                        return (
                          <div key={key} style={S.specificsRow(isLast)}>
                            <span style={S.specificsKey}>
                              {key}
                              {isRequired && <span style={{ ...S.reqBadge, marginLeft: 4 }}>req</span>}
                              {isSuggested && !isRequired && <span style={{ ...S.optBadge, marginLeft: 4 }}>opt</span>}
                            </span>
                            <input
                              value={value || ""}
                              onChange={(e) => setItemSpecifics(prev => ({ ...prev, [key]: e.target.value }))}
                              style={S.specificsVal}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Condition */}
                    <div style={{ ...S.specificsRow(true), ...cardInnerStyle, padding: "0.625rem 0.875rem" }}>
                      <span style={S.specificsKey}>Condition</span>
                      <select
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                        style={{ fontSize: "0.8125rem", color: COLORS.textPrimary, background: "transparent", border: "none", cursor: "pointer", textAlign: "right" }}
                      >
                        {ebayMetadata?.allowedConditions?.length
                          ? ebayMetadata.allowedConditions.map((c) => <option key={c} value={c}>{c}</option>)
                          : getConditionsForCategory(ebayCategoryId || undefined, domain, getEbayCategoryBreadcrumb(ebayCategoryId) || undefined).map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))
                        }
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── AI Grade (coins/cards) ── */}
              {suggestedGrade && !isSlabbed && (domain === "coins_bullion" || domain === "trading_cards") && (
                <div style={S.section}>
                  <div style={S.sectionHeader}>
                    <ShieldCheck size={16} color={COLORS.brand} />
                    <span style={cardTitleStyle}>AI-Estimated Grade</span>
                    {gradeConfirmed && (
                      <span style={{ ...badgeStyle, marginLeft: "auto" }}>
                        <Check size={11} /> Confirmed
                      </span>
                    )}
                  </div>
                  <div style={S.sectionBody}>
                    <div style={S.gradeCard(gradeConfirmed)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "2rem", fontWeight: 800, color: COLORS.textPrimary }}>{suggestedGrade}</span>
                        {!gradeConfirmed && (
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: COLORS.amber, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 999, padding: "0.2rem 0.6rem", display: "flex", alignItems: "center", gap: 4 }}>
                            <AlertTriangle size={11} /> Pending
                          </span>
                        )}
                      </div>
                      {gradingRationale && (
                        <div style={{ background: "#f7f9fb", border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0.75rem" }}>
                          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: COLORS.textMuted, margin: "0 0 4px" }}>Grading Rationale</p>
                          <p style={{ fontSize: "0.8125rem", color: COLORS.textPrimary, lineHeight: 1.6, margin: 0 }}>{gradingRationale}</p>
                        </div>
                      )}
                      <div style={S.infoBox("amber")}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <AlertTriangle size={14} color={COLORS.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                          <p style={{ fontSize: "0.75rem", color: "#92400e", lineHeight: 1.5, margin: 0 }}>
                            <strong>Disclaimer:</strong> AI-estimated from photo only. Not a substitute for PCGS, NGC, or professional certification.
                          </p>
                        </div>
                      </div>
                      {!gradeConfirmed ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => { setGradeConfirmed(true); setItemSpecifics(prev => ({ ...prev, Grade: suggestedGrade })); toast.success(`Grade ${suggestedGrade} applied`); }}
                            style={{ ...btnPrimaryStyle, flex: 1, padding: "0.625rem" }}
                          >
                            <Check size={14} /> Accept Grade
                          </button>
                          <button
                            onClick={() => { setSuggestedGrade(""); setGradingRationale(""); setItemSpecifics(prev => ({ ...prev, Grade: "Ungraded" })); toast("Grade dismissed — set to Ungraded"); }}
                            style={{ ...btnOutlineStyle, flex: 1, padding: "0.625rem" }}
                          >
                            <XIcon size={14} /> Dismiss
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setGradeConfirmed(false); setItemSpecifics(prev => ({ ...prev, Grade: "Ungraded" })); }}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: COLORS.textMuted, textAlign: "center" as const }}
                        >
                          Undo confirmation
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Consignor ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <UserCircle size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Consignor</span>
                  <span style={{ fontSize: "0.75rem", color: COLORS.textSubtle, marginLeft: "auto" }}>Optional</span>
                </div>
                <div style={S.sectionBody}>
                  <input
                    value={consignor}
                    onChange={(e) => setConsignor(e.target.value)}
                    placeholder="Who does this item belong to?"
                    style={S.input}
                    onFocus={e => { e.currentTarget.style.borderColor = COLORS.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,118,182,0.12)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
              </div>

              {/* ── COGS ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <DollarSign size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Item Cost (COGS)</span>
                </div>
                <div style={S.sectionBody}>
                  <CogsInput
                    cogs={cogs}
                    listingPrice={listingPrice > 0 ? listingPrice : auctionStartPrice > 0 ? auctionStartPrice : (priceMin + priceMax) / 2}
                    onChange={setCogs}
                    disabled={!planFeatures.hasCogsTracking}
                  />
                </div>
              </div>

              {/* ── Price Recommender ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <ShoppingCart size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Smart Price Recommender</span>
                </div>
                <div style={S.sectionBody}>
                  <PriceRecommenderCard
                    title={title}
                    condition={condition}
                    priceMin={priceMin}
                    priceMax={priceMax}
                    metalType={planFeatures.hasMeltProtection && metalType !== "none" ? metalType : undefined}
                    metalWeightOz={planFeatures.hasMeltProtection && metalType !== "none" ? metalWeightOz : undefined}
                    meltValue={planFeatures.hasMeltProtection && metalType !== "none" ? meltValue : null}
                    spotPrices={planFeatures.hasMeltProtection && metalType !== "none" ? spotPrices : null}
                    onApplyPrice={(price) => { setListingPrice(price); setAuctionStartPrice(price); }}
                  />
                </div>
              </div>

              {/* ── Listing Format & Price ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <DollarSign size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Listing Format & Price</span>
                </div>
                <div style={S.sectionBody}>
                  <div style={S.toggleGroup}>
                    <button onClick={() => setListingFormat("FIXED_PRICE")} style={S.toggleBtn(listingFormat === "FIXED_PRICE")}>
                      <DollarSign size={14} /> Buy It Now
                    </button>
                    <button onClick={() => setListingFormat("AUCTION")} style={S.toggleBtn(listingFormat === "AUCTION")}>
                      <Gavel size={14} /> Auction
                    </button>
                  </div>

                  {listingFormat === "FIXED_PRICE" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div style={S.field}>
                        <label style={S.label}>Listing Price ($)</label>
                        <input type="number" min="0" step="0.01" value={listingPrice || ""} placeholder="0.00" onChange={(e) => setListingPrice(parseFloat(e.target.value) || 0)} style={S.input} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.8125rem", color: COLORS.textMuted }}>
                        <input type="checkbox" checked={bestOfferEnabled} onChange={(e) => setBestOfferEnabled(e.target.checked)} style={{ accentColor: COLORS.brand }} />
                        Accept Best Offers from buyers
                      </label>
                      {bestOfferEnabled && (
                        <div style={S.indentSection}>
                          <div style={S.field}>
                            <label style={S.label}>Auto-Accept Price ($) <span style={{ fontStyle: "italic", opacity: 0.7 }}>optional</span></label>
                            <input type="number" min="0" step="0.01" value={bestOfferAutoAcceptPrice || ""} placeholder="Leave blank to review manually" onChange={(e) => setBestOfferAutoAcceptPrice(parseFloat(e.target.value) || 0)} style={S.input} />
                          </div>
                          <div style={S.field}>
                            <label style={S.label}>Auto-Decline Price ($) <span style={{ fontStyle: "italic", opacity: 0.7 }}>optional</span></label>
                            <input type="number" min="0" step="0.01" value={bestOfferAutoDeclinePrice || ""} placeholder="Leave blank to review manually" onChange={(e) => setBestOfferAutoDeclinePrice(parseFloat(e.target.value) || 0)} style={S.input} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {listingFormat === "AUCTION" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div style={S.field}>
                        <label style={S.label}>Starting Bid ($)</label>
                        <input type="number" min="0" step="0.01" value={auctionStartPrice || ""} placeholder="0.00" onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value) || 0)} style={S.input} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.8125rem", color: COLORS.textMuted }}>
                        <input type="checkbox" checked={auctionBuyItNowEnabled} onChange={(e) => setAuctionBuyItNowEnabled(e.target.checked)} style={{ accentColor: COLORS.brand }} />
                        Add Buy It Now price to auction
                      </label>
                      {auctionBuyItNowEnabled && (
                        <div style={S.field}>
                          <label style={S.label}>Buy It Now Price ($)</label>
                          <input type="number" min="0" step="0.01" value={auctionBuyItNow || ""} placeholder="0.00" onChange={(e) => setAuctionBuyItNow(parseFloat(e.target.value) || 0)} style={S.input} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── eBay Business Policies ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <ShieldCheck size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>eBay Business Policies</span>
                </div>
                <div style={S.sectionBody}>
                  <EbayPolicySelector
                    userToken={ebayTokenForPolicies}
                    onPoliciesSelected={setSelectedPolicies}
                    disabled={publishing}
                  />
                </div>
              </div>

              {/* ── Export ── */}
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Download size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Export Listing</span>
                </div>
                <div style={S.sectionBody}>
                  <div style={S.toggleGroup}>
                    {([ ["ebay_file_exchange", "eBay File Exchange"], ["facebook_marketplace", "Facebook Marketplace"] ] as const).map(([key, label]) => (
                      <button key={key} onClick={() => setExportPlatform(key)} style={S.toggleBtn(exportPlatform === key)}>{label}</button>
                    ))}
                  </div>
                  <div style={S.toggleGroup}>
                    {([ ["csv", "CSV", Download], ["excel", "Excel (.xlsx)", FileSpreadsheet], ["google_sheets", "Google Sheets", Sheet] ] as const).map(([key, label, Icon]) => (
                      <button key={key} onClick={() => setExportFormat(key)} style={S.toggleBtn(exportFormat === key)}>
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      exportListing(exportPlatform, exportFormat, {
                        title, description, priceMin, priceMax, imageUrls, ebayCategoryId, itemSpecifics, condition,
                        fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId ?? undefined,
                        paymentPolicyId: selectedPolicies.paymentPolicyId ?? undefined,
                        returnPolicyId: selectedPolicies.returnPolicyId ?? undefined,
                      });
                      recordUsage("export");
                      toast.success(`Exported as ${exportFormat === "csv" ? "CSV" : exportFormat === "excel" ? "Excel" : "Google Sheets"}`);
                    }}
                    style={{ ...btnOutlineStyle, width: "100%", padding: "0.75rem" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = SHADOWS.btnHover; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = SHADOWS.btn; }}
                  >
                    <Download size={16} />
                    Download {exportFormat === "csv" ? "CSV" : exportFormat === "excel" ? "Excel" : "Sheets"}
                  </button>
                </div>
              </div>

              {/* ── Action buttons ── */}
              <div style={S.actionRow}>
                <button
                  onClick={handleSave}
                  style={S.btnSuccess}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.9"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                >
                  <Save size={18} /> Save Draft
                </button>

                {isOwner ? (
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    style={{ ...S.btnPrimary, opacity: publishing ? 0.7 : 1 }}
                    onMouseEnter={e => { if (!publishing) { (e.currentTarget as HTMLButtonElement).style.opacity = "0.9"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = publishing ? "0.7" : "1"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                  >
                    {publishing ? <><Loader2 size={18} className="animate-spin" /> Publishing…</> : <><Send size={18} /> Publish Live to eBay</>}
                  </button>
                ) : (
                  <div style={S.btnDisabled}>
                    <Lock size={18} /> Publishing restricted to account owner
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Category Confirm Dialog */}
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
          }}
        />
      </div>
    </AppShell>
  );
}