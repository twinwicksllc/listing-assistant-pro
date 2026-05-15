import { DollarSign, Gavel } from "lucide-react";

interface ListingFormatPriceProps {
  // Format
  listingFormat: "FIXED_PRICE" | "AUCTION";
  onSelectFixedPrice: () => void;
  onSelectAuction: () => void;
  // Fixed Price
  listingPrice: number;
  onUpdateListingPrice: (v: string) => void;
  quantity: number;
  onUpdateQuantity: (v: string) => void;
  pricingMode: "per_item" | "total";
  onSelectPricingMode: (mode: "per_item" | "total") => void;
  // Best Offer
  bestOfferEnabled: boolean;
  onToggleBestOffer: (v: boolean) => void;
  bestOfferAutoAcceptPrice: number;
  onUpdateBestOfferAutoAccept: (v: string) => void;
  bestOfferAutoDeclinePrice: number;
  onUpdateBestOfferAutoDecline: (v: string) => void;
  // Auction
  auctionStartPrice: number;
  onUpdateAuctionStartPrice: (v: string) => void;
  auctionBuyItNowEnabled: boolean;
  onToggleAuctionBuyItNow: (v: boolean) => void;
  auctionBuyItNow: number;
  onUpdateAuctionBuyItNow: (v: string) => void;
}

export function ListingFormatPrice({
  listingFormat,
  onSelectFixedPrice,
  onSelectAuction,
  listingPrice,
  onUpdateListingPrice,
  quantity,
  onUpdateQuantity,
  pricingMode,
  onSelectPricingMode,
  bestOfferEnabled,
  onToggleBestOffer,
  bestOfferAutoAcceptPrice,
  onUpdateBestOfferAutoAccept,
  bestOfferAutoDeclinePrice,
  onUpdateBestOfferAutoDecline,
  auctionStartPrice,
  onUpdateAuctionStartPrice,
  auctionBuyItNowEnabled,
  onToggleAuctionBuyItNow,
  auctionBuyItNow,
  onUpdateAuctionBuyItNow,
}: ListingFormatPriceProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <DollarSign className="w-3.5 h-3.5 text-primary" />
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Listing Format & Price
        </label>
      </div>

      {/* Format selector */}
      <div className="flex gap-2">
        <button
          onClick={onSelectFixedPrice}
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
          onClick={onSelectAuction}
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

      {/* Buy It Now */}
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
              onChange={(e) => onUpdateListingPrice(e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Quantity Available</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => onUpdateQuantity(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            {quantity > 1 && (
              <div className="space-y-1 pl-1">
                <label className="text-xs text-muted-foreground">Listing price is…</label>
                <div className="flex gap-2">
                  {(["per_item", "total"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onSelectPricingMode(mode)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        pricingMode === mode
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {mode === "per_item" ? "Per item" : "Total for all"}
                    </button>
                  ))}
                </div>
                {pricingMode === "total" && listingPrice > 0 && (
                  <p className="text-xs text-muted-foreground pt-0.5">
                    eBay will list at{" "}
                    <span className="font-medium text-foreground">
                      ${(listingPrice / quantity).toFixed(2)}
                    </span>{" "}
                    per item
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
              onChange={(e) => onToggleBestOffer(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs text-muted-foreground">Accept Best Offers from buyers</span>
          </label>

          {bestOfferEnabled && (
            <div className="space-y-2 pl-6 border-l-2 border-primary/20">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Auto-Accept Price ($)
                  <span className="ml-1 text-muted-foreground/60 italic">
                    optional — auto-accept offers at or above this
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={bestOfferAutoAcceptPrice || ""}
                  placeholder="Leave blank to review manually"
                  onChange={(e) => onUpdateBestOfferAutoAccept(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Auto-Decline Price ($)
                  <span className="ml-1 text-muted-foreground/60 italic">
                    optional — auto-decline offers at or below this
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={bestOfferAutoDeclinePrice || ""}
                  placeholder="Leave blank to review manually"
                  onChange={(e) => onUpdateBestOfferAutoDecline(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auction */}
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
              onChange={(e) => onUpdateAuctionStartPrice(e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={auctionBuyItNowEnabled}
              onChange={(e) => onToggleAuctionBuyItNow(e.target.checked)}
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
                onChange={(e) => onUpdateAuctionBuyItNow(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
