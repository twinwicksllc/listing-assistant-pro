import { useEffect, useState } from "react";
import { Check, Crown, Zap, Loader2, ExternalLink, ArrowLeft, Store, Sparkles } from "lucide-react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth, PLANS, PlanKey } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";
import teckstartLogo from "@/assets/teckstart-logo.png";

type FreeCreditStatus = {
  tier: "starter" | "pro" | "unlimited";
  creditsUsed: number;
  creditsRemaining: number | null;
  creditsResetAt: string | null;
  limitReached: boolean;
};

export default function BillingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    currentPlan, isPaid, isShop, subscription, usage,
    refreshSubscription, currentPlanLimits, planFeatures,
  } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [freeCreditStatus, setFreeCreditStatus] = useState<FreeCreditStatus | null>(null);
  const [freeCreditsLoading, setFreeCreditsLoading] = useState(false);

  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    let active = true;

    const fetchFreeCreditStatus = async () => {
      if (currentPlan !== "free") {
        if (active) setFreeCreditStatus(null);
        return;
      }

      setFreeCreditsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("get-free-credits", {
          body: {},
        });

        if (error) {
          throw error;
        }

        if (active && data && typeof data === "object") {
          setFreeCreditStatus(data as FreeCreditStatus);
        }
      } catch (err) {
        console.warn("Failed to load free-tier credit status", err);
      } finally {
        if (active) setFreeCreditsLoading(false);
      }
    };

    fetchFreeCreditStatus();
    return () => {
      active = false;
    };
  }, [currentPlan]);

  if (success) {
    setTimeout(() => refreshSubscription(), 2000);
  }

  const handleCheckout = async (planKey: "starter" | "pro" | "shop") => {
    setCheckoutLoading(planKey);
    try {
      const plan = PLANS[planKey];
      if (!("priceId" in plan)) throw new Error("No price configured for this plan");
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: plan.priceId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      toast.error(err.message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  // Ordered tier list for comparison
  const tierOrder: PlanKey[] = ["free", "starter", "pro", "shop"];
  const currentTierIndex = tierOrder.indexOf(currentPlan);

  // Icon per plan
  const planIcons: Record<PlanKey, typeof Sparkles> = {
    free: Sparkles,
    starter: Crown,
    pro: Zap,
    shop: Store,
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Billing</h1>
            <p className="text-xs text-muted-foreground">Manage your subscription</p>
          </div>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-5xl mx-auto space-y-6">
        {success && (
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 text-sm text-primary font-medium">
            🎉 Your subscription is being activated...
          </div>
        )}
        {canceled && (
          <div className="bg-muted border border-border rounded-xl p-4 text-sm text-muted-foreground">
            Checkout was canceled. You can upgrade anytime.
          </div>
        )}

        {/* Current usage */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {currentPlan === "free" ? "Rolling Window Credits" : "This Month's Usage"}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {currentPlan === "free" ? "AI Analyses (Rolling)" : "AI Analyses"}
              </p>
              <p className="text-lg font-bold text-foreground">
                {currentPlan === "free" && freeCreditStatus
                  ? freeCreditStatus.creditsUsed
                  : usage.aiAnalysis}
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}/ {currentPlanLimits.analysisLimit === Infinity ? "∞" : currentPlanLimits.analysisLimit}
                </span>
              </p>
              {currentPlan === "free" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {freeCreditsLoading
                    ? "Loading reset date..."
                    : freeCreditStatus?.creditsResetAt
                    ? `Resets ${new Date(freeCreditStatus.creditsResetAt).toLocaleDateString()}`
                    : "Resets monthly (rolling window)"}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">eBay Publishes</p>
              <p className="text-lg font-bold text-foreground">
                {usage.ebayPublish}
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}/ {currentPlanLimits.publishLimit === Infinity ? "∞" : currentPlanLimits.publishLimit}
                </span>
              </p>
            </div>
          </div>
          {currentPlan === "free" && (freeCreditStatus?.limitReached || usage.aiAnalysis >= currentPlanLimits.analysisLimit) && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                🔄 Rolling window credits exhausted.
                {freeCreditStatus?.creditsResetAt
                  ? ` Credits reset on ${new Date(freeCreditStatus.creditsResetAt).toLocaleDateString()}.`
                  : ""}
              </p>
            </div>
          )}
        </div>

        {/* Free tier requirements info */}
        {currentPlan === "free" && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">Free Tier Requirements</h3>
            <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                <span><strong>eBay Account Required:</strong> You must connect an active eBay account to generate listings</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                <span><strong>Rolling Window:</strong> 6 analyses per month, resets on the same day each month</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                <span><strong>One Account Per Org:</strong> You can only link one eBay account to your organization</span>
              </li>
            </ul>
            <Link to="/settings" className="inline-flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mt-2">
              Go to Settings
              <span>→</span>
            </Link>
          </div>
        )}

        {/* Plans Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">

          {/* ── Free ── */}
          <PlanCard
            name="Free"
            price="Free"
            period=""
            icon={Sparkles}
            isCurrent={currentPlan === "free"}
            features={[
              "6 listings / month",
              "Basic item recognition",
              "Draft saving",
            ]}
            currentPlan={currentPlan}
            planKey="free"
            tierOrder={tierOrder}
          />

          {/* ── Starter ── */}
          <PlanCard
            name="Starter"
            price="$19"
            period="/mo"
            icon={Crown}
            isCurrent={currentPlan === "starter"}
            features={[
              "25 listings / month",
              "Basic AI enhancement",
              "Draft saving",
              "eBay publishing",
            ]}
            currentPlan={currentPlan}
            planKey="starter"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("starter")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
          />

          {/* ── Pro ── */}
          <PlanCard
            name="Pro"
            price="$49"
            period="/mo"
            icon={Zap}
            isCurrent={currentPlan === "pro"}
            badge="Most Popular"
            features={[
              "200 listings / month",
              "Full AI enhancement",
              "Voice notes",
              "Melt value protection",
              "Listing analytics",
              "eBay sold comps",
              "True profit tracking (COGS)",
            ]}
            currentPlan={currentPlan}
            planKey="pro"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("pro")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
          />

          {/* ── Shop ── */}
          <PlanCard
            name="Shop"
            price="$99"
            period="/mo"
            icon={Store}
            isCurrent={currentPlan === "shop"}
            badge="Best Value"
            features={[
              "~1,200 listings / month",
              "Full AI & analytics",
              "Voice notes",
              "Melt value protection",
              "Team / multi-user org",
              "True profit tracking (COGS) + P&L report",
              "Priority support",
            ]}
            currentPlan={currentPlan}
            planKey="shop"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("shop")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
          />
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

// ─── Reusable Plan Card Component ──────────────────────────────────────────

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  icon: React.ElementType;
  isCurrent: boolean;
  badge?: string;
  features: string[];
  currentPlan: PlanKey;
  planKey: PlanKey;
  tierOrder: PlanKey[];
  onUpgrade?: () => void;
  onManage?: () => void;
  checkoutLoading?: string | null;
  portalLoading?: boolean;
  subscriptionEnd?: string | null;
}

function PlanCard({
  name, price, period, icon: Icon, isCurrent, badge, features,
  currentPlan, planKey, tierOrder,
  onUpgrade, onManage, checkoutLoading, portalLoading, subscriptionEnd,
}: PlanCardProps) {
  const currentIndex = tierOrder.indexOf(currentPlan);
  const thisIndex = tierOrder.indexOf(planKey);
  const isUpgrade = thisIndex > currentIndex;
  const isDowngrade = thisIndex < currentIndex;
  const isPaidPlan = planKey !== "free";

  return (
    <div className={`bg-card border rounded-xl p-5 space-y-4 relative overflow-hidden ${
      isCurrent ? "border-primary ring-2 ring-primary/20" : "border-border"
    }`}>
      {badge && !isCurrent && (
        <span className="absolute top-3 right-3 text-[10px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full uppercase tracking-wider">
          {badge}
        </span>
      )}
      {isCurrent && (
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
          Your Plan
        </span>
      )}

      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold text-foreground">{name}</h3>
      </div>

      <p className="text-2xl font-bold text-foreground">
        {price}
        {period && <span className="text-sm font-normal text-muted-foreground">{period}</span>}
      </p>

      <ul className="space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-primary flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {/* Actions */}
      {isCurrent && isPaidPlan ? (
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Renews {subscriptionEnd ? new Date(subscriptionEnd).toLocaleDateString() : "—"}
          </p>
          <button
            onClick={onManage}
            disabled={portalLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-60"
          >
            {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Manage Subscription
          </button>
        </div>
      ) : isCurrent && !isPaidPlan ? (
        <div className="pt-2">
          <span className="text-xs text-muted-foreground">Current plan</span>
        </div>
      ) : isUpgrade && isPaidPlan ? (
        <div className="space-y-3 pt-2">
          <button
            onClick={onUpgrade}
            disabled={checkoutLoading !== null}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {checkoutLoading === planKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
            Upgrade to {name}
          </button>
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Refund Policy:</span> Prorated refunds allowed within 30 days of purchase.
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>By proceeding, you agree to our</span>
              <Link to="/terms" className="text-primary hover:underline font-medium">Terms</Link>
              <span>and</span>
              <Link to="/privacy" className="text-primary hover:underline font-medium">Privacy Policy</Link>
            </div>
          </div>
        </div>
      ) : isDowngrade ? (
        <div className="pt-2">
          <button
            onClick={onManage}
            disabled={portalLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border text-muted-foreground text-sm font-medium hover:bg-secondary/50 transition-colors disabled:opacity-60"
          >
            {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Downgrade
          </button>
        </div>
      ) : null}
    </div>
  );
}