/**
 * ListingDetailModal — Full listing detail panel
 *
 * Opens when a user clicks a listing row on the Listings page.
 * Shows:
 *   1. Header — image, title, status, price, eBay links
 *   2. Listing Timeline — listed date, days on market, ID, SKU, format, condition
 *   3. COGS Panel — most critical section; shows cost, profit, margin with inline edit/add
 *   4. Performance — views/impressions/transactions across 7d/30d/90d windows
 *   5. Offer Decision Helper — quick accept/counter/decline guidance when COGS is known
 */

import { useState, useEffect, useRef } from "react";
import {
  X, ExternalLink, Pencil, Package, Clock, Hash, Tag,
  DollarSign, TrendingUp, TrendingDown, AlertCircle,
  Eye, BarChart2, ShoppingCart, Heart, Check, Loader2,
  CheckCircle, XCircle, HelpCircle, ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { COLORS, SHADOWS, inputStyle } from "@/v2/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListingDetailData {
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
  views7d: number;
  views30d: number;
  views90d: number;
  impressions7d: number;
  impressions30d: number;
  impressions90d: number;
  clickThroughRate: number;
  salesConversionRate: number;
  watchCount: number;
  transactions7d: number;
  transactions30d: number;
  transactions90d: number;
  questionCount?: number;
}

interface CogsRecord {
  id?: string;
  cogs: number;
  cogs_source: string;
  acquired_at?: string | null;
  title?: string;
}

