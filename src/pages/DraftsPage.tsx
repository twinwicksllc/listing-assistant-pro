import { Trash2, FileText, ShoppingCart, Gavel, Tag } from "lucide-react";
import { useDrafts } from "@/hooks/useDrafts";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";

export default function DraftsPage() {
  const { drafts, removeDraft } = useDrafts();

  const handleDelete = (id: string) => {
    removeDraft(id);
    toast.success("Draft deleted");
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-lg font-bold text-foreground">Saved Drafts</h1>
        <p className="text-xs text-muted-foreground">{drafts.length} listing{drafts.length !== 1 ? "s" : ""}</p>
      </header>

      <div className="px-4 space-y-3 max-w-lg mx-auto">
        {drafts.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto">
              <FileText className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">No drafts yet. Capture an item to get started!</p>
          </div>
        )}

        {drafts.map((draft) => {
          // Prefer user-chosen listingPrice; fall back to midpoint of AI range
          const displayPrice =
            draft.listingPrice != null && draft.listingPrice > 0
              ? draft.listingPrice
              : (draft.priceMin + draft.priceMax) / 2;

          const isAuction = draft.listingFormat === "AUCTION";

          return (
            <div key={draft.id} className="bg-card border border-border rounded-xl p-3 flex gap-3">
              <img
                src={draft.imageUrl}
                alt={draft.title}
                className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{draft.title}</p>

                {/* Price + Format badge */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-sm font-bold text-primary">
                    ${displayPrice.toFixed(2)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      isAuction
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {isAuction ? (
                      <><Gavel className="w-2.5 h-2.5" /> Auction</>
                    ) : (
                      <><ShoppingCart className="w-2.5 h-2.5" /> Buy It Now</>
                    )}
                  </span>
                </div>

                {/* Category breadcrumb */}
                {(draft.ebayCategoryBreadcrumb || draft.ebayCategoryId) && (
                  <div className="flex items-start gap-1 mt-1">
                    <Tag className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
                      {draft.ebayCategoryBreadcrumb || `Category #${draft.ebayCategoryId}`}
                    </p>
                  </div>
                )}

                {/* Consignor */}
                {draft.consignor && (
                  <p className="text-xs text-primary mt-0.5">
                    Consignor: {draft.consignor}
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-0.5">
                  {draft.createdAt.toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(draft.id)}
                className="self-start p-1.5 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}
