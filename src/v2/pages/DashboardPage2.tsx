/**
 * DashboardPage2 — V2 Styled Dashboard
 * 
 * Full rebuild with v2 styling:
 *   - Gradient page background
 *   - White cards with blue top accent
 *   - Proper spacing with AppShell sidebar
 *   - Inline styles for consistency
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye, DollarSign, RefreshCw,
  AlertCircle, Loader2, X,
  LayoutDashboard, Heart, ShoppingCart,
  Flame, TrendingDown, Minus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppShell from "@/v2/components/AppShell";
import { COLORS, cardStyle, inputStyle } from "@/v2/theme";

// ─── Types ─────────────────────────────────────────────────────────────

interface CompetitorPriceSnapshot {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  competitorCount: number;
  priceDistribution: { min: number; max: number; count: number }[];
  fetchedAt: string;
}

interface EbayListing {
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
  views7d: number;
  views30d: number;
  views90d: number;
  impressions7d: number;
  impressions30d: number;
  impressions90d: number;
  transactions7d: number;
  transactions30d: number;
  transactions90d: number;
  watchCount: number;
  questionCount: number;
  listingId: string | null;
  ebayUrl: string | null;
  categoryId?: string;
  quantity?: number;
  format?: string;
  condition?: string;
  listingDate?: string | null;
  competitor?: CompetitorPriceSnapshot | null;
}

type SortField =
  | "title"
  | "price"
  | "views"
  | "impressions"
  | "watchCount"
  | "transactions"
  | "clickThroughRate"
  | "trend"
  | "listingDate"
  | "status";
type SortDir = "asc" | "desc";

// ─── Helper Functions ─────────────────────────────────────────────────────

function trendScore(l: EbayListing): number {
  const p7 = l.views7d / 7;
  const p30 = l.views30d / 30;
  const p90 = l.views90d / 90;
  return p7 * 3 + p30 * 2 + p90;
}

type TrendLabel = "hot" | "stable" | "stale" | "new";

function getTrend(l: EbayListing): TrendLabel {
  const p7 = l.views7d / 7;
  const p30 = l.views30d / 30;
  const p90 = l.views90d / 90;

  if (l.views90d === 0 && l.views30d === 0 && l.views7d === 0) return "new";
  if (p30 > 0 && p7 >= p30 * 1.4) return "hot";
  if (p30 > 0 && p7 <= p30 * 0.6) return "stale";
  if (p90 > 0 && p30 <= p90 * 0.6 && p7 <= p90 * 0.4) return "stale";
  return "stable";
}

function daysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff}d ago`;
}

function statusLabel(status: string): string {
  if (status === "PUBLISHED" || status === "Active") return "Active";
  if (status === "UNPUBLISHED") return "Draft";
  return status;
}

// ─── Styles ────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: COLORS.pageBg,
  backgroundAttachment: "fixed",
  paddingBottom: "3rem",
};

const contentStyle: React.CSSProperties = {
  maxWidth: "1400px",
  margin: "0 auto",
  padding: "2rem 2rem 2rem 20rem", // Left padding for sidebar
};

const headerStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 800,
  color: "#141820",
  margin: 0,
  letterSpacing: "-0.03em",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "0.9375rem",
  color: "#6E7580",
  marginTop: "0.25rem",
};

const summaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "1rem",
  marginBottom: "1.5rem",
};

const statCard: React.CSSProperties = {
  ...cardStyle,
  padding: "1.25rem",
};

const statLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#6E7580",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

const statValue: React.CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 800,
  color: "#141820",
  margin: "0.5rem 0",
};

const statSubtext: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#6E7580",
};

const alertBox: React.CSSProperties = {
  ...cardStyle,
  background: "rgba(251, 146, 60, 0.05)",
  borderTop: "3px solid #fb923c",
  marginBottom: "1.5rem",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "1rem",
};

const tableCard: React.CSSProperties = {
  ...cardStyle,
  overflow: "hidden",
};

const tableHeader: React.CSSProperties = {
  padding: "1rem 1.5rem",
  borderBottom: "1px solid #E8EEF5",
  background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const tableBody: React.CSSProperties = {
  padding: "1.5rem",
};

const listingRow: React.CSSProperties = {
  padding: "1rem",
  background: "#f8fafc",
  border: "1px solid #E8EEF5",
  borderRadius: 10,
  display: "flex",
  gap: "1rem",
  alignItems: "center",
  marginBottom: "0.75rem",
  transition: "all 0.15s",
};

const emptyState: React.CSSProperties = {
  textAlign: "center",
  padding: "3rem",
  color: "#6E7580",
};

const loadingState: React.CSSProperties = {
  textAlign: "center",
  padding: "3rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  color: "#6E7580",
};

// ─── Main Component ────────────────────────────────────────────────────

export default function DashboardPage2() {
  const { user, signOut, currentPlan, planFeatures } = useAuth();
  const navigate = useNavigate();
  const { drafts } = useDrafts();

  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [ebayAccount, setEbayAccount] = useState<any>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);

  // Load listings
  const fetchListings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-fetch-listings", {
        body: { userId: user.id },
      });
      if (error) throw error;
      setListings(data?.listings || []);
      setEbayAccount(data?.account);
      setNeedsAuth(!data?.account);
    } catch (e) {
      console.error("Failed to load listings:", e);
      toast.error("Failed to load listings. Check your eBay connection.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Compute metrics
  const metrics = useMemo(() => {
    const active = listings.filter(l => statusLabel(l.status) === "Active");
    const liveValue = active.reduce((sum, l) => sum + (l.price * (l.quantity || 1)), 0);
    const draftValue = drafts.reduce((sum, d) => sum + (d.price || 0), 0);
    const views7d = active.reduce((sum, l) => sum + (l.views7d || 0), 0);
    const views30d = active.reduce((sum, l) => sum + (l.views30d || 0), 0);
    const views90d = active.reduce((sum, l) => sum + (l.views90d || 0), 0);
    const watchers = active.reduce((sum, l) => sum + (l.watchCount || 0), 0);
    const sales = active.reduce((sum, l) => sum + (l.transactions || 0), 0);

    return {
      total: listings.length,
      active: active.length,
      liveValue,
      draftValue,
      views7d,
      views30d,
      views90d,
      watchers,
      sales,
    };
  }, [listings, drafts]);

  return (
    <AppShell>
      <div style={pageStyle}>
        <div style={contentStyle}>
          {/* Header */}
          <div style={headerStyle}>
            <div>
              <h1 style={titleStyle}>Dashboard</h1>
              <p style={subtitleStyle}>
                {ebayAccount
                  ? `Connected as ${ebayAccount.businessName || ebayAccount.username}`
                  : "eBay performance overview"}
              </p>
            </div>
            <button
              onClick={fetchListings}
              disabled={loading}
              style={{
                ...inputStyle,
                padding: "0.625rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>

          {/* Setup Alert */}
          {needsAuth && !setupDismissed && (
            <div style={alertBox}>
              <div style={{ display: "flex", gap: "1rem" }}>
                <AlertCircle size={20} style={{ color: COLORS.brand, flexShrink: 0, marginTop: "0.25rem" }} />
                <div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", marginBottom: "0.25rem" }}>
                    Setup: Connect eBay
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#6E7580" }}>
                    <button
                      onClick={() => navigate("/settings?tab=integrations")}
                      style={{ color: COLORS.brand, fontWeight: 600, cursor: "pointer", border: "none", background: "none" }}
                    >
                      Go to Settings
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSetupDismissed(true)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#6E7580" }}
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* Summary Stats Grid */}
          <div style={summaryGrid}>
            {/* Total Inventory */}
            <div style={statCard}>
              <div style={statLabel}>
                <DollarSign size={14} />
                Total Inventory
              </div>
              <div style={statValue}>
                ${(metrics.liveValue + metrics.draftValue).toFixed(0)}
              </div>
              <div style={statSubtext}>
                Live: ${metrics.liveValue.toFixed(0)} • Drafts: ${metrics.draftValue.toFixed(0)}
              </div>
            </div>

            {/* Views */}
            {planFeatures.hasListingAnalytics ? (
              <div style={statCard}>
                <div style={statLabel}>
                  <Eye size={14} />
                  Views (30d)
                </div>
                <div style={statValue}>
                  {metrics.views30d.toLocaleString()}
                </div>
                <div style={statSubtext}>
                  7d: {metrics.views7d.toLocaleString()} • 90d: {metrics.views90d.toLocaleString()}
                </div>
              </div>
            ) : (
              <div style={statCard}>
                <div style={statLabel}>
                  <Eye size={14} />
                  Views
                </div>
                <div style={{ fontSize: "0.875rem", color: "#6E7580", marginTop: "0.75rem" }}>
                  Upgrade to Pro for analytics
                </div>
              </div>
            )}

            {/* Watchers */}
            {planFeatures.hasListingAnalytics ? (
              <div style={statCard}>
                <div style={statLabel}>
                  <Heart size={14} />
                  Total Watchers
                </div>
                <div style={statValue}>
                  {metrics.watchers.toLocaleString()}
                </div>
                <div style={statSubtext}>
                  Across all listings
                </div>
              </div>
            ) : (
              <div style={statCard}>
                <div style={statLabel}>
                  <Heart size={14} />
                  Watchers
                </div>
                <div style={{ fontSize: "0.875rem", color: "#6E7580", marginTop: "0.75rem" }}>
                  Upgrade to Pro
                </div>
              </div>
            )}

            {/* Sales */}
            <div style={statCard}>
              <div style={statLabel}>
                <ShoppingCart size={14} />
                Sales (30d)
              </div>
              <div style={statValue}>
                {metrics.sales}
              </div>
              <div style={statSubtext}>
                Total transactions
              </div>
            </div>

            {/* Active Listings */}
            <div style={statCard}>
              <div style={statLabel}>
                <LayoutDashboard size={14} />
                Active Listings
              </div>
              <div style={statValue}>
                {metrics.active}
              </div>
              <div style={statSubtext}>
                Of {metrics.total} total
              </div>
            </div>
          </div>

          {/* Listings */}
          {loading ? (
            <div style={{ ...statCard, ...loadingState }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
              <span>Loading listings...</span>
            </div>
          ) : listings.length === 0 ? (
            <div style={{ ...statCard, ...emptyState }}>
              <LayoutDashboard size={40} style={{ color: "#9BA3AD", marginBottom: "1rem" }} />
              <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", marginBottom: "0.25rem" }}>
                No listings yet
              </p>
              <p style={{ fontSize: "0.8125rem" }}>
                Connect your eBay account to see your listings and analytics.
              </p>
            </div>
          ) : (
            <div style={tableCard}>
              <div style={tableHeader}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>
                  eBay Listings ({listings.length})
                </div>
              </div>
              <div style={tableBody}>
                <div>
                  {listings.slice(0, 50).map(listing => {
                    const trend = getTrend(listing);
                    const trendColors = {
                      hot: "#f97316",
                      stable: "#6E7580",
                      stale: COLORS.brand,
                      new: "#6E7580",
                    };
                    return (
                      <div
                        key={listing.listingId || listing.sku}
                        style={{
                          ...listingRow,
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.background = "#ffffff";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,80,140,0.08)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.background = "#f8fafc";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                        }}
                      >
                        {/* Image */}
                        <img
                          src={listing.imageUrl}
                          alt={listing.title}
                          style={{
                            width: 72,
                            height: 72,
                            objectFit: "cover",
                            borderRadius: 10,
                            flexShrink: 0,
                          }}
                        />

                        {/* Details */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", marginBottom: "0.25rem" }}>
                            {listing.title}
                          </div>
                          <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8125rem", color: "#6E7580" }}>
                            <span>{listing.sku}</span>
                            {planFeatures.hasListingAnalytics && listing.views30d > 0 && (
                              <>
                                <span>•</span>
                                <span>{listing.views30d} views (30d)</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Stats column */}
                        {planFeatures.hasListingAnalytics && (
                          <div style={{ display: "flex", gap: "1.5rem", flexShrink: 0 }}>
                            <div>
                              <div style={{ fontSize: "0.75rem", color: "#9BA3AD" }}>Views 30d</div>
                              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>
                                {listing.views30d}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: "0.75rem", color: "#9BA3AD" }}>Watchers</div>
                              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>
                                {listing.watchCount || 0}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Price & Status */}
                        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 120 }}>
                          <div style={{ fontSize: "1rem", fontWeight: 800, color: COLORS.brand, marginBottom: "0.25rem" }}>
                            ${listing.price.toFixed(2)}
                          </div>
                          <div style={{
                            display: "inline-block",
                            padding: "0.25rem 0.625rem",
                            borderRadius: 12,
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: statusLabel(listing.status) === "Active" 
                              ? "rgba(34, 197, 94, 0.1)" 
                              : "rgba(251, 191, 36, 0.1)",
                            color: statusLabel(listing.status) === "Active" ? "#16a34a" : "#d97706",
                          }}>
                            {statusLabel(listing.status)}
                          </div>
                        </div>

                        {/* Trend */}
                        {planFeatures.hasListingAnalytics && trend !== "new" && (
                          <div style={{ flexShrink: 0 }}>
                            <div style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.25rem",
                              padding: "0.25rem 0.5rem",
                              borderRadius: 6,
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              background: trend === "hot" ? "rgba(249, 115, 22, 0.1)" : trend === "stale" ? "rgba(0, 118, 182, 0.1)" : "rgba(110, 117, 128, 0.1)",
                              color: trendColors[trend],
                            }}>
                              {trend === "hot" && <Flame size={12} />}
                              {trend === "stale" && <TrendingDown size={12} />}
                              {trend === "stable" && <Minus size={12} />}
                              {trend === "hot" ? "Hot" : trend === "stale" ? "Stale" : "Stable"}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}