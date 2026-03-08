import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Save, Loader2 } from "lucide-react";
import PricingCard from "@/components/PricingCard";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";

const MOCK_ITEMS = [
  { title: "Vintage Sony Walkman WM-F2015 Portable Cassette Player AM/FM Radio - Tested Working", desc: "Pre-owned Sony Walkman WM-F2015 in good cosmetic condition with minor wear. Fully tested and confirmed working — plays cassettes and receives AM/FM radio. Belt clip intact. Battery compartment clean, no corrosion. A great find for collectors and retro audio enthusiasts.", min: 34.99, max: 79.99 },
  { title: "Apple AirPods Pro 2nd Gen MagSafe Charging Case ONLY - White - Excellent Condition", desc: "Genuine Apple AirPods Pro 2nd Generation MagSafe charging case only (no earbuds). Lightning connector. In excellent condition with minimal signs of use. Hinge is firm, lid closes securely. Pairs and charges perfectly.", min: 29.99, max: 54.99 },
  { title: "Nike Air Max 90 Men's Running Shoes Size 10.5 - Triple Black - Lightly Worn", desc: "Men's Nike Air Max 90 'Triple Black' in size 10.5. Lightly worn with plenty of life left. Uppers are clean, soles show minor tread wear. Air unit intact with no visible deflation. No box included.", min: 45.00, max: 89.99 },
];

export default function AnalyzePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { addDraft } = useDrafts();
  const imageUrl = (location.state as any)?.imageUrl as string;

  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);

  if (!imageUrl) {
    navigate("/");
    return null;
  }

  const handleGenerate = async () => {
    setGenerating(true);
    // Simulate AI analysis
    await new Promise((r) => setTimeout(r, 1800));
    const mock = MOCK_ITEMS[Math.floor(Math.random() * MOCK_ITEMS.length)];
    setTitle(mock.title);
    setDescription(mock.desc);
    setPriceMin(mock.min);
    setPriceMax(mock.max);
    setGenerated(true);
    setGenerating(false);
  };

  const handleSave = () => {
    addDraft({
      id: crypto.randomUUID(),
      imageUrl,
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
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-foreground">Analyze Item</h1>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto space-y-4">
        {/* Image preview */}
        <div className="rounded-xl overflow-hidden border border-border aspect-square bg-secondary">
          <img src={imageUrl} alt="Item preview" className="w-full h-full object-cover" />
        </div>

        {!generated ? (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
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
            {/* Title */}
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

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            {/* Pricing */}
            <PricingCard priceMin={priceMin} priceMax={priceMax} />

            {/* Save */}
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