interface ListingDetailModalProps {
  listing: ListingDetailData;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BRAND = COLORS.brand;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function statusLabel(s: string) {
  if (s === "PUBLISHED" || s === "Active") return "Active";
  if (s === "UNPUBLISHED") return "Draft";
  return s;
}

function daysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} week${Math.floor(diff / 7) > 1 ? "s" : ""} ago`;
  if (diff < 365) return `${Math.floor(diff / 30)} month${Math.floor(diff / 30) > 1 ? "s" : ""} ago`;
  return `${Math.floor(diff / 365)} year${Math.floor(diff / 365) > 1 ? "s" : ""} ago`;
}

function daysOnMarket(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.5rem",
      fontSize: "0.75rem", fontWeight: 700, color: COLORS.textMuted,
      textTransform: "uppercase", letterSpacing: "0.06em",
      marginBottom: "0.75rem",
    }}>
      {icon}
      {title}
    </div>
  );
}

function StatCell({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "#f7fafd", border: "1px solid #E8EEF5", borderRadius: 10,
      padding: "0.75rem 1rem", minWidth: 0,
    }}>
      <div style={{ fontSize: "0.6875rem", color: COLORS.textMuted, fontWeight: 600, marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.125rem", fontWeight: 800, color: color || COLORS.textPrimary, lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "0.6875rem", color: COLORS.textSubtle, marginTop: "0.2rem" }}>{sub}</div>}
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", padding: "0.5rem 0", borderBottom: "1px solid #F0F4F8" }}>
      <span style={{ color: COLORS.textMuted, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: COLORS.textMuted, minWidth: 90, flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <span style={{ color: COLORS.textPrimary, fontWeight: 600, flex: 1, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function ListingDetailModal({ listing, onClose }: ListingDetailModalProps) {
  const { user } = useAuth();
  const overlayRef = useRef<HTMLDivElement>(null);

  // COGS state
  const [cogsRecord, setCogsRecord] = useState<CogsRecord | null>(null);
  const [cogsLoading, setCogsLoading] = useState(true);
  const [editingCogs, setEditingCogs] = useState(false);
  const [cogsInput, setCogsInput] = useState("");
  const [cogsSaving, setCogsSaving] = useState(false);

  // Offer evaluation state
  const [offerInput, setOfferInput] = useState("");

  const slabel = statusLabel(listing.status);
  const dom = daysOnMarket(listing.listingDate);

  // ─── Load COGS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    loadCogs();
  }, [user?.id, listing.sku, listing.listingId]);

  async function loadCogs() {
    setCogsLoading(true);
    try {
      // ── SKU normalization ──────────────────────────────────────────────────
      // eBay API returns SKUs in the format they were submitted, but may
      // lowercase them. The app stores SKUs as e.g. "LA-ED5BB0BC7F394C2A"
      // (uppercase, with dash) but eBay returns "laED5BB0BC7F394C2A".
      // Build all candidate forms so we match regardless of case/dash.
      const rawSku = listing.sku ?? "";
      const skuCandidates = new Set<string>();
      if (rawSku) {
        skuCandidates.add(rawSku);
        skuCandidates.add(rawSku.toUpperCase());
        skuCandidates.add(rawSku.toLowerCase());
        const up = rawSku.toUpperCase();
        // Add dash after 2-char prefix if missing: "LAXXXXX" -> "LA-XXXXX"
        if (up.length > 2 && up[2] !== "-") {
          skuCandidates.add(up.slice(0, 2) + "-" + up.slice(2));
        }
        // Remove dash if present: "LA-XXXXX" -> "LAXXXXX"
        skuCandidates.add(up.replace(/-/g, ""));
      }
      const skuList = Array.from(skuCandidates).filter(Boolean);

      // ── 1. Try listing_cogs table (preferred — survives draft deletion) ──
      if (skuList.length > 0 || listing.listingId) {
        const orParts: string[] = [];
        if (skuList.length > 0) orParts.push(`ebay_sku.in.(${skuList.join(",")})`);
        if (listing.listingId)  orParts.push(`ebay_listing_id.eq.${listing.listingId}`);

        const { data: cogsRows, error: cogsErr } = await supabase
          .from("listing_cogs")
          .select("id, cogs, cogs_source, acquired_at, title")
          .eq("user_id", user!.id)
          .or(orParts.join(","))
          .order("created_at", { ascending: false })
          .limit(1);

        console.log("[ListingDetailModal] listing_cogs ->", { cogsRows, cogsErr, skuList, listingId: listing.listingId });

        const row = cogsRows?.[0];
        if (row) {
          setCogsRecord({
            id: row.id,
            cogs: Number(row.cogs),
            cogs_source: row.cogs_source ?? "manual",
            acquired_at: row.acquired_at,
            title: row.title,
          });
          setCogsInput(String(Number(row.cogs)));
          setCogsLoading(false);
          return;
        }
      }

      // ── 2. Fall back to drafts table (COGS set at analysis time) ──
      if (skuList.length > 0 || listing.listingId) {
        const orParts: string[] = [];
        if (skuList.length > 0) orParts.push(`ebay_sku.in.(${skuList.join(",")})`);
        if (listing.listingId)  orParts.push(`ebay_listing_id.eq.${listing.listingId}`);

        const { data: draftRows, error: draftErr } = await supabase
          .from("drafts")
          .select("cogs, cogs_source, cogs_acquired_at, ebay_sku")
          .eq("user_id", user!.id)
          .not("cogs", "is", null)
          .or(orParts.join(","))
          .order("created_at", { ascending: false })
          .limit(1);

        console.log("[ListingDetailModal] drafts fallback ->", { draftRows, draftErr, skuList });

        const draft = draftRows?.[0];
        if (draft?.cogs != null) {
          setCogsRecord({
            cogs: Number(draft.cogs),
            cogs_source: draft.cogs_source ?? "draft",
            acquired_at: draft.cogs_acquired_at,
          });
          setCogsInput(String(Number(draft.cogs)));
        }
      }
    } catch (e) {
      console.warn("ListingDetailModal: COGS load error", e);
    } finally {
      setCogsLoading(false);
    }
  }

  // ─── Save COGS ─────────────────────────────────────────────────────────────
  async function saveCogs() {
    if (!user?.id) return;
    const val = parseFloat(cogsInput);
    if (isNaN(val) || val < 0) {
      toast.error("Please enter a valid cost (0 or more)");
      return;
    }

    setCogsSaving(true);
    try {
      if (cogsRecord?.id) {
        // Update existing listing_cogs row by id
        const { error } = await supabase
          .from("listing_cogs")
          .update({ cogs: val, cogs_source: "manual" })
          .eq("id", cogsRecord.id)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        // Insert new row — no unique constraint on listing_cogs so use insert
        const { data, error } = await supabase
          .from("listing_cogs")
          .insert({
            user_id: user.id,
            ebay_sku: listing.sku || null,
            ebay_listing_id: listing.listingId || null,
            title: listing.title,
            cogs: val,
            cogs_source: "manual",
          })
          .select("id")
          .limit(1);
        if (error) throw error;
        const newId = data?.[0]?.id;
        if (newId) {
          setCogsRecord(prev => ({ ...(prev ?? { cogs_source: "manual" }), id: newId }));
        }
      }

      setCogsRecord(prev => ({ ...(prev ?? { cogs_source: "manual" }), cogs: val }));
      setCogsInput(String(val));
      setEditingCogs(false);
      toast.success(`COGS saved: $${fmt(val)}`);
    } catch (e: any) {
      toast.error(`Could not save COGS: ${e?.message || "Unknown error"}`);
    } finally {
      setCogsSaving(false);
    }
  }

  // ─── Keyboard / click-outside close ───────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  // ─── Derived profit numbers ────────────────────────────────────────────────
  const cogs = cogsRecord?.cogs ?? null;
  const price = listing.price;
  const grossProfit = cogs != null ? price - cogs : null;
  const margin = grossProfit != null && price > 0 ? (grossProfit / price) * 100 : null;

  // Estimated eBay fees (~13.25% for most categories + $0.30 fixed)
  const estFees = price * 0.1325 + 0.30;
  const netProfit = cogs != null ? price - cogs - estFees : null;
  const netMargin = netProfit != null && price > 0 ? (netProfit / price) * 100 : null;

  // Offer evaluator
  const offerVal = parseFloat(offerInput);
  const offerNetProfit = !isNaN(offerVal) && cogs != null
    ? offerVal - cogs - (offerVal * 0.1325 + 0.30)
    : null;
  const offerMargin = offerNetProfit != null && offerVal > 0
    ? (offerNetProfit / offerVal) * 100
    : null;

  // Profit color helper
  function profitColor(val: number | null): string {
    if (val === null) return COLORS.textMuted;
    if (val > 0) return COLORS.success;
    if (val === 0) return COLORS.amber;
    return COLORS.danger;
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(10,20,40,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "2rem 1rem",
        overflowY: "auto",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 20,
          width: "100%",
          maxWidth: 680,
          boxShadow: "0 24px 80px rgba(0,30,80,0.22), 0 4px 16px rgba(0,0,0,0.08)",
          overflow: "hidden",
          position: "relative",
          marginBottom: "2rem",
        }}
      >
        {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
        <div style={{
          background: "linear-gradient(135deg, #0076B6 0%, #0056a3 100%)",
          padding: "1.5rem",
          position: "relative",
        }}>
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: "1rem", right: "1rem",
              background: "rgba(255,255,255,0.15)", border: "none",
              borderRadius: 8, width: 32, height: 32,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#fff",
              transition: "background 0.15s",
            }}
            title="Close"
          >
            <X size={16} />
          </button>

          <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
            {/* Thumbnail */}
            {listing.imageUrl ? (
              <img
                src={listing.imageUrl}
                alt={listing.title}
                style={{
                  width: 88, height: 88, borderRadius: 12,
                  objectFit: "cover", flexShrink: 0,
                  border: "2px solid rgba(255,255,255,0.25)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                }}
              />
            ) : (
              <div style={{
                width: 88, height: 88, borderRadius: 12, flexShrink: 0,
                background: "rgba(255,255,255,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px solid rgba(255,255,255,0.15)",
              }}>
                <Package size={32} style={{ color: "rgba(255,255,255,0.5)" }} />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0, paddingRight: "2.5rem" }}>
              {/* Status badge */}
              <span style={{
                display: "inline-block",
                padding: "0.15rem 0.5rem",
                borderRadius: 6,
                fontSize: "0.6875rem",
                fontWeight: 700,
                background: slabel === "Active" ? "rgba(34,197,94,0.25)" : "rgba(251,191,36,0.25)",
                color: slabel === "Active" ? "#86efac" : "#fde68a",
                marginBottom: "0.4rem",
              }}>
                {slabel}
              </span>

              {/* Title */}
              <h2 style={{
                fontSize: "1rem", fontWeight: 700, color: "#fff",
                margin: "0 0 0.5rem", lineHeight: 1.35,
                wordBreak: "break-word",
              }}>
                {listing.title}
              </h2>

              {/* Price */}
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "1.5rem", fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>
                  ${fmt(price)}
                </span>
                {listing.ebayUrl && (
                  <a
                    href={listing.ebayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      fontSize: "0.8125rem", color: "rgba(255,255,255,0.85)",
                      textDecoration: "none", fontWeight: 600,
                      background: "rgba(255,255,255,0.12)", borderRadius: 6,
                      padding: "0.25rem 0.625rem",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}
                  >
                    <ExternalLink size={11} /> View on eBay
                  </a>
                )}
                {listing.listingId && (
                  <a
                    href={`https://www.ebay.com/sh/lst/active?listingIds=${listing.listingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      fontSize: "0.8125rem", color: "rgba(255,255,255,0.75)",
                      textDecoration: "none", fontWeight: 600,
                      background: "rgba(255,255,255,0.08)", borderRadius: 6,
                      padding: "0.25rem 0.625rem",
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  >
                    <Pencil size={11} /> Edit on eBay
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ BODY ══════════════════════════════════════════════════════════ */}
        <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ─── Section 1: Listing Details ─────────────────────────────── */}
          <div>
            <SectionHeader title="Listing Details" icon={<Clock size={13} />} />
            <div style={{ background: "#f7fafd", border: "1px solid #E8EEF5", borderRadius: 12, overflow: "hidden" }}>
              {listing.listingDate && (
                <MetaRow
                  icon={<Clock size={13} />}
                  label="Listed"
                  value={
                    <span>
                      {daysAgo(listing.listingDate)}
                      {dom !== null && (
                        <span style={{ fontSize: "0.75rem", color: COLORS.textMuted, fontWeight: 400, marginLeft: "0.4rem" }}>
                          ({dom} day{dom !== 1 ? "s" : ""} on market)
                        </span>
                      )}
                    </span>
                  }
                />
              )}
              {listing.sku && (
                <MetaRow
                  icon={<Hash size={13} />}
                  label="SKU"
                  value={<span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{listing.sku}</span>}
                />
              )}
              {listing.listingId && (
                <MetaRow
                  icon={<Hash size={13} />}
                  label="Listing ID"
                  value={<span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{listing.listingId}</span>}
                />
              )}
              {listing.format && (
                <MetaRow
                  icon={<Tag size={13} />}
                  label="Format"
                  value={listing.format === "FIXED_PRICE" ? "Buy It Now" : listing.format === "AUCTION" ? "Auction" : listing.format}
                />
              )}
              {listing.condition && (
                <MetaRow
                  icon={<CheckCircle size={13} />}
                  label="Condition"
                  value={listing.condition}
                />
              )}
              {listing.quantity != null && (
                <MetaRow
                  icon={<Package size={13} />}
                  label="Quantity"
                  value={listing.quantity}
                />
              )}
            </div>
          </div>

          {/* ─── Section 2: COGS & Profit (MOST IMPORTANT) ──────────────── */}
          <div>
            <SectionHeader title="Cost & Profit" icon={<DollarSign size={13} />} />

            {cogsLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "1.5rem", background: "#f7fafd", borderRadius: 12, color: COLORS.textMuted, fontSize: "0.875rem" }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                Looking up COGS…
              </div>
            ) : cogs === null || !cogsRecord ? (
              /* ── No COGS assigned ── */
              <div style={{
                background: "rgba(245,158,11,0.05)",
                border: "1.5px solid rgba(245,158,11,0.35)",
                borderRadius: 12,
                padding: "1.25rem",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "1rem" }}>
                  <AlertCircle size={20} style={{ color: COLORS.amber, flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 700, color: COLORS.textPrimary, fontSize: "0.9375rem" }}>
                      No COGS assigned
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: COLORS.textMuted, marginTop: "0.2rem" }}>
                      Without a cost of goods, you can't calculate your true profit or evaluate offers intelligently.
                    </div>
                  </div>
                </div>

                {!editingCogs ? (
                  <button
                    onClick={() => { setEditingCogs(true); setCogsInput(""); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.4rem",
                      padding: "0.5rem 1rem",
                      background: BRAND, color: "#fff",
                      border: "none", borderRadius: 8,
                      fontSize: "0.875rem", fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(0,118,182,0.25)",
                    }}
                  >
                    <DollarSign size={14} /> Add COGS
                  </button>
                ) : (
                  <CogsEditForm
                    value={cogsInput}
                    onChange={setCogsInput}
                    onSave={saveCogs}
                    onCancel={() => setEditingCogs(false)}
                    saving={cogsSaving}
                    listingPrice={price}
                  />
                )}
              </div>
            ) : (
              /* ── COGS assigned ── */
              <div>
                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem", marginBottom: "0.75rem" }}>
                  <StatCell
                    label="Your Cost"
                    value={`$${fmt(cogs)}`}
                    sub={cogsRecord.cogs_source === "draft" ? "from draft" : "manual"}
                    color={COLORS.textPrimary}
                  />
                  <StatCell
                    label="Gross Profit"
                    value={grossProfit !== null ? `${grossProfit >= 0 ? "+" : ""}$${fmt(grossProfit)}` : "—"}
                    sub={margin !== null ? `${fmt(margin, 1)}% margin` : undefined}
                    color={profitColor(grossProfit)}
                  />
                  <StatCell
                    label="Est. Net Profit"
                    value={netProfit !== null ? `${netProfit >= 0 ? "+" : ""}$${fmt(netProfit)}` : "—"}
                    sub={netMargin !== null ? `${fmt(netMargin, 1)}% net margin` : "after ~13.25% fees"}
                    color={profitColor(netProfit)}
                  />
                </div>

                {/* Profit indicator bar */}
                {netProfit !== null && price > 0 && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <div style={{ height: 6, background: "#EFF2F5", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.min(100, Math.max(0, ((price - cogs) / price) * 100))}%`,
                        background: netProfit > 0
                          ? "linear-gradient(90deg, #22c55e, #16a34a)"
                          : "linear-gradient(90deg, #ef4444, #dc2626)",
                        borderRadius: 99,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", color: COLORS.textSubtle, marginTop: "0.25rem" }}>
                      <span>Cost: ${fmt(cogs)}</span>
                      <span>eBay fees: ~${fmt(estFees)}</span>
                      <span>List price: ${fmt(price)}</span>
                    </div>
                  </div>
                )}

                {/* Decision callout */}
                {netProfit !== null && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.625rem 0.875rem",
                    borderRadius: 8,
                    background: netProfit > 0 ? COLORS.successBg : netProfit === 0 ? COLORS.amberBg : COLORS.dangerBg,
                    border: `1px solid ${netProfit > 0 ? COLORS.successBorder : netProfit === 0 ? COLORS.amberBorder : COLORS.dangerBorder}`,
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: netProfit > 0 ? COLORS.success : netProfit === 0 ? COLORS.amber : COLORS.danger,
                    marginBottom: "0.75rem",
                  }}>
                    {netProfit > 0
                      ? <><CheckCircle size={14} /> At list price you net ${fmt(netProfit)} (after eBay fees)</>
                      : netProfit === 0
                      ? <><HelpCircle size={14} /> Breaking even at list price</>
                      : <><XCircle size={14} /> Selling at list price loses ${fmt(Math.abs(netProfit))}</>
                    }
                  </div>
                )}

                {/* Edit COGS */}
                {!editingCogs ? (
                  <button
                    onClick={() => { setEditingCogs(true); setCogsInput(String(cogs)); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "0.375rem 0.75rem",
                      background: "rgba(0,118,182,0.06)",
                      border: "1px solid rgba(0,118,182,0.18)",
                      borderRadius: 7, fontSize: "0.8125rem", fontWeight: 600,
                      color: BRAND, cursor: "pointer",
                    }}
                  >
                    <Pencil size={12} /> Edit COGS
                  </button>
                ) : (
                  <div style={{ marginTop: "0.5rem" }}>
                    <CogsEditForm
                      value={cogsInput}
                      onChange={setCogsInput}
                      onSave={saveCogs}
                      onCancel={() => setEditingCogs(false)}
                      saving={cogsSaving}
                      listingPrice={price}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Section 3: Offer Evaluator (only shown when COGS known) ─── */}
          {cogs !== null && cogsRecord && (
            <div>
              <SectionHeader title="Evaluate an Offer" icon={<ChevronRight size={13} />} />
              <div style={{
                background: "#f7fafd", border: "1px solid #E8EEF5",
                borderRadius: 12, padding: "1.25rem",
              }}>
                <div style={{ fontSize: "0.8125rem", color: COLORS.textMuted, marginBottom: "0.75rem" }}>
                  Got an offer on eBay? Enter the amount to see if you should accept it.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: COLORS.textMuted, fontSize: "0.875rem", pointerEvents: "none" }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Offer amount"
                      value={offerInput}
                      onChange={e => setOfferInput(e.target.value)}
                      style={{ ...inputStyle, width: 140, paddingLeft: "1.5rem", paddingRight: "0.75rem", fontSize: "0.875rem" }}
                    />
                  </div>
                  {offerVal > 0 && offerNetProfit !== null && (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: "0.4rem",
                      padding: "0.375rem 0.875rem",
                      borderRadius: 8,
                      background: offerNetProfit > 0 ? COLORS.successBg : offerNetProfit === 0 ? COLORS.amberBg : COLORS.dangerBg,
                      border: `1px solid ${offerNetProfit > 0 ? COLORS.successBorder : offerNetProfit === 0 ? COLORS.amberBorder : COLORS.dangerBorder}`,
                      fontSize: "0.875rem", fontWeight: 700,
                      color: offerNetProfit > 0 ? COLORS.success : offerNetProfit === 0 ? COLORS.amber : COLORS.danger,
                    }}>
                      {offerNetProfit > 0
                        ? <><CheckCircle size={14} /> Accept — net ${fmt(offerNetProfit)} ({fmt(offerMargin!, 1)}% margin)</>
                        : offerNetProfit === 0
                        ? <><HelpCircle size={14} /> Break even</>
                        : <><XCircle size={14} /> Decline — lose ${fmt(Math.abs(offerNetProfit))}</>
                      }
                    </div>
                  )}
                </div>

                {/* Break-even callout */}
                {cogs !== null && (
                  <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: COLORS.textMuted }}>
                    Break-even offer price: <strong style={{ color: COLORS.textPrimary }}>${fmt((cogs + 0.30) / (1 - 0.1325))}</strong>
                    <span style={{ marginLeft: "0.4rem" }}>(covers cost + eBay fees)</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Section 4: Performance ──────────────────────────────────── */}
          <div>
            <SectionHeader title="Performance" icon={<BarChart2 size={13} />} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem", marginBottom: "0.625rem" }}>
              <StatCell label="Views 7d" value={listing.views7d.toLocaleString()} />
              <StatCell label="Views 30d" value={listing.views30d.toLocaleString()} />
              <StatCell label="Views 90d" value={listing.views90d.toLocaleString()} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem" }}>
              <StatCell
                label="Impressions 30d"
                value={listing.impressions30d.toLocaleString()}
                sub="search appearances"
                color={COLORS.textMuted}
              />
              <StatCell
                label="Watchers"
                value={listing.watchCount}
                color={listing.watchCount > 0 ? COLORS.brand : COLORS.textMuted}
              />
              <StatCell
                label="Sold (30d)"
                value={listing.transactions30d}
                sub={listing.transactions90d > 0 ? `${listing.transactions90d} in 90d` : undefined}
                color={listing.transactions30d > 0 ? COLORS.success : COLORS.textMuted}
              />
            </div>

            {/* CTR / Conversion if non-zero */}
            {(listing.clickThroughRate > 0 || listing.salesConversionRate > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.625rem", marginTop: "0.625rem" }}>
                {listing.clickThroughRate > 0 && (
                  <StatCell
                    label="Click-Through Rate"
                    value={`${(listing.clickThroughRate * 100).toFixed(2)}%`}
                    sub="clicks ÷ impressions"
                    color={COLORS.textMuted}
                  />
                )}
                {listing.salesConversionRate > 0 && (
                  <StatCell
                    label="Conversion Rate"
                    value={`${(listing.salesConversionRate * 100).toFixed(2)}%`}
                    sub="sales ÷ views"
                    color={COLORS.textMuted}
                  />
                )}
              </div>
            )}
          </div>

        </div>

        {/* ═══ FOOTER ════════════════════════════════════════════════════════ */}
        <div style={{
          padding: "1rem 1.5rem",
          background: "#f7fafd",
          borderTop: "1px solid #E8EEF5",
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.75rem",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1.25rem",
              background: "#fff",
              border: "1px solid #D8E4EF",
              borderRadius: 8,
              fontSize: "0.875rem",
              fontWeight: 600,
              color: COLORS.textMuted,
              cursor: "pointer",
            }}
          >
            Close
          </button>
          {listing.ebayUrl && (
            <a
              href={listing.ebayUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                padding: "0.5rem 1.25rem",
                background: BRAND, color: "#fff",
                borderRadius: 8, border: "none",
                fontSize: "0.875rem", fontWeight: 600,
                textDecoration: "none",
                boxShadow: "0 2px 8px rgba(0,118,182,0.25)",
              }}
            >
              <ExternalLink size={13} /> View on eBay
            </a>
          )}
        </div>
      </div>

      {/* Spin keyframe */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── CogsEditForm sub-component ───────────────────────────────────────────────

function CogsEditForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  listingPrice,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  listingPrice: number;
}) {
  const val = parseFloat(value);
  const preview = !isNaN(val) && listingPrice > 0 ? listingPrice - val : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: COLORS.textMuted, fontSize: "0.875rem", pointerEvents: "none" }}>$</span>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
            style={{ ...inputStyle, width: 130, paddingLeft: "1.5rem", paddingRight: "0.75rem", fontSize: "0.875rem", fontWeight: 700 }}
          />
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            padding: "0.5rem 0.875rem",
            background: COLORS.brand, color: "#fff",
            border: "none", borderRadius: 8,
            fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
          }}
        >
          {saving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={13} />}
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "0.5rem 0.75rem",
            background: "none", border: "1px solid #D8E4EF",
            borderRadius: 8, fontSize: "0.875rem", color: COLORS.textMuted,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>

      {/* Live preview */}
      {preview !== null && (
        <div style={{
          marginTop: "0.5rem", fontSize: "0.8125rem",
          color: preview >= 0 ? COLORS.success : COLORS.danger,
          fontWeight: 600, display: "flex", alignItems: "center", gap: "0.3rem",
        }}>
          {preview >= 0
            ? <TrendingUp size={13} />
            : <TrendingDown size={13} />}
          Est. gross profit: {preview >= 0 ? "+" : ""}${preview.toFixed(2)}
          <span style={{ fontWeight: 400, color: COLORS.textMuted, fontSize: "0.75rem" }}>
            ({listingPrice > 0 ? ((preview / listingPrice) * 100).toFixed(1) : 0}% margin)
          </span>
        </div>
      )}
    </div>
  );
}