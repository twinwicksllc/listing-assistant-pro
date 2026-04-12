import { useState } from "react";
import { TrendingUp, Plus, BookMarked, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import BottomNav from "@/components/BottomNav";
import MarketWatchCard from "@/components/MarketWatchCard";
import KeywordResearchPanel from "@/components/KeywordResearchPanel";
import { useMarketWatches } from "@/hooks/useMarketWatches";

// ----------------------------------------------------------------
// Add-watch dialog
// ----------------------------------------------------------------
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
    setQuery("");
    setLabel("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Market Watch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Search Query *</label>
            <Input
              placeholder="e.g. iPhone 13 Pro, vintage Rolex..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Label (optional)</label>
            <Input
              placeholder="e.g. iPhones, luxury watches..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A friendly name shown on the watch card. Defaults to the query.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !query.trim()}>
            {saving ? "Saving…" : "Add Watch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------
type Tab = "research" | "watches";

export default function MarketResearchPage() {
  const {
    watches,
    loading,
    refreshingId,
    addWatch,
    deleteWatch,
    refreshWatch,
    fetchHistory,
  } = useMarketWatches();

  const [activeTab, setActiveTab] = useState<Tab>("research");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogQuery, setAddDialogQuery] = useState("");
  const [watchSearch, setWatchSearch] = useState("");

  const handleSaveWatch = (query: string) => {
    setAddDialogQuery(query);
    setAddDialogOpen(true);
  };

  const filteredWatches = watchSearch
    ? watches.filter(
        (w) =>
          w.label?.toLowerCase().includes(watchSearch.toLowerCase()) ||
          w.searchQuery.toLowerCase().includes(watchSearch.toLowerCase())
      )
    : watches;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-lg">Market Research</h1>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setAddDialogQuery(""); setAddDialogOpen(true); }}
          >
            <Plus className="w-4 h-4 mr-1" />
            Watch
          </Button>
        </div>

        {/* Tab bar */}
        <div className="max-w-lg mx-auto px-4 flex border-t border-border">
          <button
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
              activeTab === "research"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("research")}
          >
            <Search className="w-4 h-4" />
            Keyword Research
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
              activeTab === "watches"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("watches")}
          >
            <BookMarked className="w-4 h-4" />
            Saved Watches
            {watches.length > 0 && (
              <span className="ml-0.5 bg-primary/10 text-primary text-[10px] font-semibold rounded-full px-1.5 py-0.5">
                {watches.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* ── KEYWORD RESEARCH TAB ── */}
        {activeTab === "research" && (
          <KeywordResearchPanel onSaveWatch={handleSaveWatch} />
        )}

        {/* ── SAVED WATCHES TAB ── */}
        {activeTab === "watches" && (
          <div className="space-y-3">
            {/* Filter bar */}
            {watches.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Filter watches…"
                  value={watchSearch}
                  onChange={(e) => setWatchSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredWatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                <BookMarked className="w-10 h-10 text-muted-foreground/40" />
                <p className="font-semibold">
                  {watches.length === 0 ? "No saved watches yet" : "No watches match your filter"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {watches.length === 0
                    ? "Use Keyword Research to find market data and save watches to track price trends over time."
                    : "Try a different search term."}
                </p>
                {watches.length === 0 && (
                  <Button
                    size="sm"
                    onClick={() => { setAddDialogQuery(""); setAddDialogOpen(true); }}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add First Watch
                  </Button>
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
          </div>
        )}
      </div>

      {/* Add watch dialog */}
      <AddWatchDialog
        open={addDialogOpen}
        initialQuery={addDialogQuery}
        onClose={() => setAddDialogOpen(false)}
        onAdd={async (params) => { await addWatch(params); }}
      />

      <BottomNav />
    </div>
  );
}