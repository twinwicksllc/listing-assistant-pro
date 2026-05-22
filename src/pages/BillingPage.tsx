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

type BillingCycle = "monthly" | "annual";

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
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

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
      if (!("monthlyPriceId" in plan)) throw new Error("No price configured for this plan");
      const priceId = billingCycle === "annual" ? plan.annualPriceId : plan.monthlyPriceId;
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to start checkout");
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
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  // Ordered tier list for comparison
  const tierOrder: PlanKey[] = ["free", "starter", "pro", "shop"];
  const currentTierIndex = tierOrder.indexOf(currentPlan);

  // Icon per plan
  const planIcons: Record<PlanKey, React.ElementType> = {
    free: Sparkles,
    starter: Crown,
    pro: Zap,
    shop: Store,
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <img src={teckstartLogo} alt="Logo" className="h-8 w-8" />
          <h1 className="text-2xl font-bold">Plans & Billing</h1>
        </div>

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
            🎉 Your subscription is being activated...
          </div>
        )}
        {canceled && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
            Checkout was canceled. You can upgrade anytime.
          </div>
        )}

        {/* Current usage */}
        <div className="mb-6 p-4 bg-muted/50 rounded-xl border">
          <h2 className="text-sm font-semibold mb-3">
            {currentPlan === "free" ? "Rolling Window Credits" : "This Month's Usage"}
          </h2>
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">
                {currentPlan === "free" ? "AI Analyses (Rolling)" : "AI Analyses"}
              </span>
              <p className="font-semibold">
                {currentPlan === "free" && freeCreditStatus
                  ? freeCreditStatus.creditsUsed
                  : usage.aiAnalysis}{" "}
                / {currentPlanLimits.analysisLimit === Infinity ? "∞" : currentPlanLimits.analysisLimit}
              </p>
              {currentPlan === "free" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {freeCreditsLoading
                    ? "Loading reset date..."
                    : freeCreditStatus?.creditsResetAt
                    ? `Resets ${new Date(freeCreditStatus.creditsResetAt).toLocaleDateString()}`
                    : "Resets monthly (rolling window)"}
                </p>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">eBay Publishes</span>
              <p className="font-semibold">
                {usage.ebayPublish}{" "}
                / {currentPlanLimits.publishLimit === Infinity ? "∞" : currentPlanLimits.publishLimit}
              </p>
            </div>
          </div>
          {currentPlan === "free" && (freeCreditStatus?.limitReached || usage.aiAnalysis >= currentPlanLimits.analysisLimit) && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              🔄 Rolling window credits exhausted.
              {freeCreditStatus?.creditsResetAt
                ? ` Credits reset on ${new Date(freeCreditStatus.creditsResetAt).toLocaleDateString()}.`
                : ""}
            </p>
          )}
        </div>

        {/* Free tier requirements info */}
        {currentPlan === "free" && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm">
            <h3 className="font-semibold mb-2">Free Tier Requirements</h3>
            <ul className="space-y-1 text-blue-800">
              <li>✓ <strong>eBay Account Required:</strong> You must connect an active eBay account to generate listings</li>
              <li>✓ <strong>Rolling Window:</strong> 6 analyses per month, resets on the same day each month</li>
              <li>✓ <strong>One Account Per Org:</strong> You can only link one eBay account to your organization</li>
            </ul>
            <Link to="/settings" className="inline-flex items-center gap-1 mt-2 text-blue-700 font-medium hover:underline text-xs">
              Go to Settings <span>→</span>
            </Link>
          </div>
        )}

        {/* Billing Cycle Toggle */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                billingCycle === "monthly"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                billingCycle === "annual"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Annual
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* ── Free ── */}
          <PlanCard
            name={PLANS.free.name}
            price="$0"
            period=""
            annualPrice=""
            icon={planIcons.free}
            isCurrent={currentPlan === "free"}
            features={["6 AI analyses/mo", "6 eBay publishes/mo", "eBay account required"]}
            currentPlan={currentPlan}
            planKey="free"
            tierOrder={tierOrder}
            billingCycle={billingCycle}
          />

          {/* ── Starter ── */}
          <PlanCard
            name={PLANS.starter.name}
            price="$19"
            period="/mo"
            annualPrice="$190/yr"
            icon={planIcons.starter}
            isCurrent={currentPlan === "starter"}
            features={["25 AI analyses/mo", "25 eBay publishes/mo", "Basic AI enhancement"]}
            currentPlan={currentPlan}
            planKey="starter"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("starter")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
            billingCycle={billingCycle}
          />

          {/* ── Pro ── */}
          <PlanCard
            name={PLANS.pro.name}
            price="$49"
            period="/mo"
            annualPrice="$490/yr"
            icon={planIcons.pro}
            isCurrent={currentPlan === "pro"}
            badge="Most Popular"
            features={["200 AI analyses/mo", "200 eBay publishes/mo", "Full AI enhancement", "Voice notes", "Melt protection", "COGS tracking"]}
            currentPlan={currentPlan}
            planKey="pro"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("pro")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
            billingCycle={billingCycle}
          />

          {/* ── Shop ── */}
          <PlanCard
            name={PLANS.shop.name}
            price="$99"
            period="/mo"
            annualPrice="$990/yr"
            icon={planIcons.shop}
            isCurrent={currentPlan === "shop"}
            features={["1,200 AI analyses/mo", "1,200 eBay publishes/mo", "Full AI enhancement", "Voice notes", "Melt protection", "Team / org features", "COGS tracking"]}
            currentPlan={currentPlan}
            planKey="shop"
            tierOrder={tierOrder}
            onUpgrade={() => handleCheckout("shop")}
            onManage={handleManage}
            checkoutLoading={checkoutLoading}
            portalLoading={portalLoading}
            subscriptionEnd={subscription.subscriptionEnd}
            billingCycle={billingCycle}
          />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

