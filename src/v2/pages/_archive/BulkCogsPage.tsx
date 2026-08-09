import { useState, useEffect, useCallback, useRef } from "react";
import {
  DollarSign,
  Save,
  RefreshCw,
  Loader2,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Lock,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import BottomNav from "@/components/BottomNav";
import { CsvCogsImporter } from "@/components/CsvCogsImporter";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────

interface ListingRow {
  listingId: string;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  status: string;
  cogs: number | undefined; // value currently in the input
  savedCogs: number | undefined; // last value persisted to DB
  saving: boolean;
  dirty: boolean; // input changed but not yet saved
}

type SortField = "title" | "price" | "cogs" | "margin";
type SortDir = "asc" | "desc";

// ── Helpers ────────────────────────────────────────────────────────────────

function margin(price: number, cogs: number | undefined): number | null {
  if (cogs == null || price <= 0) return null;
  return ((price - cogs) / price) * 100;
}

function MarginBadge({
  price,
  cogs,
}: {
  price: number;
  cogs: number | undefined;
}) {
  const m = margin(price, cogs);
  if (m == null)
    return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    m >= 40
      ? "text-emerald-600 dark:text-emerald-400"
      : m >= 20
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";
  const Icon = m >= 40 ? TrendingUp : m >= 0 ? Minus : TrendingDown;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {m.toFixed(1)}%
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BulkCogsPage() {
  const { user, planFeatures, isOwner } = useAuth();
  const ebayToken =
    typeof window !== "undefined"
      ? localStorage.getItem("ebay-user-token")
      : null;

  const [rows, setRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [savedCount, setSavedCount] = useState(0);

  // ── Fetch eBay listings + existing COGS ──────────────────────────────────

  const load = useCallback(async () => {
    if (!user || !ebayToken) {
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      // 1. Pull active listings from eBay Inventory API
      const inventoryRes = await supabase.functions.invoke("ebay-listings", {
        body: { userToken: ebayToken },
      });

      const rawListings: any[] = inventoryRes.data?.listings ?? [];

      if (rawListings.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // 2. Pull existing COGS from listing_cogs for all listing IDs / SKUs
      const listingIds = rawListings
        .map((l) => l.listingId)
        .filter(Boolean) as string[];
      const skus = rawListings.map((l) => l.sku).filter(Boolean) as string[];

      const orParts: string[] = [];
      if (listingIds.length > 0)
        orParts.push(`ebay_listing_id.in.(${listingIds.join(",")})`);
      if (skus.length > 0) orParts.push(`ebay_sku.in.(${skus.join(",")})`);

      const { data: cogsRows } =
        orParts.length > 0
          ? await supabase
              .from("listing_cogs")
              .select("ebay_listing_id, ebay_sku, cogs")
              .eq("user_id", user.id)
              .or(orParts.join(","))
          : { data: [] };

      // Build lookup map
      const cogsMap: Record<string, number> = {};
      for (const row of cogsRows ?? []) {
        if (row.ebay_listing_id)
          cogsMap[row.ebay_listing_id] = Number(row.cogs);
        if (row.ebay_sku) cogsMap[row.ebay_sku] = Number(row.cogs);
      }

      // 3. Merge into rows
      const merged: ListingRow[] = rawListings.map((l) => {
        const savedCogs =
          (l.listingId && cogsMap[l.listingId] != null
            ? cogsMap[l.listingId]
            : undefined) ??
          (l.sku && cogsMap[l.sku] != null ? cogsMap[l.sku] : undefined);
        return {
          listingId: l.listingId ?? l.sku ?? "",
          sku: l.sku ?? "",
          title: l.title ?? "Untitled",
          imageUrl: l.imageUrl ?? "",
          price: Number(l.price ?? 0),
          status: l.status ?? "ACTIVE",
          cogs: savedCogs,
          savedCogs,
          saving: false,
          dirty: false,
        };
      });

      setRows(merged);
    } catch (err) {
      console.error("BulkCogs load error:", err);
      toast.error("Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, [user, ebayToken]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Per-row COGS change ──────────────────────────────────────────────────

  const updateCogs = useCallback((listingId: string, value: string) => {
    const parsed = value === "" ? undefined : parseFloat(value);
    setRows((prev) =>
      prev.map((r) =>
        r.listingId === listingId
          ? {
              ...r,
              cogs: isNaN(parsed as number) ? undefined : parsed,
              dirty: true,
            }
          : r,
      ),
    );
  }, []);

  // ── Save a single row ────────────────────────────────────────────────────

  const saveRow = useCallback(
    async (row: ListingRow) => {
      if (!user) return;
      if (!row.dirty && row.cogs === row.savedCogs) return;

      setRows((prev) =>
        prev.map((r) =>
          r.listingId === row.listingId ? { ...r, saving: true } : r,
        ),
      );

      try {
        if (row.cogs == null) {
          // Delete the COGS record if user cleared the field
          await supabase
            .from("listing_cogs")
            .delete()
            .eq("user_id", user.id)
            .or(`ebay_listing_id.eq.${row.listingId},ebay_sku.eq.${row.sku}`);
        } else {
          await supabase.from("listing_cogs").upsert(
            {
              user_id: user.id,
              ebay_listing_id: row.listingId || null,
              ebay_sku: row.sku || null,
              title: row.title,
              cogs: row.cogs,
              cogs_source: "manual",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ebay_listing_id" },
          );
        }

        setRows((prev) =>
          prev.map((r) =>
            r.listingId === row.listingId
              ? { ...r, savedCogs: r.cogs, dirty: false, saving: false }
              : r,
          ),
        );
        setSavedCount((c) => c + 1);
      } catch (err) {
        console.error("Save COGS error:", err);
        toast.error(`Failed to save COGS for "${row.title}"`);
        setRows((prev) =>
          prev.map((r) =>
            r.listingId === row.listingId ? { ...r, saving: false } : r,
          ),
        );
      }
    },
    [user],
  );

  // ── Save ALL dirty rows ──────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    const dirty = rows.filter((r) => r.dirty);
    if (dirty.length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    for (const row of dirty) await saveRow(row);
    setSaving(false);
    toast.success(
      `Saved COGS for ${dirty.length} listing${dirty.length > 1 ? "s" : ""}`,
    );
  }, [rows, saveRow]);

  // ── Sort & filter ────────────────────────────────────────────────────────

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = rows
    .filter(
      (r) =>
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.sku.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") cmp = a.title.localeCompare(b.title);
      if (sortField === "price") cmp = a.price - b.price;
      if (sortField === "cogs") cmp = (a.cogs ?? -1) - (b.cogs ?? -1);
      if (sortField === "margin") {
        const ma = margin(a.price, a.cogs) ?? -999;
        const mb = margin(b.price, b.cogs) ?? -999;
        cmp = ma - mb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const dirtyCount = rows.filter((r) => r.dirty).length;

  // ── SortHeader helper ────────────────────────────────────────────────────

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`flex items-center gap-0.5 text-xs font-medium uppercase tracking-wide select-none ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : (
          <ChevronUp className="w-3 h-3 opacity-30" />
        )}
      </button>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!planFeatures.hasCogsTracking) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col items-center gap-4 text-center">
          <Lock className="w-10 h-10 text-muted-foreground" />
          <h1 className="text-xl font-bold">COGS Tracking — Pro & Shop Only</h1>
          <p className="text-muted-foreground text-sm">
            Upgrade to Pro or Shop to enter item costs and see true profit on
            every listing.
          </p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">
              Bulk COGS Editor
            </h1>
            <p className="text-xs text-muted-foreground">
              Enter item costs for all your active listings
            </p>
          </div>

          {dirtyCount > 0 && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
              {dirtyCount} unsaved
            </span>
          )}

          <button
            onClick={saveAll}
            disabled={saving || dirtyCount === 0}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-opacity"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save All
          </button>

          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh listings"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Search bar */}
        <div className="max-w-4xl mx-auto px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search listings by title or SKU…"
              className="w-full bg-card border border-border rounded-lg pl-8 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CSV Import Section */}
      {!loading && (
        <div className="max-w-4xl mx-auto px-4 py-4 border-b border-border/50">
          <details className="group">
            <summary className="cursor-pointer flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors">
              <ChevronRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
              Import COGS from CSV
            </summary>
            <div className="mt-4 pt-4 border-t border-border/50">
              <CsvCogsImporter userId={user?.id || ""} onSuccess={load} />
            </div>
          </details>
        </div>
      )}

      {/* Stats bar */}
      {!loading && rows.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground border-b border-border/50">
          <span>{rows.length} listings</span>
          <span>
            {rows.filter((r) => r.savedCogs != null).length} with COGS
          </span>
          <span>
            {rows.filter((r) => r.savedCogs == null).length} missing COGS
          </span>
          {savedCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 ml-auto">
              <CheckCircle2 className="w-3 h-3" />
              {savedCount} saved this session
            </span>
          )}
        </div>
      )}

      {/* Table header */}
      {!loading && filtered.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 pt-3">
          <div className="grid grid-cols-[auto_1fr_80px_100px_80px_36px] gap-2 items-center px-2 pb-1 border-b border-border/50">
            <div className="w-8" />
            <SortHeader field="title" label="Listing" />
            <SortHeader field="price" label="Price" />
            <SortHeader field="cogs" label="Item Cost" />
            <SortHeader field="margin" label="Margin" />
            <div />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="max-w-4xl mx-auto px-4 pt-1 space-y-0.5">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Loading your listings…</p>
          </div>
        ) : !ebayToken ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium">eBay account not connected</p>
            <p className="text-xs text-muted-foreground">
              Connect your eBay account in Settings to manage COGS.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Search className="w-8 h-8 opacity-40" />
            <p className="text-sm">
              {search
                ? "No listings match your search"
                : "No active listings found"}
            </p>
          </div>
        ) : (
          filtered.map((row) => (
            <ListingRowItem
              key={row.listingId}
              row={row}
              onChange={updateCogs}
              onBlur={saveRow}
            />
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}

// ── Row Component ──────────────────────────────────────────────────────────

function ListingRowItem({
  row,
  onChange,
  onBlur,
}: {
  row: ListingRow;
  onChange: (id: string, val: string) => void;
  onBlur: (row: ListingRow) => void;
}) {
  const estProfit =
    row.cogs != null && row.price > 0 ? row.price - row.cogs : null;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`grid grid-cols-[auto_1fr_80px_100px_80px_36px] gap-2 items-center py-2 px-2 rounded-lg transition-colors ${
        row.dirty ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-muted/40"
      }`}
    >
      {/* Thumbnail */}
      <div className="w-8 h-8 rounded overflow-hidden bg-muted shrink-0">
        {row.imageUrl ? (
          <img
            src={row.imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
      </div>

      {/* Title + SKU */}
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
          {row.title}
        </p>
        {row.sku && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            SKU: {row.sku}
          </p>
        )}
      </div>

      {/* Price */}
      <div className="text-xs font-medium text-foreground text-right">
        ${row.price.toFixed(2)}
      </div>

      {/* COGS input */}
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          $
        </span>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={row.cogs ?? ""}
          onChange={(e) => onChange(row.listingId, e.target.value)}
          onBlur={() => onBlur(row)}
          placeholder="0.00"
          className="w-full bg-card border border-border rounded pl-5 pr-1 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Margin */}
      <div className="flex items-center justify-end">
        <MarginBadge price={row.price} cogs={row.cogs} />
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center">
        {row.saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : row.dirty ? (
          <span className="w-2 h-2 rounded-full bg-amber-500" title="Unsaved" />
        ) : row.savedCogs != null ? (
          <CheckCircle2
            className="w-3.5 h-3.5 text-emerald-500"
            title="Saved"
          />
        ) : (
          <span
            className="w-2 h-2 rounded-full bg-muted-foreground/30"
            title="No COGS"
          />
        )}
      </div>
    </div>
  );
}
