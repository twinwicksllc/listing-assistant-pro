import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight, Send, Tag, Crown, Download } from "lucide-react";
import PricingCard from "@/components/PricingCard";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics } from "@/types/listing";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { exportListing, type ExportPlatform } from "@/lib/exportCSV";

export default function AnalyzePage() {
  const { canAnalyze, canPublish, isPro, usage, recordUsage } = useAuth();
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
  const [itemSpecifics, setItemSpecifics] = useState<ItemSpecifics>({});
  const [condition, setCondition] = useState<string>("USED_EXCELLENT");
  const [exportPlatform, setExportPlatform] = useState<ExportPlatform>("ebay_file_exchange");

  if (imageUrls.length === 0) {
    navigate("/");
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

      if (error) throw new Error(error.message || "Analysis failed");
      if (data?.error) throw new Error(data.error);

      setTitle((data.title || "").slice(0, 80));
      setDescription(data.description || "");
      setPriceMin(data.priceMin || 0);
      setPriceMax(data.priceMax || 0);
      setMetalType(data.metalType || "none");
      setMetalWeightOz(data.metalWeightOz || 0);
      setEbayCategoryId(data.ebayCategoryId || "");
      setItemSpecifics(data.itemSpecifics || {});
      setCondition(data.condition || "USED_EXCELLENT");
      setGenerated(true);
      await recordUsage("ai_analysis");
    } catch (err: any) {
      console.error("Analysis error:", err);
      toast.error(err.message || "Failed to analyze item. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = () => {
    addDraft({
      id: crypto.randomUUID(),
      imageUrl: imageUrls[0],
      title,
      description,
      priceMin,
      priceMax,
      createdAt: new Date(),
      ebayCategoryId,
      itemSpecifics,
      condition,
    });
    toast.success("Draft saved!");
    navigate("/drafts");
  };

  const handlePublish = async () => {
    if (!canPublish) {
      toast.error(`Monthly publish limit reached (${PLANS.starter.publishLimit}). Upgrade to Pro for unlimited.`);
      navigate("/billing");
      return;
    }
    setPublishing(true);
    try {
      let ebayToken = localStorage.getItem("ebay_user_token");

      if (!ebayToken) {
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_auth_url" },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to get auth URL");

        localStorage.setItem("pending_listing", JSON.stringify({ title, description, priceMin, imageUrl: imageUrls[0], ebayCategoryId, itemSpecifics, condition }));
        window.location.href = data.authUrl;
        return;
      }

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          title,
          description,
          priceMin,
          imageUrl: imageUrls[0],
          condition,
          ebayCategoryId,
          itemSpecifics,
        },
      });

      if (error || data?.error) {
        if (data?.error?.includes("401") || data?.error?.includes("expired")) {
          localStorage.removeItem("ebay_user_token");
          toast.error("eBay session expired. Please connect again.");
          return;
        }
        throw new Error(data?.error || error?.message || "Publish failed");
      }

      toast.success(`Draft listing created on eBay! (Offer ID: ${data.offerId})`);
      await recordUsage("ebay_publish");
    } catch (err: any) {
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
        <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
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
            {!isPro && (
              <p className="text-center text-xs text-muted-foreground">
                {usage.aiAnalysis}/{PLANS.starter.analysisLimit} free analyses used this month
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
            </div>

            {/* Item Specifics */}
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

            {/* Pricing */}
            <PricingCard priceMin={priceMin} priceMax={priceMax} searchQuery={title} metalType={metalType} metalWeightOz={metalWeightOz} />

            {/* Action buttons */}
            <div className="space-y-2">
              <button
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-success text-success-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
              >
                <Save className="w-4 h-4" />
                Save Draft
              </button>

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
                    Publish to eBay
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}