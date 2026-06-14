import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  TrendingDown, TrendingUp, Minus, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Tag, Type, BarChart2, ArrowRight,
  AlignLeft,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOptimizeListing } from "@/hooks/useOptimization";
import type { OptimizeListingResult, OptimizationFlag } from "@/types/optimization";

interface Props {
  open: boolean;
  onClose: () => void;
  listing: {
    listingId: string;
    offerId: string | null;
    sku: string;
    title: string;
    currentPrice: number;
    description?: string;
    imageUrl?: string;
    categoryId?: string | null;
    listingDate?: string | null;
    ebayUrl?: string | null;
  } | null;
  onPriceApplied?: (listingId: string, newPrice: number) => void;
  userToken?: string | null;
}

function FlagBadge({ flag }: { flag: OptimizationFlag }) {
  const config = {
    overpriced: { label: "Overpriced", className: "bg-red-100 text-red-700 border-red-200" },
    underpriced: { label: "Underpriced", className: "bg-amber-100 text-amber-700 border-amber-200" },
    stale: { label: "Stale", className: "bg-orange-100 text-orange-700 border-orange-200" },
    poor_title: { label: "Poor Title", className: "bg-purple-100 text-purple-700 border-purple-200" },
  };
  const c = config[flag];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
      {c.label}
    </span>
  );
}

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 70 ? "text-red-600" : score >= 40 ? "text-amber-600" : "text-emerald-600";
  const barColor = score >= 70 ? "bg-red-500" : score >= 40 ? "bg-amber-500" : "bg-emerald-500";
  const label = score >= 70 ? "High Priority" : score >= 40 ? "Medium" : "Low";
  return (
    <div className="flex items-center gap-3">
      <div className={`text-2xl font-bold ${color}`}>{score}</div>
      <div className="flex-1">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Opportunity Score</span>
          <span className={color}>{label}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const cfg = {
    high: "bg-emerald-100 text-emerald-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

// ----------------------------------------------------------------
// Pricing Tab
// ----------------------------------------------------------------
function PricingTab({
  result,
  listing,
  onApply,
  onDismiss,
  applying,
  customPrice,
  onCustomPriceChange,
}: {
  result: OptimizeListingResult;
  listing: NonNullable<Props["listing"]>;
  onApply: () => void;
  onDismiss: () => void;
  applying: boolean;
  customPrice: string;
  onCustomPriceChange: (price: string) => void;
}) {
  const { priceSuggestion, market } = result;
  const dirIcon =
    priceSuggestion.direction === "lower" ? (
      <TrendingDown className="w-5 h-5 text-red-500" />
    ) : priceSuggestion.direction === "raise" ? (
      <TrendingUp className="w-5 h-5 text-emerald-500" />
    ) : (
      <Minus className="w-5 h-5 text-muted-foreground" />
    );

  const priceToApply = customPrice ? parseFloat(customPrice) : priceSuggestion.suggestedPrice;

  return (
    <div className="space-y-4">
      {/* Current vs Suggested */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Current Price</p>
          <p className="text-2xl font-bold">${listing.currentPrice.toFixed(2)}</p>
        </div>
        <div className={`rounded-lg border p-4 text-center ${priceSuggestion.suggestedPrice ? "border-primary bg-primary/5" : "bg-muted/30"}`}>
          <p className="text-xs text-muted-foreground mb-1">Suggested Price</p>
          <p className={`text-2xl font-bold ${priceSuggestion.suggestedPrice ? "text-primary" : "text-muted-foreground"}`}>
            {priceSuggestion.suggestedPrice ? `$${priceSuggestion.suggestedPrice.toFixed(2)}` : "—"}
          </p>
        </div>
      </div>

      {/* Custom price input */}
      {priceSuggestion.suggestedPrice && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
            Override with Custom Price (Optional)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={customPrice}
                onChange={(e) => onCustomPriceChange(e.target.value)}
                placeholder={priceSuggestion.suggestedPrice.toFixed(2)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            {customPrice && (
              <button
                onClick={() => onCustomPriceChange("")}
                className="px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg transition"
              >
                Clear
              </button>
            )}
          </div>
          {customPrice && parseFloat(customPrice) !== priceSuggestion.suggestedPrice && (
            <p className="text-xs text-muted-foreground mt-1">
              Using custom price: ${parseFloat(customPrice).toFixed(2)}
            </p>
          )}
        </div>
      )}

      {/* Market benchmarks */}
      {market && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Market Benchmarks</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {market.avgSoldPrice && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Sold</span>
                <span className="font-medium">${market.avgSoldPrice.toFixed(2)}</span>
              </div>
            )}
            {market.avgActivePrice && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Active</span>
                <span className="font-medium">${market.avgActivePrice.toFixed(2)}</span>
              </div>
            )}
            {market.minActivePrice && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lowest Active</span>
                <span className="font-medium">${market.minActivePrice.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sell-Through</span>
              <span className="font-medium">{(market.sellThroughRate * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Competition</span>
              <span className={`font-medium capitalize ${market.competitionLevel === "high" ? "text-red-600" : market.competitionLevel === "medium" ? "text-amber-600" : "text-emerald-600"}`}>
                {market.competitionLevel}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demand</span>
              <span className={`font-medium capitalize ${market.demandSignal === "strong" ? "text-emerald-600" : market.demandSignal === "weak" ? "text-red-600" : "text-amber-600"}`}>
                {market.demandSignal}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reasoning */}
      <div className="rounded-lg bg-muted/40 p-3 flex gap-2">
        {dirIcon}
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <ConfidenceBadge confidence={priceSuggestion.confidence} />
            {priceSuggestion.estimatedImpact !== "Minimal" && priceSuggestion.estimatedImpact !== "Unknown" && (
              <span className="text-xs font-medium text-primary">{priceSuggestion.estimatedImpact}</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{priceSuggestion.reasoning}</p>
        </div>
      </div>

      {/* Actions */}
      {priceSuggestion.suggestedPrice && (
        <div className="flex gap-2 pt-1">
          <Button onClick={onApply} disabled={applying} className="flex-1">
            {applying ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Apply ${priceToApply?.toFixed(2)}</>
            )}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={applying}>
            <XCircle className="w-4 h-4 mr-1" /> Dismiss
          </Button>
        </div>
      )}
      {priceSuggestion.direction === "keep" && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4" />
          <span>Price is well-positioned. No change needed.</span>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Title Tab
// ----------------------------------------------------------------
function TitleTab({
  result,
  listing,
  editableTitle,
  onEditableTitleChange,
  onApplyTitle,
  applying,
}: {
  result: OptimizeListingResult;
  listing: NonNullable<Props["listing"]>;
  editableTitle: string;
  onEditableTitleChange: (value: string) => void;
  onApplyTitle: () => void;
  applying: boolean;
}) {
  const { titleSuggestion } = result;
  const titleLen = listing.title.length;
  const editableLen = editableTitle.length;

  return (
    <div className="space-y-4">
      {/* Current title */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Title</p>
          <span className={`text-xs font-medium ${titleLen > 80 ? "text-red-600" : titleLen < 30 ? "text-amber-600" : "text-emerald-600"}`}>
            {titleLen}/80 chars
          </span>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm">{listing.title}</p>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${titleLen > 80 ? "bg-red-500" : titleLen > 60 ? "bg-emerald-500" : titleLen > 30 ? "bg-amber-500" : "bg-red-400"}`}
              style={{ width: `${Math.min((titleLen / 80) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Issues */}
      {titleSuggestion.issuesFound.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issues Found</p>
          {titleSuggestion.issuesFound.map((issue, i) => (
            <div key={i} className="flex gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Suggested title */}
      {titleSuggestion.suggestedTitle && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Suggested Title</p>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-sm">{titleSuggestion.suggestedTitle}</p>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Apply/Edit Title</p>
          <span className={`text-xs font-medium ${editableLen > 80 ? "text-red-600" : editableLen < 30 ? "text-amber-600" : "text-emerald-600"}`}>
            {editableLen}/80 chars
          </span>
        </div>
        <textarea
          value={editableTitle}
          onChange={(e) => onEditableTitleChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder="Enter optimized title"
        />
        <div className="mt-2 flex gap-2">
          <Button onClick={onApplyTitle} disabled={applying || editableTitle.trim().length === 0 || editableTitle.trim() === listing.title.trim()} className="flex-1">
            {applying ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Apply Title</>
            )}
          </Button>
        </div>
      </div>

      {/* Reasoning */}
      <div className="rounded-lg bg-muted/40 p-3 flex gap-2">
        <Type className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <ConfidenceBadge confidence={titleSuggestion.confidence} />
          <p className="text-sm text-muted-foreground">{titleSuggestion.reasoning}</p>
        </div>
      </div>

      {titleSuggestion.issuesFound.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4" />
          <span>Title looks well-optimized!</span>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Description Tab
// ----------------------------------------------------------------
function DescriptionTab({
  result,
  listing,
  editableDescription,
  onEditableDescriptionChange,
  onApplyDescription,
  applying,
}: {
  result: OptimizeListingResult;
  listing: NonNullable<Props["listing"]>;
  editableDescription: string;
  onEditableDescriptionChange: (value: string) => void;
  onApplyDescription: () => void;
  applying: boolean;
}) {
  const { descriptionSuggestion } = result;

  return (
    <div className="space-y-4">
      {/* Current description */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Current Description</p>
        <div className="rounded-lg border bg-muted/30 p-3 max-h-[150px] overflow-y-auto">
          <p className="text-sm whitespace-pre-wrap">{listing.description || "No description provided."}</p>
        </div>
      </div>

      {/* Issues */}
      {descriptionSuggestion.issuesFound.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Optimization Opportunities</p>
          {descriptionSuggestion.issuesFound.map((issue, i) => (
            <div key={i} className="flex gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
              <AlignLeft className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Suggested description */}
      {descriptionSuggestion.suggestedDescription && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">AI Enhanced Description</p>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 max-h-[300px] overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap italic text-muted-foreground mb-3 leading-relaxed">
              Note: Bulk description optimization is disabled for large sets to conserve API usage. 
              This preview shows how we can restructure this specific listing for better conversion.
            </p>
            <div className="p-3 bg-white rounded border text-sm whitespace-pre-wrap">
              {descriptionSuggestion.suggestedDescription}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Apply/Edit Description</p>
        <textarea
          value={editableDescription}
          onChange={(e) => onEditableDescriptionChange(e.target.value)}
          rows={8}
          className="w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder="Enter optimized description"
        />
        <div className="mt-2 flex gap-2">
          <Button
            onClick={onApplyDescription}
            disabled={applying || editableDescription.trim().length === 0 || editableDescription.trim() === (listing.description || "").trim()}
            className="flex-1"
          >
            {applying ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
            ) : (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Apply Description</>
            )}
          </Button>
        </div>
      </div>

      {/* Reasoning */}
      <div className="rounded-lg bg-muted/40 p-3 flex gap-2">
        <AlignLeft className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <ConfidenceBadge confidence={descriptionSuggestion.confidence} />
          <p className="text-sm text-muted-foreground">{descriptionSuggestion.reasoning}</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Market Tab
// ----------------------------------------------------------------
function MarketTab({ result }: { result: OptimizeListingResult }) {
  const { market } = result;
  if (!market) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <BarChart2 className="w-10 h-10 mb-2 opacity-40" />
        <p>No market data available for this listing.</p>
      </div>
    );
  }

  const strPct = Math.round(market.sellThroughRate * 100);

  return (
    <div className="space-y-4">
      {/* STR */}
      <div className="rounded-lg border p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-medium">Sell-Through Rate</p>
          <span className={`text-lg font-bold ${strPct >= 50 ? "text-emerald-600" : strPct >= 20 ? "text-amber-600" : "text-red-600"}`}>
            {strPct}%
          </span>
        </div>
        <Progress value={strPct} className="h-2" />
        <p className="text-xs text-muted-foreground mt-1">
          {market.soldCount.toLocaleString()} sold · {market.activeCount.toLocaleString()} active
        </p>
      </div>

      {/* Price breakdown */}
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-sm font-medium">Price Overview</p>
        <div className="space-y-2 text-sm">
          {market.avgSoldPrice && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Avg Sold Price</span>
              <span className="font-semibold text-primary">${market.avgSoldPrice.toFixed(2)}</span>
            </div>
          )}
          {market.minSoldPrice && market.maxSoldPrice && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Sold Range</span>
              <span className="font-medium">${market.minSoldPrice.toFixed(2)} – ${market.maxSoldPrice.toFixed(2)}</span>
            </div>
          )}
          {market.avgActivePrice && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Avg Active Price</span>
              <span className="font-medium">${market.avgActivePrice.toFixed(2)}</span>
            </div>
          )}
          {market.minActivePrice && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Lowest Competitor</span>
              <span className="font-medium">${market.minActivePrice.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Signals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Competition</p>
          <Badge variant="outline" className={`capitalize ${market.competitionLevel === "high" ? "border-red-300 text-red-700" : market.competitionLevel === "medium" ? "border-amber-300 text-amber-700" : "border-emerald-300 text-emerald-700"}`}>
            {market.competitionLevel}
          </Badge>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Demand</p>
          <Badge variant="outline" className={`capitalize ${market.demandSignal === "strong" ? "border-emerald-300 text-emerald-700" : market.demandSignal === "weak" ? "border-red-300 text-red-700" : "border-amber-300 text-amber-700"}`}>
            {market.demandSignal}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Main Modal
// ----------------------------------------------------------------
export default function OptimizationModal({ open, onClose, listing, onPriceApplied, userToken }: Props) {
  const { user } = useAuth();
  const { analyze, applying, applyingContent, analyzing, applyPriceChange, applyContentChange, dismissSuggestion } = useOptimizeListing();
  const [result, setResult] = useState<OptimizeListingResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [contentApplied, setContentApplied] = useState(false);
  const [customPrice, setCustomPrice] = useState("");
  const [editableTitle, setEditableTitle] = useState("");
  const [editableDescription, setEditableDescription] = useState("");

  useEffect(() => {
    if (open && listing && !result) {
      analyze({
        listingId: listing.listingId,
        userId: user?.id,
        title: listing.title,
        currentPrice: listing.currentPrice,
        description: listing.description,
        categoryId: listing.categoryId,
        listingDate: listing.listingDate,
      }).then((analysis) => {
        setResult(analysis);
        if (!analysis) return;

        setEditableTitle(
          analysis.titleSuggestion.suggestedTitle?.trim() || listing.title || "",
        );
        setEditableDescription(
          analysis.descriptionSuggestion.suggestedDescription?.trim() ||
            listing.description ||
            "",
        );
      });
    }
    if (!open) {
      setResult(null);
      setApplied(false);
      setContentApplied(false);
      setCustomPrice("");
      setEditableTitle("");
      setEditableDescription("");
    }
  }, [open, listing]);

  const handleApplyPrice = async () => {
    if (!result || !listing || !user) return;
    const { suggestedPrice, reasoning } = result.priceSuggestion;
    const finalPrice = customPrice ? parseFloat(customPrice) : suggestedPrice;
    if (!finalPrice) return;

    const success = await applyPriceChange({
      offerId: listing.offerId,
      sku: listing.sku,
      listingId: listing.listingId,
      newPrice: finalPrice,
      listingTitle: listing.title,
      oldPrice: listing.currentPrice,
      reasoning,
      userId: user.id,
      userToken,
    });

    if (success) {
      setApplied(true);
      onPriceApplied?.(listing.listingId, finalPrice);
    }
  };

  const handleDismissPrice = async () => {
    if (!result || !listing || !user) return;
    await dismissSuggestion({
      listingId: listing.listingId,
      listingTitle: listing.title,
      optimizationType: "price",
      oldValue: String(listing.currentPrice),
      reasoning: result.priceSuggestion.reasoning,
      userId: user.id,
    });
    onClose();
  };

  const handleApplyContent = async (mode: "title" | "description" | "both") => {
    if (!result || !listing || !user) return;

    const originalTitle = listing.title || "";
    const originalDescription = listing.description || "";
    const titleToSend = mode === "description" ? originalTitle : editableTitle;
    const descriptionToSend = mode === "title" ? originalDescription : editableDescription;

    const success = await applyContentChange({
      offerId: listing.offerId,
      sku: listing.sku,
      listingId: listing.listingId,
      listingTitle: listing.title,
      oldTitle: originalTitle,
      newTitle: titleToSend,
      oldDescription: originalDescription,
      newDescription: descriptionToSend,
      titleReasoning: result.titleSuggestion.reasoning,
      descriptionReasoning: result.descriptionSuggestion.reasoning,
      userId: user.id,
      userToken,
    });

    if (success) {
      setContentApplied(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" />
            Optimize Listing
          </DialogTitle>
        </DialogHeader>

        {listing && (
          <div className="space-y-4">
            {/* Listing header */}
            <div className="flex gap-3 p-3 rounded-lg bg-muted/30 border">
              {listing.imageUrl && (
                <img src={listing.imageUrl} alt="" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-2">{listing.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">${listing.currentPrice.toFixed(2)}</p>
              </div>
              {listing.ebayUrl && (
                <a href={listing.ebayUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex-shrink-0 mt-0.5">
                  View
                </a>
              )}
            </div>

            {/* Loading state */}
            {analyzing && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                <p className="text-sm font-medium">Analyzing market data…</p>
                <p className="text-xs text-muted-foreground mt-1">Fetching sold prices & competitor data</p>
              </div>
            )}

            {/* Results */}
            {!analyzing && result && (
              <>
                {/* Score + flags */}
                <div className="space-y-2">
                  <ScoreMeter score={result.opportunityScore} />
                  {result.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {result.flags.map((f) => <FlagBadge key={f} flag={f} />)}
                    </div>
                  )}
                </div>

                {applied && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4" />
                    Price updated successfully!
                  </div>
                )}

                {contentApplied && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4" />
                    Listing content updated successfully!
                  </div>
                )}

                {(result.noData || !result.market || (
                  !result.market.avgSoldPrice &&
                  !result.market.avgActivePrice &&
                  result.market.soldCount === 0 &&
                  result.market.activeCount === 0
                )) && (
                  <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Limited pricing data right now.</p>
                      <p className="text-amber-700">
                        Competitor comps may be incomplete, but the title and description suggestions are still useful and can be applied confidently.
                      </p>
                    </div>
                  </div>
                )}

                <Tabs defaultValue="pricing">
                  <TabsList className={`grid w-full ${result.descriptionSuggestion.suggestedDescription || result.descriptionSuggestion.issuesFound.length > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
                    <TabsTrigger value="pricing" className="text-xs">
                      <Tag className="w-3.5 h-3.5 mr-1" /> Pricing
                    </TabsTrigger>
                    <TabsTrigger value="title" className="text-xs">
                      <Type className="w-3.5 h-3.5 mr-1" /> Title
                    </TabsTrigger>
                    {(result.descriptionSuggestion.suggestedDescription || result.descriptionSuggestion.issuesFound.length > 0) && (
                      <TabsTrigger value="description" className="text-xs">
                        <AlignLeft className="w-3.5 h-3.5 mr-1" /> Desc.
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="market" className="text-xs">
                      <BarChart2 className="w-3.5 h-3.5 mr-1" /> Market
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="pricing" className="mt-4">
                    <PricingTab
                      result={result}
                      listing={listing}
                      onApply={handleApplyPrice}
                      onDismiss={handleDismissPrice}
                      applying={applying}
                      customPrice={customPrice}
                      onCustomPriceChange={setCustomPrice}
                    />
                  </TabsContent>

                  <TabsContent value="title" className="mt-4">
                    <TitleTab
                      result={result}
                      listing={listing}
                      editableTitle={editableTitle}
                      onEditableTitleChange={setEditableTitle}
                      onApplyTitle={() => handleApplyContent("title")}
                      applying={applyingContent}
                    />
                  </TabsContent>

                  {(result.descriptionSuggestion.suggestedDescription || result.descriptionSuggestion.issuesFound.length > 0) && (
                    <TabsContent value="description" className="mt-4">
                      <DescriptionTab
                        result={result}
                        listing={listing}
                        editableDescription={editableDescription}
                        onEditableDescriptionChange={setEditableDescription}
                        onApplyDescription={() => handleApplyContent("description")}
                        applying={applyingContent}
                      />
                    </TabsContent>
                  )}

                  <TabsContent value="market" className="mt-4">
                    <MarketTab result={result} />
                  </TabsContent>
                </Tabs>
              </>
            )}

            {!analyzing && !result && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                Failed to load analysis. Please try again.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}