import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Settings, User, CreditCard, Zap, Loader2, Check, ExternalLink, AlertCircle } from "lucide-react";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";
import ProfileModal from "@/components/ProfileModal";
import teckstartLogo from "@/assets/teckstart-logo.png";

const EBAY_TOKEN_KEY = "ebay-user-token";

type SettingsTab = "profile" | "billing" | "integrations";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isPro, isUnlimited, isPaid, subscription, usage, refreshSubscription, currentPlanLimits, isOwner } = useAuth();
  const paramTab = searchParams.get("tab") as SettingsTab | null;
  const initialTab = (paramTab && ["profile", "billing", "integrations"].includes(paramTab) ? paramTab : "profile") as SettingsTab;
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [connectingEbay, setConnectingEbay] = useState(false);
  const [ebayConnected, setEbayConnected] = useState(!!localStorage.getItem(EBAY_TOKEN_KEY));
  const [showProfileModal, setShowProfileModal] = useState(false);

  const handleCheckout = async (planKey: "pro" | "unlimited") => {
    setCheckoutLoading(planKey);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: PLANS[planKey].priceId },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
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
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const handleConnectEbay = async () => {
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

      window.location.href = authUrl;
    } catch (err: any) {
      console.error("eBay connect error:", err);
      toast.error(err.message || "Failed to start eBay connection");
      setConnectingEbay(false);
    }
  };

  const handleDisconnectEbay = () => {
    localStorage.removeItem(EBAY_TOKEN_KEY);
    localStorage.removeItem("ebay-refresh-token");
    localStorage.removeItem("ebay-token-expires-at");
    setEbayConnected(false);
    toast.success("eBay account disconnected");
  };

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    ...(isOwner ? [{ id: "billing" as const, label: "Billing", icon: CreditCard }] : []),
    { id: "integrations" as const, label: "Integrations", icon: Zap },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-40">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-secondary transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Settings className="w-6 h-6" />
              <h1 className="text-lg font-bold">Settings</h1>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px border-b border-border">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSearchParams({ tab: tab.id }, { replace: true });
                  }}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-5 py-8 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto">
          {/* Profile Tab */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground mb-4">Profile Settings</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Manage your account information and preferences.
                </p>
              </div>

              <button
                onClick={() => setShowProfileModal(true)}
                className="px-4 py-3 rounded-xl border border-border bg-card hover:bg-secondary transition-colors text-left"
              >
                <p className="text-sm font-medium text-foreground">Edit Profile</p>
                <p className="text-xs text-muted-foreground mt-1">Update your name, email, and display preferences</p>
              </button>

              <div className="border-t border-border pt-6">
                <h3 className="font-semibold text-foreground mb-3">Security</h3>
                <button className="px-4 py-3 rounded-xl border border-border bg-card hover:bg-secondary transition-colors text-left">
                  <p className="text-sm font-medium text-foreground">Change Password</p>
                  <p className="text-xs text-muted-foreground mt-1">Update your password regularly for security</p>
                </button>
              </div>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === "billing" && isOwner && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground mb-2">Billing & Subscription</h2>
                <p className="text-sm text-muted-foreground">Manage your subscription and billing information.</p>
              </div>

              {/* Current Plan */}
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-foreground">Current Plan</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isUnlimited
                        ? "Unlimited - $49.99/month"
                        : isPro
                          ? "Pro - $19.99/month"
                          : "Starter - Free"}
                    </p>
                  </div>
                  {isPaid && (
                    <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-600 text-xs font-medium">
                      Active
                    </span>
                  )}
                </div>

                {subscription.loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <>
                    <div className="space-y-2 text-sm mb-4">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">AI Analysis</span>
                        <span className="font-medium">{usage.aiAnalysis} / {currentPlanLimits.analysisLimit === Infinity ? "∞" : currentPlanLimits.analysisLimit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">eBay Publishes</span>
                        <span className="font-medium">{usage.ebayPublish} / {currentPlanLimits.publishLimit === Infinity ? "∞" : currentPlanLimits.publishLimit}</span>
                      </div>
                    </div>

                    {isPaid && (
                      <button
                        onClick={handleManage}
                        disabled={portalLoading}
                        className="w-full py-2 rounded-lg border border-border hover:bg-secondary transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {portalLoading ? "Loading..." : "Manage Billing Portal"}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Plan Comparison */}
              {!isPaid && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-foreground">Upgrade Your Plan</h3>

                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Pro Plan */}
                    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-5 h-5 text-primary" />
                        <h4 className="font-semibold text-foreground">Pro</h4>
                      </div>
                      <p className="text-2xl font-bold text-foreground mb-4">$19.99/mo</p>
                      <ul className="space-y-2 mb-6 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500" />
                          <span className="text-muted-foreground">50 AI Analyses</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500" />
                          <span className="text-muted-foreground">25 eBay Publishes</span>
                        </li>
                      </ul>
                      <button
                        onClick={() => handleCheckout("pro")}
                        disabled={checkoutLoading === "pro"}
                        className="w-full py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {checkoutLoading === "pro" ? "Loading..." : "Upgrade to Pro"}
                      </button>
                    </div>

                    {/* Unlimited Plan */}
                    <div className="bg-card border border-border rounded-xl p-6 relative hover:border-primary/50 transition-colors ring-1 ring-primary/20">
                      <span className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-bl-lg">
                        RECOMMENDED
                      </span>
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-5 h-5 text-primary" />
                        <h4 className="font-semibold text-foreground">Unlimited</h4>
                      </div>
                      <p className="text-2xl font-bold text-foreground mb-4">$49.99/mo</p>
                      <ul className="space-y-2 mb-6 text-sm">
                        <li className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500" />
                          <span className="text-muted-foreground">Unlimited AI Analyses</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-500" />
                          <span className="text-muted-foreground">Unlimited eBay Publishes</span>
                        </li>
                      </ul>
                      <button
                        onClick={() => handleCheckout("unlimited")}
                        disabled={checkoutLoading === "unlimited"}
                        className="w-full py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {checkoutLoading === "unlimited" ? "Loading..." : "Upgrade to Unlimited"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === "integrations" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-foreground mb-2">Integrations</h2>
                <p className="text-sm text-muted-foreground">Connect third-party platforms to expand your selling capabilities.</p>
              </div>

              {/* eBay Integration */}
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      eBay Integration
                      {ebayConnected && <span className="inline-block w-2 h-2 bg-green-500 rounded-full" />}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {ebayConnected
                        ? "Your eBay account is connected. You can manage listings and view performance data."
                        : "Connect your eBay account to manage listings and track performance."}
                    </p>
                  </div>
                  {ebayConnected && (
                    <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-600 text-xs font-medium">
                      Connected
                    </span>
                  )}
                </div>

                {!ebayConnected ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Authorize Teckstart to access your eBay account. You can revoke access at any time.
                    </p>
                    <button
                      onClick={handleConnectEbay}
                      disabled={connectingEbay}
                      className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {connectingEbay ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Connecting…
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Connect eBay Account
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-start gap-3">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-green-700">Connection Active</p>
                        <p className="text-xs text-green-600 mt-0.5">Your eBay account is ready to use</p>
                      </div>
                    </div>
                    <button
                      onClick={handleDisconnectEbay}
                      className="w-full py-2 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
                    >
                      Disconnect eBay Account
                    </button>
                  </div>
                )}
              </div>

              {/* Future Integrations */}
              <div className="bg-card border border-border border-dashed rounded-xl p-6 opacity-50">
                <h3 className="font-semibold text-foreground mb-2">Coming Soon</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  We're working on integrations with other platforms.
                </p>
                <div className="flex gap-2">
                  <div className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium text-muted-foreground">Amazon</div>
                  <div className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium text-muted-foreground">Shopify</div>
                  <div className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium text-muted-foreground">More...</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
      <ProfileModal open={showProfileModal} onClose={() => setShowProfileModal(false)} />
    </div>
  );
}
