import { useState } from "react";
import { Trash2, FileText, ShoppingCart, Gavel, Tag, Pencil, Send, Loader2, CheckSquare, Square } from "lucide-react";
import { useDrafts } from "@/hooks/useDrafts";
import { usePublishDraft } from "@/hooks/usePublishDraft";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import EditDraftModal from "@/components/EditDraftModal";
import { toast } from "sonner";
import { ListingDraft } from "@/types/listing";

export default function DraftsPage() {
  const { drafts, removeDraft } = useDrafts();
  const { publishDraft } = usePublishDraft();
  const { isOwner } = useAuth();

  const [editingDraft, setEditingDraft]     = useState<ListingDraft | null>(null);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [publishing, setPublishing]         = useState(false);
  const [publishingIds, setPublishingIds]   = useState<Set<string>>(new Set());

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = drafts.length > 0 && selectedIds.size === drafts.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)));
    }
  };

  // ── Bulk publish ───────────────────────────────────────────────────────────
  const handlePublishSelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Select at least one draft to publish.");
      return;
    }

    const toPublish = drafts.filter((d) => selectedIds.has(d.id));
    setPublishing(true);

    let successCount = 0;
    let errorCount   = 0;

    for (const draft of toPublish) {
      setPublishingIds((prev) => new Set(prev).add(draft.id));
      const result = await publishDraft(draft);

      if (result === "auth_redirect") {
        // OAuth redirect happened — stop processing
        setPublishing(false);
        setPublishingIds(new Set());
        return;
      }

      if (result === "ok") {
        successCount++;
        // Deselect successfully published draft
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(draft.id);
          return next;
        });
      } else {
        errorCount++;
      }

      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
    }

    setPublishing(false);

    if (successCount > 0 && errorCount === 0) {
      toast.success(`${successCount} listing${successCount !== 1 ? "s" : ""} published to eBay!`);
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`${successCount} published, ${errorCount} failed. Check errors above.`);
    }
  };

  const handleDelete = (id: string) => {
    removeDraft(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast.success("Draft deleted");
  };

  return (
    <div className="min-h-screen bg-background pb-24">

      {/* ── Header ── */}
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Saved Drafts</h1>
            <p className="text-xs text-muted-foreground">
              {drafts.length} listing{drafts.length !== 1 ? "s" : ""}
              {selectedIds.size > 0 && (
                <span className="ml-1 text-primary font-medium">
                  · {selectedIds.size} selected
                </span>
              )}
            </p>
          </div>

          {/* Publish Selected button — only visible to owners when ≥1 draft exists */}
          {isOwner && drafts.length > 0 && (
            <button
              onClick={handlePublishSelected}
              disabled={publishing || selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {publishing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Publish Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>
              )}
            </button>
          )}
        </div>

        {/* Select All toggle — shown when there are drafts */}
        {drafts.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </header>

      {/* ── Draft cards ── */}
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
          const displayPrice =
            draft.listingPrice != null && draft.listingPrice > 0
              ? draft.listingPrice
              : (draft.priceMin + draft.priceMax) / 2;

          const isAuction      = draft.listingFormat === "AUCTION";
          const isSelected     = selectedIds.has(draft.id);
          const isBeingPublished = publishingIds.has(draft.id);

          return (
            <div
              key={draft.id}
              className={`bg-card border rounded-xl p-3 flex gap-3 transition-colors ${
                isSelected ? "border-primary ring-1 ring-primary/30" : "border-border"
              }`}
            >
              {/* Checkbox */}
              <button
                onClick={() => toggleSelect(draft.id)}
                className="self-start mt-0.5 flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
                title={isSelected ? "Deselect" : "Select for publishing"}
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>

              {/* Thumbnail */}
              <img
                src={draft.imageUrl}
                alt={draft.title}
                className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
              />

              {/* Content */}
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
                  {isBeingPublished && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Publishing…
                    </span>
                  )}
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

              {/* Action buttons */}
              <div className="flex flex-col gap-1 self-start">
                <button
                  onClick={() => setEditingDraft(draft)}
                  className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                  title="Edit draft"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(draft.id)}
                  disabled={isBeingPublished}
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  title="Delete draft"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <BottomNav />

      {/* Edit modal */}
      {editingDraft && (
        <EditDraftModal
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={() => setEditingDraft(null)}
        />
      )}
    </div>
  );
}
