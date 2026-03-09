import { useState, useEffect, useCallback } from "react";
import { LayoutDashboard, Eye, DollarSign, Package, RefreshCw, ExternalLink, AlertCircle, Loader2 } from "lucide-react";
import { useDrafts } from "@/hooks/useDrafts";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { toast } from "sonner";

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
}

const EBAY_TOKEN_KEY = "ebay-user-token";

export default function DashboardPage() {
  const { drafts } = useDrafts();
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");
  const [connectingEbay, setConnectingEbay] = useState(false);

  const fetchListings = useCallback(async () => {
    const token = localStorage.getItem(EBAY_TOKEN_KEY);
    if (!token) {
      setNeedsAuth(true);
      return;
    }

    setLoading(true);
    setError("");
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
        return;
      }
      if (data?.error) {
        // Show the actual error so we can diagnose it
        console.error("ebay-listings error response:", data.error);
        // Clear invalid token on API error too
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true);
        setListings([]);
        toast.error(`eBay error: ${data.error}`);
        return;
      }

      setListings(data.listings || []);
      setNeedsAuth(false);
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      setError(err.message || "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConnectEbay = useCallback(async () => {
    setConnectingEbay(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_auth_url" },
      });

      if (fnError || data?.error) {
        throw new Error(fnError?.message || data?.error || "Failed to get eBay auth URL");
      }

      const authUrl = data?.authUrl;
      if (!authUrl) throw new Error("No auth URL returned");

      // Open eBay OAuth consent page in the same tab so the callback works
      window.location.href = authUrl;
    } catch (err: any) {
      console.error("eBay connect error:", err);
      toast.error(err.message || "Failed to start eBay connection");
      setConnectingEbay(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Compute stats
  const activeListings = listings.filter((l) => l.status === "PUBLISHED" || l.status === "ACTIVE");
  const totalViews = listings.reduce((sum, l) => sum + l.views, 0);
  const liveValue = listings.reduce((sum, l) => sum + l.price, 0);
  const draftValue = drafts.reduce((sum, d) => sum + (d.priceMin + d.priceMax) / 2, 0);
  const totalInventoryValue = liveValue + draftValue;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
              <p className="text-xs text-muted-foreground">eBay performance overview</p>
            </div>
          </div>
          <button
            onClick={fetchListings}
            disabled={loading}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-6">
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

        {/* Auth warning / Connect eBay CTA */}
        {needsAuth && (
          <div className="bg-accent/50 border border-accent rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Connect your eBay account</p>
                <p className="text-xs text-muted-foreground">
                  Authorize with eBay to see your active listings and traffic data.
                </p>
              </div>
            </div>
            <button
              onClick={handleConnectEbay}
              disabled={connectingEbay}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {connectingEbay ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting…
                </>
              ) : (
                "Connect eBay Account"
              )}
            </button>
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
          <h2 className="text-sm font-semibold text-foreground">eBay Listings</h2>

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
