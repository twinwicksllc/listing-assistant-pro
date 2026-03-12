import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "twinwicksllc@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Verify admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");
    if (userData.user.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Stripe Status ---
    let stripeStatus = { mode: "unknown", activeSubscriptions: 0, error: "" };
    try {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      stripeStatus.mode = stripeKey.startsWith("sk_live_") ? "live" : stripeKey.startsWith("sk_test_") ? "test" : "unknown";
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const subs = await stripe.subscriptions.list({ status: "active", limit: 100 });
      stripeStatus.activeSubscriptions = subs.data.length;
    } catch (e) {
      stripeStatus.error = e instanceof Error ? e.message : "Stripe error";
    }

    // --- eBay API Ping ---
    let ebayStatus = { ok: false, error: "" };
    try {
      const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
      const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
      const resp = await fetch(`${apiBase}/buy/browse/v1/item_summary/search?q=test&limit=1`, {
        headers: { "Content-Type": "application/json" },
      });
      // 200 or 401 both mean the API is reachable
      ebayStatus.ok = resp.status === 200 || resp.status === 401 || resp.status === 403;
      if (!ebayStatus.ok) ebayStatus.error = `Status ${resp.status}`;
    } catch (e) {
      ebayStatus.error = e instanceof Error ? e.message : "eBay unreachable";
    }

    // --- Total Users ---
    let totalUsers = 0;
    try {
      const { count } = await supabaseClient.from("profiles").select("*", { count: "exact", head: true });
      totalUsers = count || 0;
    } catch {
      // skip
    }

    // --- Gemini Usage ---
    let geminiUsage = { 
      totalTokens: 0, 
      totalCalls: 0, 
      last30Days: [] as any[], 
      estimatedCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      byFunction: {} as Record<string, { calls: number; cost: number; inputTokens: number; outputTokens: number }>,
      last30DaysCost: [] as any[]
    };
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: usageData, count } = await supabaseClient
        .from("gemini_usage")
        .select("*", { count: "exact" })
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);

      geminiUsage.totalCalls = count || 0;
      if (usageData) {
        const inputTokens = usageData.reduce((sum: number, r: any) => sum + (r.prompt_tokens || 0), 0);
        const outputTokens = usageData.reduce((sum: number, r: any) => sum + (r.completion_tokens || 0), 0);
        const inputCost = inputTokens * 0.00000125;
        const outputCost = outputTokens * 0.000005;
        
        geminiUsage.inputTokens = inputTokens;
        geminiUsage.outputTokens = outputTokens;
        geminiUsage.totalTokens = inputTokens + outputTokens;
        geminiUsage.estimatedCost = inputCost + outputCost;

        // Group by day for chart (with daily cost)
        const byDay: Record<string, { calls: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }> = {};
        for (const row of usageData) {
          const day = row.created_at.split("T")[0];
          const dailyInputCost = (row.prompt_tokens || 0) * 0.00000125;
          const dailyOutputCost = (row.completion_tokens || 0) * 0.000005;
          if (!byDay[day]) byDay[day] = { calls: 0, tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
          byDay[day].calls++;
          byDay[day].tokens += row.total_tokens || 0;
          byDay[day].cost += dailyInputCost + dailyOutputCost;
          byDay[day].inputTokens += row.prompt_tokens || 0;
          byDay[day].outputTokens += row.completion_tokens || 0;
        }
        geminiUsage.last30Days = Object.entries(byDay).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
        geminiUsage.last30DaysCost = geminiUsage.last30Days;

        // Group by function for breakdown
        const byFunction: Record<string, { calls: number; cost: number; inputTokens: number; outputTokens: number }> = {};
        for (const row of usageData) {
          const func = row.function_name || "unknown";
          const inputCost = (row.prompt_tokens || 0) * 0.00000125;
          const outputCost = (row.completion_tokens || 0) * 0.000005;
          if (!byFunction[func]) byFunction[func] = { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
          byFunction[func].calls++;
          byFunction[func].cost += inputCost + outputCost;
          byFunction[func].inputTokens += row.prompt_tokens || 0;
          byFunction[func].outputTokens += row.completion_tokens || 0;
        }
        geminiUsage.byFunction = byFunction;
      }
    } catch {
      // skip
    }

    // --- Feature Usage Analytics ---
    let featureUsage = { ai_analysis: 0, ebay_publish: 0, optimize: 0, export: 0 };
    try {
      const thirtyDaysAgo2 = new Date();
      thirtyDaysAgo2.setDate(thirtyDaysAgo2.getDate() - 30);
      const { data: usageRows } = await supabaseClient
        .from("usage_tracking")
        .select("action_type")
        .gte("created_at", thirtyDaysAgo2.toISOString());
      if (usageRows) {
        for (const row of usageRows) {
          const key = row.action_type as keyof typeof featureUsage;
          if (key in featureUsage) featureUsage[key]++;
        }
      }
    } catch {
      // skip
    }

    // --- Last Cost Alert ---
    let lastCostAlert: { sent_at: string; total_cost: number; total_requests: number } | null = null;
    try {
      const { data: alertData } = await supabaseClient
        .from("cost_alerts")
        .select("sent_at, total_cost, total_requests")
        .order("sent_at", { ascending: false })
        .limit(1)
        .single();
      if (alertData) lastCostAlert = alertData;
    } catch {
      // skip
    }

    return new Response(
      JSON.stringify({
        stripe: stripeStatus,
        ebay: ebayStatus,
        totalUsers,
        gemini: geminiUsage,
        featureUsage,
        lastCostAlert,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
