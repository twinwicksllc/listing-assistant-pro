import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const PLANS = {
  starter: { name: "Starter", price: 0, analysisLimit: 5, publishLimit: 3 },
  pro: {
    name: "Pro",
    price: 19.99,
    analysisLimit: 50,
    publishLimit: 25,
    priceId: "price_1T8lVU4bX0d1SiThMDayhDj5",
    productId: "prod_U6zUiC1SYuPrGU",
  },
  unlimited: {
    name: "Unlimited",
    price: 49.99,
    analysisLimit: Infinity,
    publishLimit: Infinity,
    priceId: "price_1T8mZ84bX0d1SiThFgvRubiN",
    productId: "prod_U70aT1KvuI2uDx",
  },
} as const;

export type OrgRole = "owner" | "lister";

interface SubscriptionState {
  subscribed: boolean;
  productId: string | null;
  subscriptionEnd: string | null;
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

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  subscription: SubscriptionState;
  usage: UsageState;
  refreshSubscription: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  isPro: boolean;
  isUnlimited: boolean;
  isPaid: boolean;
  canAnalyze: boolean;
  canPublish: boolean;
  recordUsage: (actionType: "ai_analysis" | "ebay_publish" | "optimize" | "export") => Promise<void>;
  org: OrgState;
  isOwner: boolean;
  isLister: boolean;
  refreshOrg: () => Promise<void>;
  currentPlanLimits: { analysisLimit: number; publishLimit: number };
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  subscription: { subscribed: false, productId: null, subscriptionEnd: null, loading: true },
  usage: { aiAnalysis: 0, ebayPublish: 0 },
  refreshSubscription: async () => {},
  refreshUsage: async () => {},
  isPro: false,
  isUnlimited: false,
  isPaid: false,
  canAnalyze: true,
  canPublish: true,
  recordUsage: async () => {},
  org: { orgId: null, orgName: null, role: null, loading: true },
  isOwner: false,
  isLister: false,
  refreshOrg: async () => {},
  currentPlanLimits: { analysisLimit: 5, publishLimit: 3 },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionState>({
    subscribed: false,
    productId: null,
    subscriptionEnd: null,
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
          setSubscription({ subscribed: false, productId: null, subscriptionEnd: null, loading: false });
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

  const isPro = subscription.subscribed && subscription.productId === PLANS.pro.productId;
  const isUnlimited = subscription.subscribed && subscription.productId === PLANS.unlimited.productId;
  const isPaid = isPro || isUnlimited;
  const currentPlanLimits = isUnlimited
    ? { analysisLimit: Infinity, publishLimit: Infinity }
    : isPro
      ? { analysisLimit: PLANS.pro.analysisLimit, publishLimit: PLANS.pro.publishLimit }
      : { analysisLimit: PLANS.starter.analysisLimit, publishLimit: PLANS.starter.publishLimit };
  // Unlimited users always have access; Pro users checked against Pro limits; Starter against Starter limits
  const finalCanAnalyze = isUnlimited
    ? true
    : isPro
      ? usage.aiAnalysis < PLANS.pro.analysisLimit
      : usage.aiAnalysis < PLANS.starter.analysisLimit;
  const finalCanPublish = isUnlimited
    ? true
    : isPro
      ? usage.ebayPublish < PLANS.pro.publishLimit
      : usage.ebayPublish < PLANS.starter.publishLimit;
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
        isPro,
        isUnlimited,
        isPaid,
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
