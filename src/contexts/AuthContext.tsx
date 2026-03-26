import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// ─── 4-Tier Plan Configuration ──────────────────────────────────────────────
// Stripe product/price IDs are placeholders — update with real values after
// creating them in the Stripe Dashboard.
export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    publishLimit: 6,
    analysisLimit: 6,
    hasAiEnhancement: false,
    hasVoiceNotes: false,
    hasMeltProtection: false,
    hasListingAnalytics: false,
    hasOrgFeature: false,
    hasCogsTracking: false,
  },
  starter: {
    name: "Starter",
    price: 19,
    publishLimit: 25,
    analysisLimit: 25,
    priceId: "price_1T8lVU4bX0d1SiThMDayhDj5",   // TODO: confirm or replace
    productId: "prod_U6zUiC1SYuPrGU",              // TODO: confirm or replace
    hasAiEnhancement: true,   // basic AI enhancement
    hasVoiceNotes: false,
    hasMeltProtection: false,
    hasListingAnalytics: false,
    hasOrgFeature: false,
    hasCogsTracking: false,
  },
  pro: {
    name: "Pro",
    price: 49,
    publishLimit: 200,
    analysisLimit: 200,
    priceId: "price_1T8mZ84bX0d1SiThFgvRubiN",    // TODO: confirm or replace
    productId: "prod_U70aT1KvuI2uDx",              // TODO: confirm or replace
    hasAiEnhancement: true,   // full AI enhancement
    hasVoiceNotes: true,
    hasMeltProtection: true,
    hasListingAnalytics: true,
    hasOrgFeature: false,
    hasCogsTracking: true,    // COGS tracking + Profit Report
  },
  shop: {
    name: "Shop",
    price: 99,
    publishLimit: 1200,       // soft threshold
    analysisLimit: 1200,      // soft threshold
    priceId: "price_SHOP_PLACEHOLDER",              // TODO: create in Stripe
    productId: "prod_SHOP_PLACEHOLDER",             // TODO: create in Stripe
    hasAiEnhancement: true,   // full AI enhancement
    hasVoiceNotes: true,
    hasMeltProtection: true,
    hasListingAnalytics: true,
    hasOrgFeature: true,
    hasCogsTracking: true,    // COGS tracking + Profit Report
  },
} as const;

export type PlanKey = keyof typeof PLANS;

// Admin emails that always get full Shop-level access regardless of subscription
const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];

export type OrgRole = "owner" | "lister";

interface SubscriptionState {
  subscribed: boolean;
  productId: string | null;
  subscriptionEnd: string | null;
  status: string | null;           // 'active' | 'trialing' | 'past_due' | 'canceled' | null
  cancelAtPeriodEnd: boolean;      // true = will cancel at end of billing period
  loading: boolean;
}

interface UsageState {
  aiAnalysis: number;
  ebayPublish: number;
}

interface OrgState {
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
  loading: boolean;
}

interface PlanFeatures {
  hasAiEnhancement: boolean;
  hasVoiceNotes: boolean;
  hasMeltProtection: boolean;
  hasListingAnalytics: boolean;
  hasOrgFeature: boolean;
  hasCogsTracking: boolean;  // True profit / COGS tracking + Profit Report page
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  subscription: SubscriptionState;
  usage: UsageState;
  refreshSubscription: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  // Tier booleans
  currentPlan: PlanKey;
  isStarter: boolean;
  isPro: boolean;
  isShop: boolean;
  isPaid: boolean;
  isPastDue: boolean;
  isAdmin: boolean;
  // Feature flags (derived from plan)
  planFeatures: PlanFeatures;
  // Legacy aliases kept for backward-compat during migration
  isUnlimited: boolean;
  // Usage gates
  canAnalyze: boolean;
  canPublish: boolean;
  recordUsage: (actionType: "ai_analysis" | "ebay_publish" | "optimize" | "export") => Promise<void>;
  org: OrgState;
  isOwner: boolean;
  isLister: boolean;
  refreshOrg: () => Promise<void>;
  currentPlanLimits: { analysisLimit: number; publishLimit: number };
}

