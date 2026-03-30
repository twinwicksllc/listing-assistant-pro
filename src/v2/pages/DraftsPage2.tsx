import { useState, useEffect } from "react";
import {
  Trash2, FileText, ShoppingCart, Gavel, Tag, Pencil,
  Send, Loader2, CheckSquare, Square, AlertTriangle,
} from "lucide-react";
import DraftPriceAdvisor from "@/components/DraftPriceAdvisor";
import { useDrafts } from "@/hooks/useDrafts";
import { usePublishDraft } from "@/hooks/usePublishDraft";
import { useAuth } from "@/contexts/AuthContext";
import EditDraftModal from "@/components/EditDraftModal";
import { toast } from "sonner";
import { ListingDraft } from "@/types/listing";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/v2/components/AppShell";
import { COLORS, SHADOWS, FONT, cardStyle, cardHeaderStyle, cardTitleStyle, btnPrimaryStyle, btnOutlineStyle, btnDangerStyle } from "@/v2/theme";

const S = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
    backgroundAttachment: "fixed" as const,
    fontFamily: FONT,
    paddingBottom: "2rem",
  } as React.CSSProperties,

  inner: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "1.5rem 1rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  } as React.CSSProperties,

  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    marginBottom: "0.25rem",
  } as React.CSSProperties,

  pageTitle: {
    fontSize: "1.375rem",
    fontWeight: 800,
    color: COLORS.textPrimary,
    margin: 0,
    lineHeight: 1.2,
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: "0.8125rem",
    color: COLORS.textMuted,
    margin: "0.25rem 0 0",
  } as React.CSSProperties,

  publishBtn: {
    ...btnPrimaryStyle,
    padding: "0.625rem 1rem",
    fontSize: "0.8125rem",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,

  selectAllBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.8125rem",
    color: COLORS.textMuted,
    padding: "0.25rem 0",
  } as React.CSSProperties,

  // Draft card
  draftCard: (selected: boolean): React.CSSProperties => ({
    background: "#ffffff",
    border: `1px solid ${selected ? COLORS.brand : COLORS.border}`,
    borderRadius: 14,
    boxShadow: selected
      ? `0 0 0 2px rgba(0,118,182,0.15), ${SHADOWS.card}`
      : SHADOWS.card,
    padding: "0.875rem",
    display: "flex",
    gap: "0.75rem",
    transition: "border-color 0.15s, box-shadow 0.15s",
  }),

  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 10,
    objectFit: "cover" as const,
    flexShrink: 0,
    border: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,

  draftTitle: {
    fontSize: "0.875rem",
    fontWeight: 600,
    color: COLORS.textPrimary,
    lineHeight: 1.35,
    margin: "0 0 0.375rem",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  } as React.CSSProperties,

  priceRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: "0.375rem",
    marginBottom: "0.25rem",
  } as React.CSSProperties,

  price: {
    fontSize: "1rem",
    fontWeight: 800,
    color: COLORS.brand,
  } as React.CSSProperties,

  badge: (color: "blue" | "amber" | "green"): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: "0.6875rem",
    fontWeight: 700,
    padding: "0.175rem 0.5rem",
    borderRadius: 999,
    background: color === "blue" ? "rgba(0,118,182,0.10)" : color === "amber" ? "rgba(245,158,11,0.12)" : "rgba(22,163,74,0.10)",
    color: color === "blue" ? COLORS.brand : color === "amber" ? "#b45309" : "#16a34a",
    border: `1px solid ${color === "blue" ? "rgba(0,118,182,0.20)" : color === "amber" ? "rgba(245,158,11,0.25)" : "rgba(22,163,74,0.20)"}`,
  }),

  iconBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "none",
    border: `1px solid transparent`,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    color: COLORS.textMuted,
  } as React.CSSProperties,

  // Empty state
  emptyState: {
    ...cardStyle,
    padding: "3rem 1.5rem",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "0.75rem",
    textAlign: "center" as const,
  } as React.CSSProperties,

  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "rgba(0,118,182,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as React.CSSProperties,
};

