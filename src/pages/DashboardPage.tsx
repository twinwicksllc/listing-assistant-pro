import { useState, useEffect, useCallback } from "react";
import { LayoutDashboard, Eye, DollarSign, Package, RefreshCw, ExternalLink, AlertCircle, Loader2, Settings, X, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigate } from "react-router-dom";
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
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");
  const [ebayAccount, setEbayAccount] = useState<{ username: string; businessName: string } | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);

  const fetchListings = useCallback(async () => {
    const token = localStorage.getItem(EBAY_TOKEN_KEY);
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

      setListings(data.listings || []);
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
