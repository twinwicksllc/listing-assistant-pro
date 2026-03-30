/**
 * SettingsPage2 — V2 Sleek redesign of /settings
 *
 * All business logic identical to SettingsPage.tsx.
 * Presentation changes:
 *   - AppShell (left sidebar on desktop, BottomNav on mobile)
 *   - Off-white background (#F8F9FA), soft shadows, glass-morphic cards
 *   - Font weight depth: 800 primary, 700 secondary, 400 body
 *   - Generous corner radii (12px/16px)
 *   - Desktop: two-column layout — vertical tab list on left, content on right
 *   - Mobile: horizontal tab bar + full-width content (same UX as original)
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  User, CreditCard, Zap, Loader2, Check, Shield,
  Crown, Store, ExternalLink, AlertCircle,
} from "lucide-react";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ProfileModal from "@/components/ProfileModal";
import AppShell from "../components/AppShell";
import UsageSummaryCard from "../components/UsageSummaryCard";

// ── Constants ─────────────────────────────────────────────────────────────────

const EBAY_TOKEN_KEY = "ebay-user-token";
type SettingsTab = "profile" | "billing" | "integrations";

// ── Inline styles ─────────────────────────────────────────────────────────────

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const S = {
  page: {
    minHeight: "100vh",
    background: "#F8F9FA",
    fontFamily: FONT,
  } as React.CSSProperties,

  inner: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "2rem 2rem",
  } as React.CSSProperties,

  innerMobile: {
    padding: "1.25rem 1rem 1rem",
  } as React.CSSProperties,

  pageHeader: {
    marginBottom: "1.5rem",
  } as React.CSSProperties,

  pageTitle: {
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "#141820",
    letterSpacing: "-0.02em",
    margin: 0,
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: "0.9375rem",
    fontWeight: 400,
    color: "#6E7580",
    marginTop: "0.25rem",
  } as React.CSSProperties,

  // Usage summary section
  usageSection: {
    marginBottom: "1.5rem",
  } as React.CSSProperties,

  // Desktop two-column shell
  twoCol: {
    display: "grid",
    gridTemplateColumns: "200px 1fr",
    gap: "1.5rem",
    alignItems: "start",
  } as React.CSSProperties,

  // Left sidebar tab list (desktop) - glass-morphic
  tabList: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.72) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
  } as React.CSSProperties,

  tabBtn: (active: boolean): React.CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
    padding: "0.875rem 1.125rem",
    background: active ? "rgba(0,118,182,0.08)" : "transparent",
    border: "none",
    borderLeft: active ? "3px solid #0076B6" : "3px solid transparent",
    cursor: "pointer",
    color: active ? "#0076B6" : "#4B5563",
    fontSize: "0.9375rem",
    fontWeight: active ? 700 : 500,
    textAlign: "left" as const,
    transition: "all 0.15s",
  }),

  // Mobile horizontal tab bar
  mobileTabBar: {
    display: "flex",
    borderBottom: "none",
    marginBottom: "1.25rem",
    background: "linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.72) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius: 12,
    overflowX: "auto" as const,
    boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
  } as React.CSSProperties,

  mobileTabBtn: (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    padding: "0.75rem 1rem",
    background: active ? "rgba(0,118,182,0.08)" : "transparent",
    border: "none",
    borderRadius: active ? 8 : 0,
    cursor: "pointer",
    color: active ? "#0076B6" : "#6E7580",
    fontSize: "0.9375rem",
    fontWeight: active ? 700 : 500,
    whiteSpace: "nowrap" as const,
    transition: "all 0.15s",
  }),

  // Content card - glass-morphic
  card: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.72) 100%)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 16,
    boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
    overflow: "hidden",
  } as React.CSSProperties,

  cardHeader: {
    padding: "1.25rem 1.5rem",
    borderBottom: "1px solid rgba(228,231,236,0.5)",
  } as React.CSSProperties,

  cardTitle: {
    fontSize: "1.0625rem",
    fontWeight: 800,
    color: "#141820",
    margin: 0,
  } as React.CSSProperties,

  cardSubtitle: {
    fontSize: "0.875rem",
    fontWeight: 400,
    color: "#6E7580",
    marginTop: "0.25rem",
  } as React.CSSProperties,

  cardBody: {
    padding: "1.25rem 1.5rem",
  } as React.CSSProperties,

  // Section title inside content
  sectionTitle: {
    fontSize: "1.125rem",
    fontWeight: 700,
    color: "#141820",
    marginBottom: "0.375rem",
  } as React.CSSProperties,

  sectionSub: {
    fontSize: "0.9rem",
    color: "#6E7580",
    marginBottom: "1.25rem",
  } as React.CSSProperties,

  // Row button (profile, security)
  rowBtn: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: "0.125rem",
    width: "100%",
    padding: "1rem 1.25rem",
    background: "#fff",
    border: "1px solid #E4E7EC",
    borderRadius: 10,
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.15s",
  } as React.CSSProperties,

  rowBtnLabel: {
    fontSize: "0.9375rem",
    fontWeight: 600,
    color: "#141820",
  } as React.CSSProperties,

  rowBtnSub: {
    fontSize: "0.875rem",
    color: "#6E7580",
  } as React.CSSProperties,

  // Primary button
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.75rem 1.5rem",
    background: "#0076B6",
    color: "#fff",
    fontSize: "0.9375rem",
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    width: "100%",
    transition: "background 0.15s",
  } as React.CSSProperties,

  btnOutline: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.625rem 1.25rem",
    background: "#fff",
    color: "#141820",
    fontSize: "0.9375rem",
    fontWeight: 500,
    border: "1px solid #E4E7EC",
    borderRadius: 8,
    cursor: "pointer",
    width: "100%",
    transition: "background 0.15s",
  } as React.CSSProperties,

  btnDanger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.625rem 1.25rem",
    background: "#fff",
    color: "#dc2626",
    fontSize: "0.9375rem",
    fontWeight: 500,
    border: "1px solid #fca5a5",
    borderRadius: 8,
    cursor: "pointer",
    width: "100%",
    transition: "background 0.15s",
  } as React.CSSProperties,

  // Badge
  badgeGreen: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.2rem 0.625rem",
    background: "rgba(34,197,94,0.1)",
    color: "#16a34a",
    borderRadius: 20,
    fontSize: "0.75rem",
    fontWeight: 600,
  } as React.CSSProperties,

  // Stats row (usage)
  usageRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.625rem 0",
    borderBottom: "1px solid #F0F2F5",
    fontSize: "0.9375rem",
  } as React.CSSProperties,

  divider: {
    border: "none",
    borderTop: "1px solid #E4E7EC",
    margin: "1.25rem 0",
  } as React.CSSProperties,
};

// ── Sub-component: UpgradeCard ────────────────────────────────────────────────

function UpgradeCard({
  icon: Icon, name, price, features, onUpgrade, loading, disabled, recommended,
}: {
  icon: React.ElementType;
  name: string;
  price: string;
  features: string[];
  onUpgrade: () => void;
  loading: boolean;
  disabled: boolean;
  recommended?: boolean;
}) {
  return (
    <div style={{
      background: "#fff",
      border: recommended ? "2px solid #0076B6" : "1px solid #E4E7EC",
      borderRadius: 12,
      padding: "1.5rem",
      position: "relative",
      transition: "border-color 0.15s",
    }}>
      {recommended && (
        <span style={{
          position: "absolute", top: 0, right: 0,
          background: "#0076B6", color: "#fff",
          fontSize: "0.6875rem", fontWeight: 700,
          padding: "0.25rem 0.75rem",
          borderRadius: "0 10px 0 8px",
          letterSpacing: "0.05em",
        }}>
          RECOMMENDED
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <Icon size={20} color="#0076B6" />
        <span style={{ fontSize: "1.0625rem", fontWeight: 700, color: "#141820" }}>{name}</span>
      </div>

      <p style={{ fontSize: "1.75rem", fontWeight: 800, color: "#141820", marginBottom: "1rem", letterSpacing: "-0.02em" }}>
        {price}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {features.map(f => (
          <li key={f} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem", color: "#4B5563" }}>
            <Check size={15} color="#16a34a" />
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={onUpgrade}
        disabled={disabled}
        style={{
          ...S.btnPrimary,
          background: recommended ? "#0076B6" : "#F7F9FB",
          color: recommended ? "#fff" : "#0076B6",
          border: recommended ? "none" : "1px solid #0076B6",
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Loading…" : `Upgrade to ${name}`}
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SettingsPage2() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    currentPlan, isStarter, isPro, isShop, isPaid, subscription, usage,
    refreshSubscription, currentPlanLimits, isOwner, user, isAdmin, planFeatures,
    isUnlimited,
  } = useAuth();

  const paramTab   = searchParams.get("tab") as SettingsTab | null;
  const initialTab = (paramTab && ["profile","billing","integrations"].includes(paramTab) ? paramTab : "profile") as SettingsTab;
  const [activeTab,       setActiveTab]       = useState<SettingsTab>(initialTab);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading,   setPortalLoading]   = useState(false);
  const [connectingEbay,  setConnectingEbay]  = useState(false);
  const [ebayConnected,   setEbayConnected]   = useState(!!localStorage.getItem(EBAY_TOKEN_KEY));
  const [showProfileModal,setShowProfileModal]= useState(false);

  // Verify eBay connection on mount (identical to original)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (user?.id) {
        try {
          const { data } = await supabase.functions.invoke("ebay-publish", { body: { action: "get_stored_token", userId: user.id } });
          if (cancelled) return;
          if (data?.token) { setEbayConnected(true); localStorage.setItem(EBAY_TOKEN_KEY, data.token); return; }
        } catch {}
      }
      if (!cancelled) setEbayConnected(!!localStorage.getItem(EBAY_TOKEN_KEY));
    };
    check();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleCheckout = async (planKey: "starter" | "pro" | "shop") => {
    setCheckoutLoading(planKey);
    try {
      const plan = PLANS[planKey];
      if (!("priceId" in plan)) throw new Error("No price configured for this plan");
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { priceId: plan.priceId } });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManage = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const handleConnectEbay = async () => {
    setConnectingEbay(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ebay-publish", { body: { action: "get_auth_url" } });
      if (fnError || data?.error) throw new Error(fnError?.message || data?.error || "Failed to get eBay auth URL");
      if (!data?.authUrl) throw new Error("No auth URL returned");
      window.location.href = data.authUrl;
    } catch (err: any) {
      toast.error(err.message || "Failed to start eBay connection");
      setConnectingEbay(false);
    }
  };

  const handleDisconnectEbay = async () => {
    localStorage.removeItem(EBAY_TOKEN_KEY);
    localStorage.removeItem("ebay-refresh-token");
    localStorage.removeItem("ebay-token-expires-at");
    setEbayConnected(false);
    if (user?.id) {
      try {
        await supabase.from("profiles").update({
          ebay_access_token: null, ebay_refresh_token: null, ebay_token_expires_at: null,
        }).eq("id", user.id);
      } catch {}
    }
    toast.success("eBay account disconnected");
  };

  const planDisplayName = (() => {
    switch (currentPlan) {
      case "shop":    return "Shop — $99/month";
      case "pro":     return "Pro — $49/month";
      case "starter": return "Starter — $19/month";
      default:        return "Free";
    }
  })();

  const tabs = [
    { id: "profile"      as const, label: "Profile",      icon: User },
    ...(isOwner ? [{ id: "billing" as const, label: "Billing", icon: CreditCard }] : []),
    { id: "integrations" as const, label: "Integrations", icon: Zap },
  ];

  const switchTab = (id: SettingsTab) => {
    setActiveTab(id);
    setSearchParams({ tab: id }, { replace: true });
  };

  // ── Tab content ─────────────────────────────────────────────────────────────

  const ProfileTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <p style={S.sectionTitle}>Profile Settings</p>
        <p style={S.sectionSub}>Manage your account information and preferences.</p>
      </div>

      <button
        style={S.rowBtn}
        onClick={() => setShowProfileModal(true)}
        onMouseEnter={e => (e.currentTarget.style.background = "#F7F9FB")}
        onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
      >
        <span style={S.rowBtnLabel}>Edit Profile</span>
        <span style={S.rowBtnSub}>Update your name, email, and display preferences</span>
      </button>

      {isAdmin && (
        <button
          style={{ ...S.rowBtn, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.04)" }}
          onClick={() => navigate("/admin")}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(245,158,11,0.08)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(245,158,11,0.04)")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Shield size={16} color="#d97706" />
            <span style={S.rowBtnLabel}>Admin Dashboard</span>
          </div>
          <span style={S.rowBtnSub}>Manage system and user settings</span>
        </button>
      )}

      <hr style={S.divider} />

      <div>
        <p style={{ fontSize: "1rem", fontWeight: 700, color: "#141820", marginBottom: "0.75rem" }}>Security</p>
        <button
          style={S.rowBtn}
          onMouseEnter={e => (e.currentTarget.style.background = "#F7F9FB")}
          onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
        >
          <span style={S.rowBtnLabel}>Change Password</span>
          <span style={S.rowBtnSub}>Update your password regularly for security</span>
        </button>
      </div>
    </div>
  );

  const BillingTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <p style={S.sectionTitle}>Billing & Subscription</p>
        <p style={S.sectionSub}>Manage your subscription and billing information.</p>
      </div>

      {/* Current plan card */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={S.cardTitle}>Current Plan</span>
            {isPaid && <span style={S.badgeGreen}>Active</span>}
          </div>
          <p style={{ ...S.cardSubtitle, marginTop: "0.25rem" }}>{planDisplayName}</p>
        </div>
        <div style={S.cardBody}>
          {subscription.loading ? (
            <p style={{ color: "#6E7580", fontSize: "0.9375rem" }}>Loading…</p>
          ) : (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <div style={S.usageRow}>
                  <span style={{ color: "#6E7580" }}>AI Analysis</span>
                  <span style={{ fontWeight: 600, color: "#141820" }}>
                    {usage.aiAnalysis} / {currentPlanLimits.analysisLimit}
                  </span>
                </div>
                <div style={{ ...S.usageRow, borderBottom: "none" }}>
                  <span style={{ color: "#6E7580" }}>eBay Publishes</span>
                  <span style={{ fontWeight: 600, color: "#141820" }}>
                    {usage.ebayPublish} / {currentPlanLimits.publishLimit}
                  </span>
                </div>
              </div>
              {isPaid && (
                <button
                  onClick={handleManage}
                  disabled={portalLoading}
                  style={{ ...S.btnOutline, opacity: portalLoading ? 0.6 : 1 }}
                >
                  {portalLoading ? "Loading…" : "Manage Billing Portal"}
                  <ExternalLink size={15} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Upgrade options */}
      {!isShop && (
        <div>
          <p style={{ fontSize: "1.0625rem", fontWeight: 700, color: "#141820", marginBottom: "1rem" }}>
            Upgrade Your Plan
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            {currentPlan === "free" && (
              <UpgradeCard
                icon={Crown} name="Starter" price="$19/mo"
                features={["25 listings / month", "Basic AI enhancement"]}
                onUpgrade={() => handleCheckout("starter")}
                loading={checkoutLoading === "starter"}
                disabled={checkoutLoading !== null}
              />
            )}
            {(currentPlan === "free" || currentPlan === "starter") && (
              <UpgradeCard
                icon={Zap} name="Pro" price="$49/mo"
                features={["200 listings / month", "Voice notes + melt protection", "Listing analytics"]}
                onUpgrade={() => handleCheckout("pro")}
                loading={checkoutLoading === "pro"}
                disabled={checkoutLoading !== null}
                recommended
              />
            )}
            {currentPlan !== "shop" && (
              <UpgradeCard
                icon={Store} name="Shop" price="$99/mo"
                features={["~1,200 listings / month", "Everything in Pro", "Team / multi-user org"]}
                onUpgrade={() => handleCheckout("shop")}
                loading={checkoutLoading === "shop"}
                disabled={checkoutLoading !== null}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );

  const IntegrationsTab = (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <p style={S.sectionTitle}>Integrations</p>
        <p style={S.sectionSub}>Connect third-party platforms to expand your selling capabilities.</p>
      </div>

      {/* eBay */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <span style={S.cardTitle}>eBay Integration</span>
              {ebayConnected && (
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
              )}
            </div>
            {ebayConnected && <span style={S.badgeGreen}>Connected</span>}
          </div>
          <p style={S.cardSubtitle}>
            {ebayConnected
              ? "Your eBay account is connected. You can manage listings and view performance data."
              : "Connect your eBay account to manage listings and track performance."}
          </p>
        </div>
        <div style={S.cardBody}>
          {!ebayConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <p style={{ fontSize: "0.9375rem", color: "#6E7580" }}>
                Authorize Teckstart to access your eBay account. You can revoke access at any time.
              </p>
              <button
                onClick={handleConnectEbay}
                disabled={connectingEbay}
                style={{ ...S.btnPrimary, opacity: connectingEbay ? 0.7 : 1 }}
              >
                {connectingEbay
                  ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Connecting…</>
                  : <><Zap size={17} /> Connect eBay Account</>}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <div style={{
                display: "flex", alignItems: "flex-start", gap: "0.75rem",
                background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: 8, padding: "0.875rem 1rem",
              }}>
                <Check size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#15803d", margin: 0 }}>Connection Active</p>
                  <p style={{ fontSize: "0.875rem", color: "#16a34a", margin: "0.125rem 0 0" }}>Your eBay account is ready to use</p>
                </div>
              </div>
              <button onClick={handleDisconnectEbay} style={S.btnDanger}>
                Disconnect eBay Account
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Coming soon */}
      <div style={{ ...S.card, opacity: 0.55, border: "1px dashed #B0B7BC" }}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Coming Soon</span>
          <p style={S.cardSubtitle}>We're working on integrations with other platforms.</p>
        </div>
        <div style={S.cardBody}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {["Amazon", "Shopify", "More…"].map(p => (
              <span key={p} style={{
                padding: "0.375rem 0.75rem", borderRadius: 8, background: "#F7F9FB",
                border: "1px solid #E4E7EC", fontSize: "0.875rem", color: "#6E7580", fontWeight: 500,
              }}>
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    profile:      ProfileTab,
    billing:      BillingTab,
    integrations: IntegrationsTab,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div style={S.page}>
        {/* Desktop layout */}
        <div className="hidden lg:block" style={S.inner}>
          {/* Page header */}
          <div style={S.pageHeader}>
            <h1 style={S.pageTitle}>Settings</h1>
            <p style={S.pageSubtitle}>Manage your profile, billing, and integrations</p>
          </div>

          {/* Usage Summary */}
          <div style={S.usageSection}>
            <UsageSummaryCard
              metrics={[
                {
                  label: "AI Analyses",
                  used: usage.aiAnalysis,
                  limit: currentPlanLimits.analysisLimit,
                },
                {
                  label: "eBay Publishes",
                  used: usage.ebayPublish,
                  limit: currentPlanLimits.publishLimit,
                },
              ]}
              planName={currentPlan === "free" ? "Free" : currentPlan === "starter" ? "Starter" : currentPlan === "pro" ? "Pro" : currentPlan === "shop" ? "Shop" : "Unlimited"}
            />
          </div>

          {/* Two-column: tab list + content */}
          <div style={S.twoCol}>
            {/* Tab list */}
            <div style={S.tabList}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  style={S.tabBtn(activeTab === tab.id)}
                  onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.background = "#F7F9FB"; }}
                  onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.background = "transparent"; }}
                >
                  <tab.icon size={17} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div>
              {tabContent[activeTab]}
            </div>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="lg:hidden" style={S.innerMobile}>
          {/* Page header */}
          <div style={{ marginBottom: "1rem" }}>
            <h1 style={{ ...S.pageTitle, fontSize: "1.25rem" }}>Settings</h1>
          </div>

          {/* Usage Summary */}
          <div style={{ ...S.usageSection, marginTop: "0.5rem" }}>
            <UsageSummaryCard
              metrics={[
                {
                  label: "AI Analyses",
                  used: usage.aiAnalysis,
                  limit: currentPlanLimits.analysisLimit,
                },
                {
                  label: "eBay Publishes",
                  used: usage.ebayPublish,
                  limit: currentPlanLimits.publishLimit,
                },
              ]}
              planName={currentPlan === "free" ? "Free" : currentPlan === "starter" ? "Starter" : currentPlan === "pro" ? "Pro" : currentPlan === "shop" ? "Shop" : "Unlimited"}
            />
          </div>

          {/* Horizontal tab bar */}
          <div style={S.mobileTabBar}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={S.mobileTabBtn(activeTab === tab.id)}
              >
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          {tabContent[activeTab]}
        </div>
      </div>

      <ProfileModal open={showProfileModal} onClose={() => setShowProfileModal(false)} />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}