// ─── Reusable Plan Card Component ───────────────────────────────────────────────────────

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  annualPrice: string;
  icon: React.ElementType;
  isCurrent: boolean;
  badge?: string;
  features: string[];
  currentPlan: PlanKey;
  planKey: PlanKey;
  tierOrder: PlanKey[];
  billingCycle: BillingCycle;
  onUpgrade?: () => void;
  onManage?: () => void;
  checkoutLoading?: string | null;
  portalLoading?: boolean;
  subscriptionEnd?: string | null;
}

function PlanCard({
  name, price, period, annualPrice, icon: Icon, isCurrent, badge, features,
  currentPlan, planKey, tierOrder, billingCycle,
  onUpgrade, onManage, checkoutLoading, portalLoading, subscriptionEnd,
}: PlanCardProps) {
  const currentIndex = tierOrder.indexOf(currentPlan);
  const thisIndex = tierOrder.indexOf(planKey);
  const isUpgrade = thisIndex > currentIndex;
  const isDowngrade = thisIndex < currentIndex;
  const isPaidPlan = planKey !== "free";

  const displayPrice = isPaidPlan && billingCycle === "annual" ? annualPrice : `${price}${period}`;
  const monthlyEquiv = isPaidPlan && billingCycle === "annual"
    ? `(~${price.replace("$", "$")}${period} billed annually)`
    : null;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 transition-shadow ${
        isCurrent ? "border-primary ring-1 ring-primary shadow-md" : "border-border hover:shadow-sm"
      }`}
    >
      {badge && !isCurrent && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      {isCurrent && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
          Your Plan
        </span>
      )}

      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-base">{name}</h3>
      </div>

      <div className="mb-1">
        <span className="text-2xl font-extrabold">{displayPrice}</span>
      </div>
      {monthlyEquiv && (
        <p className="text-xs text-muted-foreground mb-3">{monthlyEquiv}</p>
      )}

      <ul className="space-y-1.5 mb-4 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {/* Actions */}
      {isCurrent && isPaidPlan ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Renews {subscriptionEnd ? new Date(subscriptionEnd).toLocaleDateString() : "—"}
          </p>
          <button
            onClick={onManage}
            disabled={portalLoading}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-60"
          >
            {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Manage Subscription
          </button>
        </div>
      ) : isCurrent && !isPaidPlan ? (
        <div className="py-2 text-center text-sm text-muted-foreground font-medium">Current plan</div>
      ) : isUpgrade && isPaidPlan ? (
        <div className="space-y-2">
          <button
            onClick={onUpgrade}
            disabled={!!checkoutLoading}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {checkoutLoading === planKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Upgrade to {name}
          </button>
          <p className="text-xs text-muted-foreground text-center">
            Refund Policy: Prorated refunds allowed within 30 days of purchase.
          </p>
          <p className="text-xs text-muted-foreground text-center">
            By proceeding, you agree to our{" "}
            <Link to="/terms" className="underline">Terms</Link> and{" "}
            <Link to="/privacy" className="underline">Privacy Policy</Link>
          </p>
        </div>
      ) : isDowngrade ? (
        <button
          onClick={onManage}
          disabled={portalLoading}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-60"
        >
          {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Downgrade
        </button>
      ) : null}
    </div>
  );
}
