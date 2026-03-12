import { useState, useEffect, useCallback } from "react";
import { LayoutDashboard, Eye, DollarSign, Package, RefreshCw, ExternalLink, AlertCircle, Loader2, Settings, X, LogOut, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { CompetitorPriceCard } from "@/components/CompetitorPriceCard";
import { useAuth } from "@/contexts/AuthContext";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigate } from "react-router-dom";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { toast } from "sonner";

interface CompetitorPriceSnapshot {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  priceDelta: number | null;  // your_price - avg_price; negative = you're cheaper
  competitorCount: number;
  priceDistribution: { min: number; max: number; count: number }[];
  fetchedAt: string;
}

interface EbayListing {
  offerId: string;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  views: number;
  listingId: string | null;
  ebayUrl: string | null;
  competitor?: CompetitorPriceSnapshot | null;
}

const EBAY_TOKEN_KEY = "ebay-user-token";

export default function DashboardPage() {
  const { drafts } = useDrafts();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");
  const [ebayAccount, setEbayAccount] = useState<{ username: string; businessName: string } | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [spotPrices, setSpotPrices] = useState<{ gold: number; silver: number; platinum: number } | null>(null);
  const [meltAlertOpen, setMeltAlertOpen] = useState(true);

  // Fetch spot prices once we have live listings with metal-content drafts
  useEffect(() => {
    const metalDrafts = drafts.filter(
      (d) => d.ebayListingId && d.metalType && d.metalType !== "none" && (d.metalWeightOz ?? 0) > 0
    );
    if (metalDrafts.length === 0 || spotPrices) return;

    supabase.functions
      .invoke("spot-prices", { body: { metalType: "gold", weightOz: 1 } })
      .then(({ data }) => {
        if (data?.spotPrices) setSpotPrices(data.spotPrices);
      })
      .catch(() => {}); // non-fatal
  }, [drafts, spotPrices]);

  const fetchListings = useCallback(async () => {
    // Token lookup order mirrors usePublishDraft:
    // 1. Server-side stored token in Supabase profiles (secure, preferred)
    // 2. localStorage fallback for backwards compatibility
    let token: string | null = null;

    if (user?.id) {
      try {
        const { data: tokenData } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (tokenData?.token) {
          token = tokenData.token;
          // Keep localStorage in sync for legacy code paths
          localStorage.setItem(EBAY_TOKEN_KEY, token);
        }
        // If token is expired and refresh failed, tokenData.isExpired will be true
        if (tokenData?.isExpired) {
          localStorage.removeItem(EBAY_TOKEN_KEY);
          setNeedsAuth(true);
          setEbayAccount(null);
          setListings([]);
          toast.error("eBay session expired. Please reconnect in Settings.");
          return;
        }
      } catch {
        // fall through to localStorage
      }
    }

    if (!token) {
      token = localStorage.getItem(EBAY_TOKEN_KEY);
    }

    if (!token) {
      setNeedsAuth(true);
      setEbayAccount(null);
      setListings([]);
      return;
    }

    setLoading(true);
    setError("");

    // Fetch user info in parallel with listings
    const userPromise = supabase.functions.invoke("ebay-user", {
      body: { userToken: token },
    });

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ebay-listings", {
        body: { userToken: token },
      });

      // If the function errors or returns needsAuth, show the connect button
      if (fnError || data?.needsAuth) {
        // Clear the invalid token so we don't keep trying with it
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true);
        setListings([]);
        setEbayAccount(null);
        toast.error("eBay connection expired. Please reconnect in Settings.");
        return;
      }
      if (data?.warning) {
        // Display warning but keep the connection active (user can try to fix on eBay)
        console.warn("ebay-listings warning:", data.warning);
        setListings([]);
        setNeedsAuth(false);
        toast.error(data.warning);
        return;
      }
      if (data?.error) {
        // Show the actual error so we can diagnose it
        console.error("ebay-listings error response:", data.error);
        // Clear invalid token on API error too
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true);
        setListings([]);
        setEbayAccount(null);
        toast.error(`eBay error: ${data.error}`);
        return;
      }

      const rawListings: EbayListing[] = data.listings || [];

      // Fetch cached competitor prices from Supabase for all listings with a listingId
      let competitorMap: Record<string, CompetitorPriceSnapshot> = {};
      if (user?.id && rawListings.length > 0) {
        try {
          const listingIds = rawListings
            .map((l) => l.listingId)
            .filter(Boolean) as string[];

          if (listingIds.length > 0) {
            const { data: cpData } = await supabase
              .from("competitor_prices")
              .select(
                "ebay_listing_id, avg_price, min_price, max_price, median_price, price_delta, competitor_count, price_distribution, fetched_at"
              )
              .eq("user_id", user.id)
              .in("ebay_listing_id", listingIds)
              .order("fetched_at", { ascending: false });

            // Keep only the most recent snapshot per listing
            for (const row of cpData ?? []) {
              if (!competitorMap[row.ebay_listing_id]) {
                competitorMap[row.ebay_listing_id] = {
                  avgPrice: row.avg_price,
                  minPrice: row.min_price,
                  maxPrice: row.max_price,
                  medianPrice: row.median_price,
                  priceDelta: row.price_delta,
                  competitorCount: row.competitor_count,
                  priceDistribution: row.price_distribution ?? [],
                  fetchedAt: row.fetched_at,
                };
              }
            }
          }
        } catch (cpErr) {
          console.warn("Could not load competitor prices (non-fatal):", cpErr);
        }
      }

      const listingsWithCompetitors: EbayListing[] = rawListings.map((l) => ({
        ...l,
        competitor: l.listingId ? (competitorMap[l.listingId] ?? null) : null,
      }));

      setListings(listingsWithCompetitors);
      setNeedsAuth(false);

      // Get user info
      const { data: userData } = await userPromise;
      if (userData?.username) {
        setEbayAccount({ 
          username: userData.username, 
          businessName: userData.businessName || "" 
        });
      }
      
      toast.success(`Refreshed! ${data.listings?.length || 0} listings loaded`);
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      setError(err.message || "Failed to load listings");
      toast.error("Failed to refresh listings");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Compute stats
  const activeListings = listings.filter((l) => l.status === "PUBLISHED" || l.status === "ACTIVE");
  const totalViews = listings.reduce((sum, l) => sum + l.views, 0);
  const liveValue = listings.reduce((sum, l) => sum + l.price, 0);
  const draftValue = drafts.reduce((sum, d) => sum + (d.priceMin + d.priceMax) / 2, 0);
  const totalInventoryValue = liveValue + draftValue;

  // Build at-risk listing alerts (price below melt floor)
  const atRiskListings = spotPrices
    ? listings.flatMap((listing) => {
        const draft = drafts.find((d) => d.ebayListingId === listing.listingId);
        if (!draft || !draft.metalType || draft.metalType === "none" || !(draft.metalWeightOz ?? 0)) return [];
        const key = draft.metalType.toLowerCase() as keyof typeof spotPrices;
        const meltFloor = spotPrices[key] * (draft.metalWeightOz ?? 0);
        if (!meltFloor || listing.price >= meltFloor) return [];
        return [{ listing, meltFloor, delta: meltFloor - listing.price }];
      })
    : [];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
              {ebayAccount ? (
                <p className="text-xs text-muted-foreground">
                  Connected as <span className="font-medium text-foreground">{ebayAccount.businessName || ebayAccount.username}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">eBay performance overview</p>
              )}
            </div>
          </div>
          <button
            onClick={fetchListings}
            disabled={loading}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-6">
        {/* Setup Progress Widget */}
        {needsAuth && !setupDismissed && (
          <div className="bg-accent/50 border border-accent rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="flex-1 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Setup: Connect eBay</p>
                <p className="text-xs text-muted-foreground">
                  Step 1 of 1 — <button
                    onClick={() => navigate("/settings?tab=integrations")}
                    className="text-primary font-medium hover:underline"
                  >
                    Go to Settings
                  </button>
                </p>
              </div>
            </div>
            <button
              onClick={() => setSetupDismissed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Total Inventory</span>
            </div>
            <p className="text-xl font-bold text-foreground">${totalInventoryValue.toFixed(2)}</p>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                Live ${liveValue.toFixed(2)}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                Drafts ${draftValue.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Total Views</span>
            </div>
            <p className="text-xl font-bold text-foreground">{totalViews.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Last 30 days</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Package className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Active Listings</span>
            </div>
            <p className="text-xl font-bold text-foreground">{activeListings.length}</p>
            <p className="text-[10px] text-muted-foreground">{listings.length} total on eBay</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Drafts</span>
            </div>
            <p className="text-xl font-bold text-foreground">{drafts.length}</p>
            <p className="text-[10px] text-muted-foreground">Ready to publish</p>
          </div>
        </div>

        {/* Repricing Alert Banner — listings priced below melt floor */}
        {atRiskListings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl overflow-hidden">
            <button
              onClick={() => setMeltAlertOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {atRiskListings.length} listing{atRiskListings.length !== 1 ? "s" : ""} below melt floor
                </span>
              </div>
              {meltAlertOpen
                ? <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                : <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              }
            </button>

            {meltAlertOpen && (
              <div className="px-4 pb-3 space-y-2">
                <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                  Spot prices have moved — these listings are priced below their precious metal melt value. Consider raising your prices.
                </p>
                {atRiskListings.map(({ listing, meltFloor, delta }) => (
                  <div key={listing.offerId} className="flex items-center justify-between gap-2 text-xs bg-amber-500/10 rounded-lg px-3 py-2">
                    <p className="text-foreground font-medium line-clamp-1 flex-1">{listing.title}</p>
                    <div className="flex-shrink-0 text-right space-y-0.5">
                      <p className="text-amber-700 dark:text-amber-300 font-semibold">
                        Listed ${listing.price.toFixed(2)} · Melt ${meltFloor.toFixed(2)}
                      </p>
                      <p className="text-amber-600/80 dark:text-amber-400/80">
                        ${delta.toFixed(2)} below floor
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Auth warning / Connect eBay CTA */}
        {needsAuth && (
          <div className="bg-accent/50 border border-accent rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">eBay not connected</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connect your eBay account in Settings to see your listings and traffic data.
              </p>
              <button
                onClick={() => navigate("/settings?tab=integrations")}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                Go to Integrations →
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Active Listings Table */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">eBay Listings</h2>
            {needsAuth && (
              <button
                onClick={() => navigate("/settings?tab=integrations")}
                className="px-2.5 py-0.5 rounded-full bg-destructive/20 text-destructive text-xs font-medium hover:bg-destructive/30 transition-colors flex items-center gap-1"
              >
                <span className="inline-block w-1.5 h-1.5 bg-destructive rounded-full" />
                Disconnected
              </button>
            )}
          </div>

          {loading && listings.length === 0 ? (
            <div className="text-center py-12">
              <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Loading listings...</p>
            </div>
          ) : listings.length === 0 && !needsAuth ? (
            <div className="text-center py-12 space-y-2">
              <Package className="w-8 h-8 text-muted-foreground/50 mx-auto" />
              <p className="text-sm text-muted-foreground">No listings found on eBay yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {listings.map((listing) => (
                <div key={listing.offerId} className="bg-card border border-border rounded-xl p-3 flex gap-3">
                  {listing.imageUrl ? (
                    <img
                      src={listing.imageUrl}
                      alt={listing.title}
                      className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                      <Package className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{listing.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-semibold text-primary">
                        ${listing.price.toFixed(2)}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        listing.status === "PUBLISHED" || listing.status === "ACTIVE"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {listing.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {listing.views} views
                      </span>
                      {listing.ebayUrl && (
                        <a
                          href={listing.ebayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                      )}
                    </div>
                    {listing.listingId && (
                      <CompetitorPriceCard
                        listingId={listing.listingId}
                        title={listing.title}
                        yourPrice={listing.price}
                        ebayUrl={listing.ebayUrl}
                        competitor={listing.competitor}
                        onRefreshed={(snapshot) =>
                          setListings((prev) =>
                            prev.map((l) =>
                              l.listingId === listing.listingId
                                ? { ...l, competitor: snapshot }
                                : l
                            )
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
