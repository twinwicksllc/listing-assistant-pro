import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import PricingCard from "@/components/PricingCard";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function AnalyzePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();

  // Support both legacy single image and new multi-image
  const state = location.state as any;
  const imageUrls: string[] = state?.imageUrls ?? (state?.imageUrl ? [state.imageUrl] : []);

  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [activePhoto, setActivePhoto] = useState(0);

  if (imageUrls.length === 0) {
    navigate("/");
    return null;
  }

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-item", {
        body: { images: imageUrls },
      });

      if (error) throw new Error(error.message || "Analysis failed");
      if (data?.error) throw new Error(data.error);

      setTitle((data.title || "").slice(0, 80));
      setDescription(data.description || "");
      setPriceMin(data.priceMin || 0);
      setPriceMax(data.priceMax || 0);
      setGenerated(true);
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
    });
    toast.success("Draft saved!");
    navigate("/drafts");
  };

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

            <PricingCard priceMin={priceMin} priceMax={priceMax} />

            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-success text-success-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              Save Draft
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