const defaultFeatures: PlanFeatures = {
  hasAiEnhancement: false,
  hasVoiceNotes: false,
  hasMeltProtection: false,
  hasListingAnalytics: false,
  hasOrgFeature: false,
  hasCogsTracking: false,
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  subscription: { subscribed: false, productId: null, subscriptionEnd: null, status: null, cancelAtPeriodEnd: false, loading: true },
  usage: { aiAnalysis: 0, ebayPublish: 0 },
  refreshSubscription: async () => {},
  refreshUsage: async () => {},
  currentPlan: "free",
  isStarter: false,
  isPro: false,
  isShop: false,
  isPaid: false,
  isPastDue: false,
  isAdmin: false,
  planFeatures: defaultFeatures,
  isUnlimited: false,
  canAnalyze: true,
  canPublish: true,
  recordUsage: async () => {},
  org: { orgId: null, orgName: null, role: null, loading: true },
  isOwner: false,
  isLister: false,
  refreshOrg: async () => {},
  currentPlanLimits: { analysisLimit: 6, publishLimit: 6 },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({
    subscribed: false,
    productId: null,
    subscriptionEnd: null,
    status: null,
    cancelAtPeriodEnd: false,
    loading: true,
  });
  const [usage, setUsage] = useState<UsageState>({ aiAnalysis: 0, ebayPublish: 0 });
  const [org, setOrg] = useState<OrgState>({ orgId: null, orgName: null, role: null, loading: true });

  const refreshOrg = useCallback(async () => {
    try {
      const { data: memberData, error: memberError } = await supabase
        .from("org_members")
        .select("org_id, role")
        .limit(1)
        .single();

      if (memberError || !memberData) {
        setOrg({ orgId: null, orgName: null, role: null, loading: false });
        return;
      }

      const { data: orgData } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", memberData.org_id)
        .single();

      setOrg({
        orgId: memberData.org_id,
        orgName: orgData?.name || null,
        role: memberData.role as OrgRole,
        loading: false,
      });
    } catch {
      setOrg((s) => ({ ...s, loading: false }));
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("check-subscription");
      if (error) throw error;
      setSubscription({
        subscribed: data.subscribed ?? false,
        productId: data.product_id ?? null,
        subscriptionEnd: data.subscription_end ?? null,
        status: data.status ?? null,
        cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
        loading: false,
      });
    } catch {
      setSubscription((s) => ({ ...s, loading: false }));
    }
  }, []);

  const refreshUsage = useCallback(async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("usage_tracking")
      .select("action_type")
      .gte("created_at", startOfMonth.toISOString());

    if (!error && data) {
      setUsage({
        aiAnalysis: data.filter((r: any) => r.action_type === "ai_analysis").length,
        ebayPublish: data.filter((r: any) => r.action_type === "ebay_publish").length,
      });
    }
  }, []);

  const recordUsage = useCallback(async (actionType: "ai_analysis" | "ebay_publish" | "optimize" | "export") => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    await supabase.from("usage_tracking").insert({ user_id: user.id, action_type: actionType });
    await refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
        if (session) {
          setTimeout(() => { refreshSubscription(); refreshUsage(); refreshOrg(); }, 0);
        } else {
          setSubscription({ subscribed: false, productId: null, subscriptionEnd: null, status: null, cancelAtPeriodEnd: false, loading: false });
          setUsage({ aiAnalysis: 0, ebayPublish: 0 });
          setOrg({ orgId: null, orgName: null, role: null, loading: false });
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session) {
        refreshSubscription();
        refreshUsage();
        refreshOrg();
      } else {
        setSubscription((s) => ({ ...s, loading: false }));
        setOrg((s) => ({ ...s, loading: false }));
      }
    });

    return () => authSub.unsubscribe();
  }, [refreshSubscription, refreshUsage, refreshOrg]);

  // Refresh subscription every 60s
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(refreshSubscription, 60000);
    return () => clearInterval(interval);
  }, [session, refreshSubscription]);

  // ─── Derived tier values ──────────────────────────────────────────────────
  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email ?? "");
  const isActivePaid = subscription.subscribed || subscription.status === "trialing";

  // Determine current plan from product ID
  const resolvedPlan: PlanKey = (() => {
    if (isAdmin) return "shop";
    if (!isActivePaid) return "free";
    if (subscription.productId === PLANS.shop.productId) return "shop";
    if (subscription.productId === PLANS.pro.productId) return "pro";
    if (subscription.productId === PLANS.starter.productId) return "starter";
    return "free";
  })();

  const isStarter = resolvedPlan === "starter";
  const isPro = resolvedPlan === "pro";
  const isShop = resolvedPlan === "shop";
  const isPaid = isStarter || isPro || isShop;
  const isPastDue = subscription.status === "past_due";

  // Legacy alias
  const isUnlimited = isShop;

  // Feature flags for current plan
  const planFeatures: PlanFeatures = {
    hasAiEnhancement: PLANS[resolvedPlan].hasAiEnhancement,
    hasVoiceNotes: PLANS[resolvedPlan].hasVoiceNotes,
    hasMeltProtection: PLANS[resolvedPlan].hasMeltProtection,
    hasListingAnalytics: PLANS[resolvedPlan].hasListingAnalytics,
    hasOrgFeature: PLANS[resolvedPlan].hasOrgFeature,
    hasCogsTracking: PLANS[resolvedPlan].hasCogsTracking,
  };

  // Limits for current plan
  const currentPlanLimits = {
    analysisLimit: PLANS[resolvedPlan].analysisLimit,
    publishLimit: PLANS[resolvedPlan].publishLimit,
  };

  // Usage gates — Shop plan uses soft threshold (warn but don't hard-block)
  const finalCanAnalyze = usage.aiAnalysis < currentPlanLimits.analysisLimit;
  const finalCanPublish = usage.ebayPublish < currentPlanLimits.publishLimit;

  const isOwner = org.role === "owner";
  const isLister = org.role === "lister";

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut,
        subscription,
        usage,
        refreshSubscription,
        refreshUsage,
        currentPlan: resolvedPlan,
        isStarter,
        isPro,
        isShop,
        isPaid,
        isPastDue,
        isAdmin,
        planFeatures,
        isUnlimited,
        canAnalyze: finalCanAnalyze,
        canPublish: finalCanPublish,
        recordUsage,
        org,
        isOwner,
        isLister,
        refreshOrg,
        currentPlanLimits,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);