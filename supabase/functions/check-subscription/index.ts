import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How long the DB cache is considered fresh before we re-verify with Stripe.
// The webhook keeps the DB current on every plan change, so this is a safety net
// for cases where a webhook is missed or delayed.
const CACHE_STALE_MINUTES = 60;

// Stripe statuses that mean the user still has access
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user?.email) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    // ── 1. Try the DB cache first ──────────────────────────────────────────
    const { data: cached } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .not("status", "eq", "canceled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime();
      const isFresh = ageMs < CACHE_STALE_MINUTES * 60 * 1000;

      if (isFresh) {
        logStep("Serving from DB cache", { status: cached.status, ageMs });
        const isActive = ACTIVE_STATUSES.has(cached.status);
        return new Response(
          JSON.stringify({
            subscribed: isActive && cached.status !== "past_due",
            product_id: isActive ? cached.product_id : null,
            subscription_end: cached.current_period_end,
            status: cached.status,
            cancel_at_period_end: cached.cancel_at_period_end,
            source: "cache",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      logStep("Cache is stale, falling back to Stripe", { ageMs });
    } else {
      logStep("No DB record found, falling back to Stripe");
    }

    // ── 2. Fall back to live Stripe call ────────────────────────────────────
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Prefer cached stripe_customer_id; fall back to email lookup
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId: string | null = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = customers.data[0]?.id ?? null;
      if (customerId) {
        // Cache it for next time
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }
    }

    if (!customerId) {
      logStep("No Stripe customer found — returning unsubscribed");
      return new Response(
        JSON.stringify({ subscribed: false, status: null, source: "stripe" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Live Stripe lookup", { customerId });
    const stripeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 5,
    });

    // Prefer active/trialing > past_due > canceled
    const priorityOrder = ["active", "trialing", "past_due", "canceled"];
    const sub = stripeSubscriptions.data.sort(
      (a, b) => priorityOrder.indexOf(a.status) - priorityOrder.indexOf(b.status)
    )[0] ?? null;

    // Write fresh data back to the DB so the next call can use the cache
    if (sub) {
      await supabase.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_sub_id: sub.id,
          stripe_cust_id: customerId,
          product_id: sub.items.data[0]?.price?.product as string ?? null,
          price_id: sub.items.data[0]?.price?.id ?? null,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_sub_id" }
      );
      logStep("DB cache refreshed from Stripe", { status: sub.status });
    }

    const activeSub = stripeSubscriptions.data.find((s) => ACTIVE_STATUSES.has(s.status));
    const hasActive = !!activeSub;
    const status = sub?.status ?? null;

    return new Response(
      JSON.stringify({
        subscribed: hasActive && status !== "past_due",
        product_id: hasActive ? activeSub!.items.data[0]?.price?.product : null,
        subscription_end: sub ? new Date(sub.current_period_end * 1000).toISOString() : null,
        status,
        cancel_at_period_end: sub?.cancel_at_period_end ?? false,
        source: "stripe",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    logStep("ERROR", { message: (error as Error).message });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

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
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");
    logStep("User authenticated", { email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      logStep("No Stripe customer found");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    const hasActiveSub = subscriptions.data.length > 0;
    let subscriptionEnd = null;
    let productId = null;

    if (hasActiveSub) {
      const sub = subscriptions.data[0];
      subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();
      productId = sub.items.data[0].price.product;
      logStep("Active subscription", { productId, subscriptionEnd });
    }

    return new Response(
      JSON.stringify({ subscribed: hasActiveSub, product_id: productId, subscription_end: subscriptionEnd }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    logStep("ERROR", { message: (error as Error).message });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