export default function DraftsPage2() {
  const { drafts, removeDraft, updateDraft } = useDrafts();
  const { publishDraft } = usePublishDraft();
  const { isOwner } = useAuth();

  const [editingDraft, setEditingDraft]   = useState<ListingDraft | null>(null);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [publishing, setPublishing]       = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [spotPrices, setSpotPrices]       = useState<{ gold: number; silver: number; platinum: number } | null>(null);

  useEffect(() => {
    const hasMetal = drafts.some((d) => d.metalType && d.metalType !== "none" && (d.metalWeightOz ?? 0) > 0);
    if (!hasMetal || spotPrices) return;
    supabase.functions
      .invoke("spot-prices", { body: { metalType: "gold", weightOz: 1 } })
      .then(({ data }) => { if (data?.spotPrices) setSpotPrices(data.spotPrices); })
      .catch(() => {});
  }, [drafts, spotPrices]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = drafts.length > 0 && selectedIds.size === drafts.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(drafts.map((d) => d.id)));
  };

  const handlePublishSelected = async () => {
    if (selectedIds.size === 0) { toast.error("Select at least one draft to publish."); return; }
    const toPublish = drafts.filter((d) => selectedIds.has(d.id));
    setPublishing(true);
    let successCount = 0, errorCount = 0;
    for (const draft of toPublish) {
      setPublishingIds((prev) => new Set(prev).add(draft.id));
      const result = await publishDraft(draft);
      if (result === "auth_redirect") { setPublishing(false); setPublishingIds(new Set()); return; }
      if (result === "ok") {
        successCount++;
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(draft.id); return next; });
      } else { errorCount++; }
      setPublishingIds((prev) => { const next = new Set(prev); next.delete(draft.id); return next; });
    }
    setPublishing(false);
    if (successCount > 0 && errorCount === 0)
      toast.success(`${successCount} listing${successCount !== 1 ? "s" : ""} published to eBay!`);
    else if (successCount > 0 && errorCount > 0)
      toast.warning(`${successCount} published, ${errorCount} failed.`);
  };

  const handleDelete = (id: string) => {
    removeDraft(id);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    toast.success("Draft deleted");
  };

  return (
    <AppShell>
      <div style={S.page}>
        <div style={S.inner}>
          {/* ── Page header ── */}
          <div>
            <div style={S.pageHeader}>
              <div>
                <h1 style={S.pageTitle}>Saved Drafts</h1>
                <p style={S.pageSubtitle}>
                  {drafts.length} listing{drafts.length !== 1 ? "s" : ""}
                  {selectedIds.size > 0 && (
                    <span style={{ color: COLORS.brand, fontWeight: 600 }}> · {selectedIds.size} selected</span>
                  )}
                </p>
              </div>
              {isOwner && drafts.length > 0 && (
                <button
                  onClick={handlePublishSelected}
                  disabled={publishing || selectedIds.size === 0}
                  style={{ ...S.publishBtn, opacity: (publishing || selectedIds.size === 0) ? 0.5 : 1 }}
                  onMouseEnter={e => { if (selectedIds.size > 0 && !publishing) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
                >
                  {publishing
                    ? <><Loader2 size={14} className="animate-spin" /> Publishing…</>
                    : <><Send size={14} /> Publish Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>
                  }
                </button>
              )}
            </div>

            {drafts.length > 0 && (
              <button style={S.selectAllBtn} onClick={toggleSelectAll}>
                {allSelected
                  ? <CheckSquare size={15} color={COLORS.brand} />
                  : <Square size={15} color={COLORS.textMuted} />
                }
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>

          {/* ── Empty state ── */}
          {drafts.length === 0 && (
            <div style={S.emptyState}>
              <div style={S.emptyIcon}>
                <FileText size={28} color={COLORS.brand} />
              </div>
              <p style={{ fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>No drafts yet</p>
              <p style={{ fontSize: "0.875rem", color: COLORS.textMuted, margin: 0 }}>
                Capture an item from the Home page to get started!
              </p>
            </div>
          )}

          {/* ── Draft cards ── */}
          {drafts.map((draft) => {
            const displayPrice =
              draft.listingPrice != null && draft.listingPrice > 0
                ? draft.listingPrice
                : (draft.priceMin + draft.priceMax) / 2;

            const isAuction        = draft.listingFormat === "AUCTION";
            const isSelected       = selectedIds.has(draft.id);
            const isBeingPublished = publishingIds.has(draft.id);

            const metalKey = draft.metalType?.toLowerCase() as keyof typeof spotPrices;
            const liveMelt =
              spotPrices && metalKey && metalKey !== "none" && (draft.metalWeightOz ?? 0) > 0
                ? spotPrices[metalKey] * (draft.metalWeightOz ?? 0)
                : null;
            const isBelowMelt = liveMelt !== null && displayPrice < liveMelt;

            return (
              <div key={draft.id} style={S.draftCard(isSelected)}>
                {/* Checkbox */}
                <button
                  onClick={() => toggleSelect(draft.id)}
                  style={{ alignSelf: "flex-start", marginTop: 2, flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: isSelected ? COLORS.brand : COLORS.textMuted, padding: 2 }}
                  title={isSelected ? "Deselect" : "Select for publishing"}
                >
                  {isSelected ? <CheckSquare size={18} color={COLORS.brand} /> : <Square size={18} />}
                </button>

                {/* Thumbnail */}
                <img src={draft.imageUrl} alt={draft.title} style={S.thumbnail} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={S.draftTitle}>{draft.title}</p>

                  <div style={S.priceRow}>
                    <span style={S.price}>${displayPrice.toFixed(2)}</span>
                    <span style={S.badge(isAuction ? "amber" : "blue")}>
                      {isAuction ? <><Gavel size={10} /> Auction</> : <><ShoppingCart size={10} /> Buy It Now</>}
                    </span>
                    {isBeingPublished && (
                      <span style={S.badge("blue")}>
                        <Loader2 size={10} className="animate-spin" /> Publishing…
                      </span>
                    )}
                    {isBelowMelt && liveMelt && (
                      <span style={S.badge("amber")}>
                        <AlertTriangle size={10} /> Below melt (${liveMelt.toFixed(2)})
                      </span>
                    )}
                  </div>

                  {(draft.ebayCategoryBreadcrumb || draft.ebayCategoryId) && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 2 }}>
                      <Tag size={11} color={COLORS.textSubtle} style={{ flexShrink: 0, marginTop: 1 }} />
                      <p style={{ fontSize: "0.6875rem", color: COLORS.textSubtle, lineHeight: 1.4, margin: 0 }}>
                        {draft.ebayCategoryBreadcrumb || `Category #${draft.ebayCategoryId}`}
                      </p>
                    </div>
                  )}

                  {draft.consignor && (
                    <p style={{ fontSize: "0.75rem", color: COLORS.brand, margin: "0 0 2px", fontWeight: 500 }}>
                      Consignor: {draft.consignor}
                    </p>
                  )}

                  <p style={{ fontSize: "0.6875rem", color: COLORS.textSubtle, margin: "0 0 0.5rem" }}>
                    {draft.createdAt.toLocaleDateString()}
                  </p>

                  <DraftPriceAdvisor
                    title={draft.title}
                    condition={draft.condition}
                    currentPrice={displayPrice}
                    priceMin={draft.priceMin}
                    priceMax={draft.priceMax}
                    metalType={draft.metalType}
                    metalWeightOz={draft.metalWeightOz}
                    meltValue={liveMelt}
                    onApplyPrice={(price) => {
                      updateDraft(draft.id, { listingPrice: price });
                      toast.success(`Price updated to $${price.toFixed(2)}`);
                    }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
                  <button
                    onClick={() => setEditingDraft(draft)}
                    style={S.iconBtn}
                    title="Edit draft"
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,118,182,0.08)"; (e.currentTarget as HTMLButtonElement).style.color = COLORS.brand; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; (e.currentTarget as HTMLButtonElement).style.color = COLORS.textMuted; }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(draft.id)}
                    disabled={isBeingPublished}
                    style={{ ...S.iconBtn, opacity: isBeingPublished ? 0.4 : 1 }}
                    title="Delete draft"
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(220,38,38,0.08)"; (e.currentTarget as HTMLButtonElement).style.color = "#dc2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; (e.currentTarget as HTMLButtonElement).style.color = COLORS.textMuted; }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {editingDraft && (
          <EditDraftModal
            key={editingDraft.id}
            draft={editingDraft}
            updateDraft={updateDraft}
            onClose={() => setEditingDraft(null)}
            onSaved={() => setEditingDraft(null)}
          />
        )}
      </div>
    </AppShell>
  );
}