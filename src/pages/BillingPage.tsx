import { useState } from "react";
import { Check, Crown, Zap, Loader2, ExternalLink, ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";
import teckstartLogo from "@/assets/teckstart-logo.png";

export default function BillingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isPro, subscription, usage, refreshSubscription } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Show success/cancel messages from redirect
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  if (success) {
    setTimeout(() => refreshSubscription(), 2000);
  }

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout");
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setCheckoutLoading(false);
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

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <img src={teckstartLogo} alt="Teckstart" className="h-9 w-auto" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Billing</h1>
            <p className="text-xs text-muted-foreground">Manage your subscription</p>
          </div>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-6">
        {/* Status messages */}
        {success && (
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 text-sm text-primary font-medium">
            🎉 Welcome to Pro! Your subscription is being activated...
          </div>
        )}
        {canceled && (
          <div className="bg-muted border border-border rounded-xl p-4 text-sm text-muted-foreground">
            Checkout was canceled. You can upgrade anytime.
          </div>
        )}

        {/* Current usage */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">This Month's Usage</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">AI Analyses</p>
              <p className="text-lg font-bold text-foreground">
                {usage.aiAnalysis}
                {!isPro && <span className="text-xs font-normal text-muted-foreground"> / {PLANS.starter.analysisLimit}</span>}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">eBay Publishes</p>
              <p className="text-lg font-bold text-foreground">
                {usage.ebayPublish}
                {!isPro && <span className="text-xs font-normal text-muted-foreground"> / {PLANS.starter.publishLimit}</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Plans */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Starter */}
          <div className={`bg-card border rounded-xl p-5 space-y-4 ${!isPro ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
            {!isPro && <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Your Plan</span>}
            <div>
              <h3 className="text-lg font-bold text-foreground">Starter</h3>
              <p className="text-2xl font-bold text-foreground">Free</p>
            </div>
            <ul className="space-y-2">
              {[`${PLANS.starter.analysisLimit} AI analyses / month`, `${PLANS.starter.publishLimit} eBay publishes / month`, "Basic item recognition", "Draft saving"].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            {!isPro && (
              <div className="pt-2">
                <span className="text-xs text-muted-foreground">Current plan</span>
              </div>
            )}
          </div>

          {/* Pro */}
          <div className={`bg-card border rounded-xl p-5 space-y-4 ${isPro ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
            {isPro && <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Your Plan</span>}
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-bold text-foreground">Pro</h3>
            </div>
            <p className="text-2xl font-bold text-foreground">
              $19<span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <ul className="space-y-2">
              {["Unlimited AI analyses", "Unlimited eBay publishes", "Priority processing", "Advanced item specifics", "Spot price integration"].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Zap className="w-4 h-4 text-primary flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            {isPro ? (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  Renews {subscription.subscriptionEnd ? new Date(subscription.subscriptionEnd).toLocaleDateString() : "—"}
                </p>
                <button
                  onClick={handleManage}
                  disabled={portalLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-60"
                >
                  {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  Manage Subscription
                </button>
              </div>
            ) : (
              <button
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {checkoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
