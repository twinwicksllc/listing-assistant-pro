import { useState } from "react";
import { X, Save, Loader2, DollarSign, Gavel, ShoppingCart, Tag, UserCircle } from "lucide-react";
import { ListingDraft, ListingFormat } from "@/types/listing";
import { useDrafts } from "@/hooks/useDrafts";
import { toast } from "sonner";

interface EditDraftModalProps {
  draft: ListingDraft;
  onClose: () => void;
  onSaved: (updated: ListingDraft) => void;
}

const CONDITIONS = [
  { value: "NEW",            label: "New" },
  { value: "LIKE_NEW",       label: "Like New" },
  { value: "USED_EXCELLENT", label: "Used – Excellent" },
  { value: "USED_VERY_GOOD", label: "Used – Very Good" },
  { value: "USED_GOOD",      label: "Used – Good" },
  { value: "USED_ACCEPTABLE",label: "Used – Acceptable" },
];

export default function EditDraftModal({ draft, onClose, onSaved }: EditDraftModalProps) {
  const { updateDraft } = useDrafts();

  const [title, setTitle]               = useState(draft.title);
  const [description, setDescription]   = useState(draft.description);
  const [listingFormat, setListingFormat] = useState<ListingFormat>(draft.listingFormat ?? "FIXED_PRICE");
  const [listingPrice, setListingPrice] = useState<number>(draft.listingPrice ?? 0);
  const [condition, setCondition]       = useState(draft.condition ?? "USED_EXCELLENT");
  const [consignor, setConsignor]       = useState(draft.consignor ?? "");
  const [itemSpecifics, setItemSpecifics] = useState<Record<string, string>>(
    (draft.itemSpecifics as Record<string, string>) ?? {}
  );
  const [saving, setSaving] = useState(false);

  const displaySpecifics = Object.entries(itemSpecifics).filter(([, v]) => v !== undefined);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }
    setSaving(true);
    const updates: Partial<ListingDraft> = {
      title: title.slice(0, 80),
      description,
      listingFormat,
      listingPrice,
      condition,
      consignor,
      itemSpecifics,
    };
    const ok = await updateDraft(draft.id, updates);
    setSaving(false);
    if (ok) {
      toast.success("Draft updated!");
      onSaved({ ...draft, ...updates });
      onClose();
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Sheet / Modal */}
      <div className="w-full sm:max-w-lg bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-xl flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <img
              src={draft.imageUrl}
              alt={draft.title}
              className="w-10 h-10 rounded-lg object-cover border border-border"
            />
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight line-clamp-1">{draft.title}</p>
              <p className="text-[10px] text-muted-foreground">{draft.createdAt.toLocaleDateString()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

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
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Listing Format + Price */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-primary" />
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Listing Format & Price</label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setListingFormat("FIXED_PRICE")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                  listingFormat === "FIXED_PRICE"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
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

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {listingFormat === "AUCTION" ? "Starting Bid ($)" : "Listing Price ($)"}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={listingPrice || ""}
                placeholder="0.00"
                onChange={(e) => setListingPrice(parseFloat(e.target.value) || 0)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Item Specifics */}
          {displaySpecifics.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-primary" />
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Specifics</label>
                {draft.ebayCategoryId && (
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    Cat: {draft.ebayCategoryId}
                  </span>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg divide-y divide-border">
                {displaySpecifics.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">{key}</span>
                    <input
                      value={value ?? ""}
                      onChange={(e) =>
                        setItemSpecifics((prev) => ({ ...prev, [key]: e.target.value }))
                      }
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
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Condition (standalone if no item specifics) */}
          {displaySpecifics.length === 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
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

          {/* Category (read-only info) */}
          {(draft.ebayCategoryBreadcrumb || draft.ebayCategoryId) && (
            <div className="bg-muted/50 rounded-lg px-3 py-2.5 flex items-start gap-2">
              <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">eBay Category</p>
                <p className="text-xs text-foreground leading-snug">
                  {draft.ebayCategoryBreadcrumb || `Category #${draft.ebayCategoryId}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-6 pt-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              <><Save className="w-4 h-4" /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
