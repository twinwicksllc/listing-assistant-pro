// v2: Fix eBay API status check - treat 4xx as reachable (API is responding)
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
    { auth: { persistSession: false } },
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
    const stripeStatus = { mode: "unknown", activeSubscriptions: 0, error: "" };
    try {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      stripeStatus.mode = stripeKey.startsWith("sk_live_")
        ? "live"
        : stripeKey.startsWith("sk_test_")
        ? "test"
        : "unknown";
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const subs = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
      });
      stripeStatus.activeSubscriptions = subs.data.length;
    } catch (e) {
      stripeStatus.error = e instanceof Error ? e.message : "Stripe error";
    }

    // --- eBay API Ping ---
    const ebayStatus = { ok: false, error: "" };
    try {
      const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
      const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
      const resp = await fetch(
        `${apiBase}/buy/browse/v1/item_summary/search?q=test&limit=1`,
        {
          headers: { "Content-Type": "application/json" },
        },
      );
      // Any 2xx, 3xx, 4xx status means the API is reachable (5xx are actual outages)
      // 400 is expected without auth - it means the endpoint exists and is responding
      ebayStatus.ok = resp.status >= 200 && resp.status < 500;
      if (!ebayStatus.ok) ebayStatus.error = `Status ${resp.status}`;
    } catch (e) {
      ebayStatus.error = e instanceof Error ? e.message : "eBay unreachable";
    }

    // --- Total Users ---
    let totalUsers = 0;
    try {
      const { count } = await supabaseClient.from("profiles").select("*", {
        count: "exact",
        head: true,
      });
      totalUsers = count || 0;
    } catch {
      // skip
    }

    // --- Gemini + OpenAI Usage ---
    const geminiUsage = {
      totalTokens: 0,
      totalCalls: 0,
      last30Days: [] as any[],
      estimatedCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      byFunction: {} as Record<
        string,
        {
          calls: number;
          cost: number;
          inputTokens: number;
          outputTokens: number;
        }
      >,
      last30DaysCost: [] as any[],
    };
    const openaiUsage = {
      totalCalls: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      byFunction: {} as Record<
        string,
        {
          calls: number;
          cost: number;
          inputTokens: number;
          outputTokens: number;
        }
      >,
      byUser: [] as { userId: string; calls: number; cost: number }[],
      last30Days: [] as any[],
      last30DaysCost: [] as any[],
    };
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: usageData } = await supabaseClient
        .from("gemini_usage")
        .select("*")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);

      // Helper: row cost — use stored cost_usd if available, else calculate
      const rowCost = (row: any): number => {
        if (row.cost_usd && row.cost_usd > 0) return Number(row.cost_usd);
        // Fallback: calculate from tokens using per-model pricing
        const model: string = row.model ?? "";
        if (model.startsWith("gpt-4o-mini")) {
          return (
            (row.prompt_tokens || 0) * 0.00000015 +
            (row.completion_tokens || 0) * 0.0000006
          );
        }
        if (model.startsWith("gpt-4o")) {
          return (
            (row.prompt_tokens || 0) * 0.0000025 +
            (row.completion_tokens || 0) * 0.00001
          );
        }
        // Default Gemini pricing
        return (
          (row.prompt_tokens || 0) * 0.00000125 +
          (row.completion_tokens || 0) * 0.000005
        );
      };

      if (usageData) {
        // Split into Gemini and OpenAI rows
        const geminiRows = usageData.filter(
          (r: any) => !r.provider || r.provider === "gemini",
        );
        const openaiRows = usageData.filter(
          (r: any) => r.provider === "openai",
        );

        // --- Gemini stats ---
        geminiUsage.totalCalls = geminiRows.length;
        const inputTokens = geminiRows.reduce(
          (sum: number, r: any) => sum + (r.prompt_tokens || 0),
          0,
        );
        const outputTokens = geminiRows.reduce(
          (sum: number, r: any) => sum + (r.completion_tokens || 0),
          0,
        );
        geminiUsage.inputTokens = inputTokens;
        geminiUsage.outputTokens = outputTokens;
        geminiUsage.totalTokens = inputTokens + outputTokens;
        geminiUsage.estimatedCost = geminiRows.reduce(
          (sum: number, r: any) => sum + rowCost(r),
          0,
        );

        // Gemini: Group by day
        const byDay: Record<
          string,
          {
            calls: number;
            tokens: number;
            cost: number;
            inputTokens: number;
            outputTokens: number;
          }
        > = {};
        for (const row of geminiRows) {
          const day = row.created_at.split("T")[0];
          const cost = rowCost(row);
          if (!byDay[day]) {
            byDay[day] = {
              calls: 0,
              tokens: 0,
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            };
          }
          byDay[day].calls++;
          byDay[day].tokens += row.total_tokens || 0;
          byDay[day].cost += cost;
          byDay[day].inputTokens += row.prompt_tokens || 0;
          byDay[day].outputTokens += row.completion_tokens || 0;
        }
        geminiUsage.last30Days = Object.entries(byDay)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date));
        geminiUsage.last30DaysCost = geminiUsage.last30Days;

        // Gemini: Group by function
        const byFunction: Record<
          string,
          {
            calls: number;
            cost: number;
            inputTokens: number;
            outputTokens: number;
          }
        > = {};
        for (const row of geminiRows) {
          const func = row.function_name || "unknown";
          if (!byFunction[func]) {
            byFunction[func] = {
              calls: 0,
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            };
          }
          byFunction[func].calls++;
          byFunction[func].cost += rowCost(row);
          byFunction[func].inputTokens += row.prompt_tokens || 0;
          byFunction[func].outputTokens += row.completion_tokens || 0;
        }
        geminiUsage.byFunction = byFunction;

        // --- OpenAI stats ---
        openaiUsage.totalCalls = openaiRows.length;
        openaiUsage.inputTokens = openaiRows.reduce(
          (sum: number, r: any) => sum + (r.prompt_tokens || 0),
          0,
        );
        openaiUsage.outputTokens = openaiRows.reduce(
          (sum: number, r: any) => sum + (r.completion_tokens || 0),
          0,
        );
        openaiUsage.totalTokens = openaiUsage.inputTokens + openaiUsage.outputTokens;
        openaiUsage.estimatedCost = openaiRows.reduce(
          (sum: number, r: any) => sum + rowCost(r),
          0,
        );

        // OpenAI: Group by day
        const oaiByDay: Record<
          string,
          {
            calls: number;
            tokens: number;
            cost: number;
            inputTokens: number;
            outputTokens: number;
          }
        > = {};
        for (const row of openaiRows) {
          const day = row.created_at.split("T")[0];
          const cost = rowCost(row);
          if (!oaiByDay[day]) {
            oaiByDay[day] = {
              calls: 0,
              tokens: 0,
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            };
          }
          oaiByDay[day].calls++;
          oaiByDay[day].tokens += row.total_tokens || 0;
          oaiByDay[day].cost += cost;
          oaiByDay[day].inputTokens += row.prompt_tokens || 0;
          oaiByDay[day].outputTokens += row.completion_tokens || 0;
        }
        openaiUsage.last30Days = Object.entries(oaiByDay)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date));
        openaiUsage.last30DaysCost = openaiUsage.last30Days;

        // OpenAI: Group by function
        const oaiByFunction: Record<
          string,
          {
            calls: number;
            cost: number;
            inputTokens: number;
            outputTokens: number;
          }
        > = {};
        for (const row of openaiRows) {
          const func = row.function_name || "unknown";
          if (!oaiByFunction[func]) {
            oaiByFunction[func] = {
              calls: 0,
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            };
          }
          oaiByFunction[func].calls++;
          oaiByFunction[func].cost += rowCost(row);
          oaiByFunction[func].inputTokens += row.prompt_tokens || 0;
          oaiByFunction[func].outputTokens += row.completion_tokens || 0;
        }
        openaiUsage.byFunction = oaiByFunction;

        // OpenAI: top users by spend
        const oaiByUser: Record<string, { calls: number; cost: number }> = {};
        for (const row of openaiRows) {
          const uid = row.user_id || "unknown";
          if (!oaiByUser[uid]) oaiByUser[uid] = { calls: 0, cost: 0 };
          oaiByUser[uid].calls++;
          oaiByUser[uid].cost += rowCost(row);
        }
        openaiUsage.byUser = Object.entries(oaiByUser)
          .map(([userId, v]) => ({ userId, ...v }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 10);
      }
    } catch {
      // skip
    }

    // --- Feature Usage Analytics ---
    const featureUsage = {
      ai_analysis: 0,
      ebay_publish: 0,
      optimize: 0,
      export: 0,
    };
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
    let lastCostAlert: {
      sent_at: string;
      total_cost: number;
      total_requests: number;
    } | null = null;
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
        openai: openaiUsage,
        featureUsage,
        lastCostAlert,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
