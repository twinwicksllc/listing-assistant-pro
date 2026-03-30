import { useState } from "react";
import { TrendingUp, Plus, BookMarked, Search, RefreshCw } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import MarketWatchCard from "@/components/MarketWatchCard";
import KeywordResearchPanel from "@/components/KeywordResearchPanel";
import { useMarketWatches } from "@/hooks/useMarketWatches";
import AppShell from "@/v2/components/AppShell";
import { COLORS, SHADOWS, FONT, cardStyle, cardHeaderStyle, cardTitleStyle, btnPrimaryStyle, btnOutlineStyle, inputStyle } from "@/v2/theme";

// ── Add Watch Dialog ─────────────────────────────────────────────
interface AddWatchDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (params: { searchQuery: string; label?: string }) => Promise<void>;
  initialQuery?: string;
}

function AddWatchDialog({ open, onClose, onAdd, initialQuery = "" }: AddWatchDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!query.trim()) return;
    setSaving(true);
    await onAdd({ searchQuery: query.trim(), label: label.trim() || undefined });
    setSaving(false);
    setQuery(""); setLabel("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Market Watch</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Search Query *</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. iPhone 13 Pro, vintage Rolex..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Label (optional)</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. iPhones, luxury watches..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">A friendly name shown on the watch card.</p>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            style={{ ...btnOutlineStyle, padding: "0.5rem 1rem", fontSize: "0.875rem" }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !query.trim()}
            style={{ ...btnPrimaryStyle, padding: "0.5rem 1rem", fontSize: "0.875rem", opacity: (saving || !query.trim()) ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Add Watch"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────
type Tab = "research" | "watches";

const S = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
    backgroundAttachment: "fixed" as const,
    fontFamily: FONT,
    paddingBottom: "2rem",
  } as React.CSSProperties,

  stickyHeader: {
    position: "sticky" as const,
    top: 0,
    zIndex: 40,
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,

  headerInner: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "0.875rem 1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  } as React.CSSProperties,

  tabBar: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "0 1rem",
    display: "flex",
    borderTop: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,

  tabBtn: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "0.625rem",
    fontSize: "0.875rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? COLORS.brand : "transparent"}`,
    color: active ? COLORS.brand : COLORS.textMuted,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  }),

  content: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "1.25rem 1rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  } as React.CSSProperties,

  watchCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.125rem 0.5rem",
    background: "rgba(0,118,182,0.10)",
    color: COLORS.brand,
    fontSize: "0.6875rem",
    fontWeight: 700,
    borderRadius: 999,
    border: `1px solid rgba(0,118,182,0.20)`,
  } as React.CSSProperties,

  searchInput: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  addWatchBtn: {
    ...btnPrimaryStyle,
    padding: "0.5rem 0.875rem",
    fontSize: "0.8125rem",
  } as React.CSSProperties,

  emptyState: {
    ...cardStyle,
    padding: "3rem 1.5rem",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "0.75rem",
    textAlign: "center" as const,
  } as React.CSSProperties,
};

export default function MarketResearchPage2() {
  const { watches, loading, refreshingId, addWatch, deleteWatch, refreshWatch, fetchHistory } = useMarketWatches();
  const [activeTab, setActiveTab] = useState<Tab>("research");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogQuery, setAddDialogQuery] = useState("");
  const [watchSearch, setWatchSearch] = useState("");

  const handleSaveWatch = (query: string) => {
    setAddDialogQuery(query);
    setAddDialogOpen(true);
  };

  const filteredWatches = watchSearch
    ? watches.filter((w) =>
        w.label?.toLowerCase().includes(watchSearch.toLowerCase()) ||
        w.searchQuery.toLowerCase().includes(watchSearch.toLowerCase())
      )
    : watches;

  return (
    <AppShell>
      <div style={S.page}>
        {/* Sticky header */}
        <div style={S.stickyHeader}>
          <div style={S.headerInner}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={20} color={COLORS.brand} />
              <span style={{ fontWeight: 800, fontSize: "1.125rem", color: COLORS.textPrimary }}>Market Research</span>
            </div>
            <button
              style={S.addWatchBtn}
              onClick={() => { setAddDialogQuery(""); setAddDialogOpen(true); }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
            >
              <Plus size={15} /> Watch
            </button>
          </div>

          {/* Tab bar */}
          <div style={S.tabBar}>
            <button style={S.tabBtn(activeTab === "research")} onClick={() => setActiveTab("research")}>
              <Search size={15} /> Keyword Research
            </button>
            <button style={S.tabBtn(activeTab === "watches")} onClick={() => setActiveTab("watches")}>
              <BookMarked size={15} /> Saved Watches
              {watches.length > 0 && (
                <span style={S.watchCountBadge}>{watches.length}</span>
              )}
            </button>
          </div>
        </div>

        <div style={S.content}>
          {/* ── Keyword Research tab ── */}
          {activeTab === "research" && (
            <KeywordResearchPanel onSaveWatch={handleSaveWatch} />
          )}

          {/* ── Saved Watches tab ── */}
          {activeTab === "watches" && (
            <>
              {watches.length > 3 && (
                <div style={{ position: "relative" }}>
                  <Search size={15} color={COLORS.textMuted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  <input
                    placeholder="Filter watches…"
                    value={watchSearch}
                    onChange={(e) => setWatchSearch(e.target.value)}
                    style={{ ...inputStyle, paddingLeft: "2.25rem" }}
                  />
                </div>
              )}

              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "4rem 0" }}>
                  <RefreshCw size={24} color={COLORS.textMuted} className="animate-spin" />
                </div>
              ) : filteredWatches.length === 0 ? (
                <div style={S.emptyState}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(0,118,182,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <BookMarked size={28} color={COLORS.brand} />
                  </div>
                  <p style={{ fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                    {watches.length === 0 ? "No saved watches yet" : "No watches match your filter"}
                  </p>
                  <p style={{ fontSize: "0.875rem", color: COLORS.textMuted, margin: 0, maxWidth: 300 }}>
                    {watches.length === 0
                      ? "Use Keyword Research to find market data and save watches to track price trends."
                      : "Try a different search term."}
                  </p>
                  {watches.length === 0 && (
                    <button
                      onClick={() => { setAddDialogQuery(""); setAddDialogOpen(true); }}
                      style={{ ...btnPrimaryStyle, padding: "0.625rem 1.25rem", fontSize: "0.875rem", marginTop: 4 }}
                    >
                      <Plus size={15} /> Add First Watch
                    </button>
                  )}
                </div>
              ) : (
                filteredWatches.map((watch) => (
                  <MarketWatchCard
                    key={watch.id}
                    watch={watch}
                    isRefreshing={refreshingId === watch.id}
                    onRefresh={refreshWatch}
                    onDelete={deleteWatch}
                    onFetchHistory={fetchHistory}
                  />
                ))
              )}
            </>
          )}
        </div>

        <AddWatchDialog
          open={addDialogOpen}
          initialQuery={addDialogQuery}
          onClose={() => setAddDialogOpen(false)}
          onAdd={async (params) => { await addWatch(params); }}
        />
      </div>
    </AppShell>
  );
}