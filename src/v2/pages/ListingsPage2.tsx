/**
 * ListingsPage2 — Manage eBay Listings
 *
 * Lets users view, search, and edit their active eBay listings:
 *   - Inline price editing (applies via ebay-reprice)
 *   - Quick link to edit full listing on eBay
 *   - Status, format, condition, quantity at a glance
 *   - Search + filter by status
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw, ExternalLink, Search, Package,
  Loader2, AlertCircle, DollarSign, Tag,
  Hash, Clock, CheckSquare, Square, X,
  Check, Pencil, LayoutList,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppShell from "@/v2/components/AppShell";
import { COLORS, cardStyle, inputStyle } from "@/v2/theme";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EbayListing {
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  quantity?: number;
  format?: string;
  condition?: string;
  listingId: string | null;
  ebayUrl: string | null;
  listingDate?: string | null;
  views30d: number;
  watchCount: number;
  transactions30d: number;
}

type FilterStatus = "all" | "active" | "inactive";

// ─── Helpers ────────────────────────────────────────────────────────────────

const BRAND = COLORS.brand;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const EBAY_TOKEN_KEY = "ebay-user-token";

function statusLabel(s: string) {
  if (s === "PUBLISHED" || s === "Active") return "Active";
  if (s === "UNPUBLISHED") return "Draft";
  return s;
}

function daysAgo(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1d ago";
  return `${diff}d ago`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: COLORS.pageBg,
  backgroundAttachment: "fixed",
  fontFamily: FONT,
};

const contentStyle: React.CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
  padding: "2rem 2rem 4rem",
};

const sectionCard: React.CSSProperties = {
  ...cardStyle,
  marginBottom: "1.25rem",
  overflow: "hidden",
};

const cardHeader: React.CSSProperties = {
  padding: "0.875rem 1.25rem",
  borderBottom: "1px solid #E8EEF5",
  background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const cardBody: React.CSSProperties = { padding: "1.25rem" };

const toggleGroup: React.CSSProperties = {
  display: "flex",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  overflow: "hidden",
};

const toggleBtn = (active: boolean): React.CSSProperties => ({
  padding: "0.375rem 0.75rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
  background: active ? BRAND : "transparent",
  color: active ? "#fff" : "#6E7580",
  transition: "all 0.15s",
});

const statusBadge = (s: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "0.15rem 0.5rem",
  borderRadius: 6,
  fontSize: "0.6875rem",
  fontWeight: 700,
  background: s === "Active" ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)",
  color: s === "Active" ? "#16a34a" : "#d97706",
});

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.2rem 0.5rem",
  borderRadius: 6,
  fontSize: "0.6875rem",
  fontWeight: 600,
  background: "rgba(0,118,182,0.06)",
  color: BRAND,
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ListingsPage2() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [ebayToken, setEbayToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  // Inline price editing
  const [editingPrice, setEditingPrice] = useState<string | null>(null); // listingId
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [savingPrice, setSavingPrice] = useState<Set<string>>(new Set());
  const [savedPrice, setSavedPrice] = useState<Set<string>>(new Set());

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── Fetch listings ────────────────────────────────────────────────────────

  const fetchListings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    // Step 1: get token
    let token: string | null = null;
    try {
      const { data: td } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_stored_token", userId: user.id },
      });
      if (td?.token) {
        token = td.token;
        localStorage.setItem(EBAY_TOKEN_KEY, token!);
      }
      if (td?.isExpired) {
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true); setListings([]); setLoading(false);
        toast.error("eBay session expired. Please reconnect in Settings.");
        return;
      }
    } catch { /* fall through */ }
    if (!token) token = localStorage.getItem(EBAY_TOKEN_KEY);
    if (!token) { setNeedsAuth(true); setLoading(false); return; }
    setEbayToken(token);

    // Step 2: fetch listings
    try {
      const { data, error } = await supabase.functions.invoke("ebay-listings", {
        body: { userToken: token },
      });
      if (error || data?.needsAuth) {
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true); setListings([]);
        toast.error("eBay connection expired. Please reconnect in Settings.");
        return;
      }
      const raw: EbayListing[] = data?.listings ?? [];
      setListings(raw);
      setNeedsAuth(false);
      toast.success(`${raw.length} listings loaded`);
    } catch {
      toast.error("Failed to load listings.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // ─── Filter ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let r = listings;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      r = r.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.sku.toLowerCase().includes(q) ||
        l.listingId?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") {
      r = r.filter(l =>
        filterStatus === "active"
          ? statusLabel(l.status) === "Active"
          : statusLabel(l.status) !== "Active"
      );
    }
    return r;
  }, [listings, searchQuery, filterStatus]);

  // ─── Inline price save ─────────────────────────────────────────────────────

  const handleSavePrice = async (listing: EbayListing) => {
    if (!listing.listingId || !ebayToken || !user?.id) return;
    const raw = priceInputs[listing.listingId];
    const newPrice = parseFloat(raw);
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error("Please enter a valid price");
      return;
    }
    if (Math.abs(newPrice - listing.price) < 0.01) {
      setEditingPrice(null);
      return;
    }
    const id = listing.listingId;
    setSavingPrice(prev => new Set([...prev, id]));
    try {
      const { data, error } = await supabase.functions.invoke("ebay-reprice", {
        body: {
          action: "single_update",
          userToken: ebayToken,
          userId: user.id,
          offerId: listing.offerId,
          sku: listing.sku,
          listingId: id,
          newPrice,
          currency: listing.currency || "USD",
        },
      });
      if (error || !data?.success) {
        toast.error(`Could not update price: ${data?.error || error?.message || "Unknown error"}`);
        return;
      }
      setListings(prev => prev.map(l => l.listingId === id ? { ...l, price: newPrice } : l));
      setSavedPrice(prev => new Set([...prev, id]));
      setTimeout(() => setSavedPrice(prev => { const n = new Set(prev); n.delete(id); return n; }), 2500);
      setEditingPrice(null);
      toast.success(`Price updated to $${newPrice.toFixed(2)} on eBay`);
    } finally {
      setSavingPrice(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // ─── Select helpers ────────────────────────────────────────────────────────

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  const toggleSelectAll = () =>
    setSelectedIds(
      selectedIds.size === filtered.length
        ? new Set()
        : new Set(filtered.map(l => l.listingId ?? l.sku))
    );

  const activeCount = listings.filter(l => statusLabel(l.status) === "Active").length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div style={pageStyle}>
        <div style={contentStyle}>

          {/* Page Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#141820", margin: 0, letterSpacing: "-0.03em" }}>
                Listings
              </h1>
              <p style={{ fontSize: "0.9375rem", color: "#6E7580", marginTop: "0.25rem" }}>
                {loading ? "Loading…" : `${activeCount} active · ${listings.length} total`}
              </p>
            </div>
            <button
              onClick={fetchListings}
              disabled={loading}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.625rem 1.125rem",
                background: "#ffffff", border: `1px solid ${COLORS.border}`,
                borderRadius: 10, fontSize: "0.875rem", fontWeight: 600,
                color: "#141820", cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>

          {/* eBay not connected */}
          {needsAuth && (
            <div style={{ ...sectionCard, background: "rgba(251,146,60,0.04)", borderTop: "3px solid #fb923c", display: "flex", gap: "1rem", padding: "1rem 1.25rem" }}>
              <AlertCircle size={20} style={{ color: "#f97316", flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820" }}>eBay not connected</div>
                <div style={{ fontSize: "0.8125rem", color: "#6E7580", marginTop: "0.25rem" }}>
                  Connect your eBay account in Settings to manage listings.{" "}
                  <button onClick={() => navigate("/settings?tab=integrations")} style={{ color: BRAND, fontWeight: 600, cursor: "pointer", border: "none", background: "none" }}>
                    Go to Integrations →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Listings Section */}
          {loading && listings.length === 0 ? (
            <div style={{ ...sectionCard, padding: "3rem", textAlign: "center", color: "#6E7580" }}>
              <Loader2 size={28} style={{ margin: "0 auto 0.75rem", display: "block", animation: "spin 1s linear infinite" }} />
              Loading listings…
            </div>
          ) : listings.length > 0 ? (
            <div style={sectionCard}>
              {/* Header */}
              <div style={cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <LayoutList size={16} style={{ color: BRAND }} />
                  <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>eBay Listings</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, padding: "0.2rem 0.5rem", borderRadius: 12, background: "rgba(0,118,182,0.08)", color: BRAND }}>
                    {filtered.length}{filtered.length !== listings.length ? ` / ${listings.length}` : ""}
                  </span>
                </div>
                {/* Status filter */}
                <div style={toggleGroup}>
                  {(["all", "active", "inactive"] as FilterStatus[]).map(s => (
                    <button key={s} style={toggleBtn(filterStatus === s)} onClick={() => setFilterStatus(s)}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div style={cardBody}>
                {/* Search */}
                <div style={{ position: "relative", marginBottom: "0.75rem" }}>
                  <Search size={14} style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#9BA3AD" }} />
                  <input
                    type="text"
                    placeholder="Search title, SKU, listing ID…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{ ...inputStyle, width: "100%", padding: "0.5rem 0.75rem 0.5rem 2rem", fontSize: "0.875rem" }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9BA3AD" }}>
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Select all */}
                {filtered.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                    <button onClick={toggleSelectAll} style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "#6E7580" }}>
                      {selectedIds.size === filtered.length && filtered.length > 0
                        ? <CheckSquare size={15} style={{ color: BRAND }} />
                        : <Square size={15} />}
                      {selectedIds.size === filtered.length && filtered.length > 0 ? "Deselect all" : `Select all (${filtered.length})`}
                    </button>
                    {selectedIds.size > 0 && (
                      <span style={{ fontSize: "0.8125rem", color: "#9BA3AD" }}>· {selectedIds.size} selected</span>
                    )}
                  </div>
                )}

                {/* Listing rows */}
                {filtered.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2.5rem", color: "#6E7580" }}>
                    <Package size={32} style={{ margin: "0 auto 0.75rem", opacity: 0.3, display: "block" }} />
                    {searchQuery || filterStatus !== "all" ? "No listings match your filters." : "No listings found."}
                  </div>
                ) : (
                  filtered.map(listing => {
                    const id = listing.listingId ?? listing.sku;
                    const selected = selectedIds.has(id);
                    const slabel = statusLabel(listing.status);
                    const isEditing = editingPrice === listing.listingId;
                    const isSaving = savingPrice.has(listing.listingId ?? "");
                    const wasSaved = savedPrice.has(listing.listingId ?? "");

                    return (
                      <div
                        key={id}
                        style={{
                          background: selected ? "rgba(0,118,182,0.04)" : "#ffffff",
                          border: `1px solid ${selected ? BRAND : "#E8EEF5"}`,
                          borderRadius: 12,
                          padding: "1rem",
                          display: "flex",
                          gap: "0.875rem",
                          marginBottom: "0.75rem",
                          transition: "all 0.15s",
                        }}
                      >
                        {/* Checkbox */}
                        <button onClick={() => toggleSelect(id)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: selected ? BRAND : "#9BA3AD", alignSelf: "flex-start", marginTop: 2 }}>
                          {selected ? <CheckSquare size={15} style={{ color: BRAND }} /> : <Square size={15} />}
                        </button>

                        {/* Image */}
                        {listing.imageUrl ? (
                          <img src={listing.imageUrl} alt={listing.title} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 72, height: 72, borderRadius: 10, background: "#EFF2F5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Package size={24} style={{ color: "#9BA3AD" }} />
                          </div>
                        )}

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Title + status */}
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.375rem" }}>
                            <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", flex: 1, minWidth: 0 }}>
                              {listing.title}
                            </span>
                            <span style={statusBadge(slabel)}>{slabel}</span>
                          </div>

                          {/* Price editor + eBay link */}
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                            {isEditing ? (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                                <div style={{ position: "relative" }}>
                                  <span style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "#6E7580", fontSize: "0.875rem", pointerEvents: "none" }}>$</span>
                                  <input
                                    autoFocus
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={priceInputs[listing.listingId ?? ""] ?? listing.price.toFixed(2)}
                                    onChange={e => setPriceInputs(prev => ({ ...prev, [listing.listingId ?? ""]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === "Enter") handleSavePrice(listing); if (e.key === "Escape") setEditingPrice(null); }}
                                    style={{ ...inputStyle, width: 90, paddingLeft: "1.375rem", paddingRight: "0.5rem", fontSize: "0.875rem", fontWeight: 700 }}
                                  />
                                </div>
                                <button
                                  onClick={() => handleSavePrice(listing)}
                                  disabled={isSaving}
                                  style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.375rem 0.625rem", background: BRAND, color: "#fff", border: "none", borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}
                                >
                                  {isSaving ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={12} />}
                                  Save
                                </button>
                                <button onClick={() => setEditingPrice(null)} style={{ padding: "0.375rem", background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 7, cursor: "pointer", color: "#6E7580" }}>
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span style={{ fontSize: "1rem", fontWeight: 800, color: wasSaved ? "#16a34a" : BRAND }}>
                                  ${listing.price.toFixed(2)}
                                </span>
                                {wasSaved && <span style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>✓ Saved</span>}
                                {listing.listingId && (
                                  <button
                                    onClick={() => {
                                      setEditingPrice(listing.listingId);
                                      setPriceInputs(prev => ({ ...prev, [listing.listingId!]: listing.price.toFixed(2) }));
                                    }}
                                    style={{ display: "flex", alignItems: "center", gap: "0.2rem", padding: "0.25rem 0.5rem", background: "rgba(0,118,182,0.06)", border: `1px solid rgba(0,118,182,0.15)`, borderRadius: 6, fontSize: "0.75rem", fontWeight: 600, color: BRAND, cursor: "pointer" }}
                                    title="Edit price on eBay"
                                  >
                                    <Pencil size={11} /> Edit Price
                                  </button>
                                )}
                              </div>
                            )}

                            {listing.ebayUrl && (
                              <a href={listing.ebayUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.8125rem", color: BRAND, textDecoration: "none" }}>
                                <ExternalLink size={12} /> View on eBay
                              </a>
                            )}
                            {listing.listingId && (
                              <a
                                href={`https://www.ebay.com/sh/lst/active?listingIds=${listing.listingId}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.8125rem", color: "#6E7580", textDecoration: "none" }}
                                title="Edit this listing on eBay Seller Hub"
                              >
                                <Pencil size={12} /> Edit on eBay
                              </a>
                            )}
                          </div>

                          {/* Pills */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.375rem" }}>
                            {listing.views30d > 0 && (
                              <span style={pillStyle}>👁 {listing.views30d.toLocaleString()} views (30d)</span>
                            )}
                            {listing.watchCount > 0 && (
                              <span style={pillStyle}>♥ {listing.watchCount} watchers</span>
                            )}
                            {listing.transactions30d > 0 && (
                              <span style={pillStyle}>🛒 {listing.transactions30d} sold (30d)</span>
                            )}
                            {listing.quantity != null && listing.quantity > 1 && (
                              <span style={{ ...pillStyle, background: "rgba(110,117,128,0.07)", color: "#6E7580" }}>
                                Qty: {listing.quantity}
                              </span>
                            )}
                          </div>

                          {/* Meta */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.75rem", color: "#9BA3AD" }}>
                            {listing.sku && listing.sku !== listing.listingId && (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                <Hash size={10} /> {listing.sku}
                              </span>
                            )}
                            {listing.format && (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                <Tag size={10} /> {listing.format === "FIXED_PRICE" ? "BIN" : listing.format === "AUCTION" ? "Auction" : listing.format}
                              </span>
                            )}
                            {listing.condition && <span>{listing.condition}</span>}
                            {listing.listingDate && (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                <Clock size={10} /> Listed {daysAgo(listing.listingDate)}
                              </span>
                            )}
                            {listing.listingId && (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                <Hash size={10} /> ID: {listing.listingId}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : !needsAuth && !loading ? (
            <div style={{ ...sectionCard, padding: "3rem", textAlign: "center", color: "#6E7580" }}>
              <Package size={40} style={{ margin: "0 auto 1rem", display: "block", opacity: 0.25 }} />
              <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", marginBottom: "0.25rem" }}>No listings found</p>
              <p style={{ fontSize: "0.8125rem" }}>Your eBay listings will appear here once connected.</p>
            </div>
          ) : null}

        </div>
      </div>
    </AppShell>
  );
}