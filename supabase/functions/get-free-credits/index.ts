import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Extract auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ud } = await svc.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = ud?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine tier via subscriptions table (cache-first per Phase 2 refactoring)
    let tier: "starter" | "pro" | "unlimited" = "starter";
    
    try {
      const { data: subs, error: subError } = await svc
        .from("subscriptions")
        .select("stripe_product_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1);

      if (!subError && subs && subs.length > 0) {
        const productId = subs[0].stripe_product_id || (subs[0] as any).product_id;
        if (productId === "prod_U70aT1KvuI2uDx") tier = "unlimited";
        else if (productId === "prod_U6zUiC1SYuPrGU") tier = "pro";
      }
    } catch (err) {
      console.error("Tier detection error, defaulting to starter:", err);
    }

    // Resolve org for per-org quota (OQ-4)
    let orgId: string | null = null;
    let orgResetDay: number | null = null;

    if (tier === "starter") {
      const { data: orgMember } = await svc
        .from("org_members")
        .select("org_id, organizations(free_tier_reset_day)")
        .eq("user_id", userId)
        .limit(1);

      if (orgMember && orgMember.length > 0) {
        orgId = orgMember[0].org_id;
        orgResetDay = (orgMember[0].organizations as any)?.free_tier_reset_day ?? null;
      }
    }

    // Get current rolling-window start for free users
    let windowStart: string;
    if (tier === "starter" && orgResetDay) {
      const { data: wsData, error: wsErr } = await svc
        .rpc("get_free_tier_window_start", { p_reset_day: orgResetDay });
      windowStart = wsData ? new Date(wsData).toISOString() : new Date().toISOString();
    } else {
      // Pro/Unlimited: calendar month; or fresh start for NULL reset_day
      windowStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    }

    // Count per-org usage for Starter; per-user for Pro/Unlimited
    let usageCount = 0;
    if (tier !== "unlimited") {
      let query = svc
        .from("usage_tracking")
        .select("id", { count: "exact", head: true })
        .eq("action_type", "ai_analysis")
        .gte("created_at", windowStart);

      if (tier === "starter" && orgId) {
        query = query.eq("org_id", orgId);
      } else if (tier === "pro") {
        query = query.eq("user_id", userId);
      }

      const { count, error: countErr } = await query;
      usageCount = count ?? 0;

      if (countErr) {
        console.error("Usage count error:", countErr);
      }
    }

    // Credit limit enforcement
    const FREE_LIMIT = 6;
    const PRO_LIMIT = 50;
    const LIMITS = { starter: FREE_LIMIT, pro: PRO_LIMIT, unlimited: Infinity };
    const limit = LIMITS[tier];

    if (usageCount >= limit) {
      return new Response(
        JSON.stringify({
          error: "usage_limit_reached",
          creditsUsed: usageCount,
          creditsRemaining: 0,
          creditsResetAt: computeNextResetAt(orgResetDay),
          tier,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Successfully returning credit status
    const creditsRemaining = tier === "starter"
      ? Math.max(0, FREE_LIMIT - usageCount)
      : tier === "pro"
        ? Math.max(0, PRO_LIMIT - usageCount)
        : null;

    const responseData = {
      tier,
      creditsUsed: usageCount,
      creditsRemaining,
      creditsResetAt: tier === "starter" ? computeNextResetAt(orgResetDay) : null,
      ebayConnected: false, // Placeholder: check profiles.ebay_access_token in full impl
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-free-credits error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function computeNextResetAt(resetDay: number | null): string {
  const now = new Date();
  if (!resetDay) return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInThisMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(resetDay, daysInThisMonth);
  const thisMonthDate = new Date(year, month, clampedDay);

  if (thisMonthDate > now) return thisMonthDate.toISOString();

  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const nm = nextMonth % 12;
  const daysInNextMonth = new Date(nextYear, nm + 1, 0).getDate();
  return new Date(nextYear, nm, Math.min(resetDay, daysInNextMonth)).toISOString();
}
