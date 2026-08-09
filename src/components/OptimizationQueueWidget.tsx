import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  TrendingDown,
  TrendingUp,
  Clock,
  Type,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useOptimizeListing } from "@/hooks/useOptimization";
import OptimizationModal from "@/components/OptimizationModal";
import type { OptimizationFlag } from "@/types/optimization";

interface Listing {
  listingId: string | null;
  offerId: string | null;
  sku: string;
  title: string;
  price: number;
  imageUrl: string;
  categoryId?: string | null;
  listingDate?: string | null;
  ebayUrl?: string | null;
}

interface QueueItem {
  listing: Listing;
  opportunityScore: number;
  flags: OptimizationFlag[];
  suggestedPrice: number | null;
  direction: "lower" | "raise" | "keep";
  daysActive: number;
}

interface Props {
  listings: Listing[];
  onPriceApplied?: (listingId: string, newPrice: number) => void;
}

function FlagIcon({ flag }: { flag: OptimizationFlag }) {
  switch (flag) {
    case "overpriced":
      return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
    case "underpriced":
      return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
    case "stale":
      return <Clock className="w-3.5 h-3.5 text-orange-500" />;
    case "poor_title":
      return <Type className="w-3.5 h-3.5 text-purple-500" />;
  }
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-red-500"
      : score >= 40
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span
        className={`text-xs font-bold w-6 text-right ${score >= 70 ? "text-red-600" : score >= 40 ? "text-amber-600" : "text-emerald-600"}`}
      >
        {score}
      </span>
    </div>
  );
}

export default function OptimizationQueueWidget({
  listings,
  onPriceApplied,
}: Props) {
  const { analyze } = useOptimizeListing();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const scanListings = useCallback(async () => {
    if (listings.length === 0) return;
    setScanning(true);
    setQueue([]);

    // Analyze top 10 listings (by recency / price, avoid too many API calls)
    const toScan = listings.slice(0, 10);

    const results: QueueItem[] = [];

    for (const listing of toScan) {
      if (!listing.title || listing.price <= 0) continue;

      const result = await analyze({
        listingId: listing.listingId ?? listing.sku,
        title: listing.title,
        currentPrice: listing.price,
        categoryId: listing.categoryId,
        listingDate: listing.listingDate,
      });

      if (result) {
        const daysActive = listing.listingDate
          ? Math.floor(
              (Date.now() - new Date(listing.listingDate).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 0;

        results.push({
          listing,
          opportunityScore: result.opportunityScore,
          flags: result.flags,
          suggestedPrice: result.priceSuggestion.suggestedPrice,
          direction: result.priceSuggestion.direction,
          daysActive,
        });
      }
    }

    // Sort by opportunity score descending
    results.sort((a, b) => b.opportunityScore - a.opportunityScore);
    setQueue(results);
    setScanning(false);
    setScanned(true);
  }, [listings, analyze]);

  const handleOptimize = (item: QueueItem) => {
    setSelectedListing(item.listing);
    setModalOpen(true);
  };

  const handlePriceApplied = (listingId: string, newPrice: number) => {
    // Update queue item with new price
    setQueue((prev) =>
      prev.map((item) =>
        item.listing.listingId === listingId
          ? {
              ...item,
              listing: { ...item.listing, price: newPrice },
              flags: [],
              opportunityScore: 0,
              direction: "keep" as const,
            }
          : item,
      ),
    );
    onPriceApplied?.(listingId, newPrice);
    setModalOpen(false);
  };

  const highPriorityCount = queue.filter(
    (q) => q.opportunityScore >= 70,
  ).length;
  const hasIssues = queue.some((q) => q.flags.length > 0);

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Auto-Optimize</h3>
            <p className="text-xs text-muted-foreground">
              {scanned
                ? hasIssues
                  ? `${queue.filter((q) => q.flags.length > 0).length} listings need attention`
                  : "All listings look good!"
                : "Scan listings for pricing & title issues"}
            </p>
          </div>
        </div>
        {scanned && (
          <Button
            variant="ghost"
            size="sm"
            onClick={scanListings}
            disabled={scanning}
            className="h-8 text-xs"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${scanning ? "animate-spin" : ""}`}
            />
            Rescan
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Initial state */}
        {!scanning && !scanned && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium mb-1">
              Find Optimization Opportunities
            </p>
            <p className="text-xs text-muted-foreground mb-4 max-w-xs">
              Analyzes your listings against current market data to surface
              pricing and title improvements.
            </p>
            <Button onClick={scanListings} disabled={listings.length === 0}>
              <Zap className="w-4 h-4 mr-2" />
              Scan {Math.min(listings.length, 10)} Listings
            </Button>
          </div>
        )}

        {/* Scanning state */}
        {scanning && (
          <div className="flex flex-col items-center py-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium">Scanning listings…</p>
            <p className="text-xs text-muted-foreground mt-1">
              Fetching market data for each listing
            </p>
          </div>
        )}

        {/* Results */}
        {scanned && !scanning && (
          <div className="space-y-2">
            {/* Summary badges */}
            {highPriorityCount > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 mb-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-700 font-medium">
                  {highPriorityCount} high-priority listing
                  {highPriorityCount > 1 ? "s" : ""} need immediate attention
                </p>
              </div>
            )}

            {queue.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No listings could be analyzed. Make sure your eBay account is
                connected.
              </div>
            )}

            {queue.slice(0, 5).map((item) => (
              <div
                key={item.listing.listingId ?? item.listing.sku}
                className={`flex gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/30 cursor-pointer ${item.opportunityScore >= 70 ? "border-red-200 bg-red-50/30" : item.opportunityScore >= 40 ? "border-amber-200 bg-amber-50/20" : "border-border"}`}
                onClick={() => handleOptimize(item)}
              >
                {/* Thumbnail */}
                <div className="w-10 h-10 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                  {item.listing.imageUrl ? (
                    <img
                      src={item.listing.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Zap className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {item.listing.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      ${item.listing.price.toFixed(2)}
                    </span>
                    {item.suggestedPrice && item.direction !== "keep" && (
                      <span
                        className={`text-xs font-medium ${item.direction === "lower" ? "text-red-600" : "text-emerald-600"}`}
                      >
                        → ${item.suggestedPrice.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar score={item.opportunityScore} />
                  </div>
                  {item.flags.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {item.flags.map((f) => (
                        <div key={f} className="flex items-center gap-0.5">
                          <FlagIcon flag={f} />
                          <span className="text-xs text-muted-foreground capitalize">
                            {f.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 self-center" />
              </div>
            ))}

            {queue.length > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                + {queue.length - 5} more listings scanned
              </p>
            )}
          </div>
        )}
      </div>

      {/* Optimization Modal */}
      <OptimizationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        listing={
          selectedListing
            ? {
                listingId: selectedListing.listingId ?? selectedListing.sku,
                offerId: selectedListing.offerId,
                sku: selectedListing.sku,
                title: selectedListing.title,
                currentPrice: selectedListing.price,
                imageUrl: selectedListing.imageUrl,
                categoryId: selectedListing.categoryId,
                listingDate: selectedListing.listingDate,
                ebayUrl: selectedListing.ebayUrl,
              }
            : null
        }
        onPriceApplied={handlePriceApplied}
      />
    </div>
  );
}
