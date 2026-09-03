import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { selectValidPrices } from "./prices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Use the service role client so we can read/write profiles and validate JWTs
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user?.email) throw new Error("User not authenticated");

    const body = await req.json().catch(() => ({}));
    const priceId = body.priceId;
    if (!priceId) {
      return new Response(JSON.stringify({ error: "priceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const validPrices = selectValidPrices({
      STRIPE_PRICE_IDS: Deno.env.get("STRIPE_PRICE_IDS") ?? undefined,
      STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY") ?? undefined,
    });
    if (!validPrices.includes(priceId)) {
      return new Response(JSON.stringify({ error: "Invalid price selected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // ── Resolve or create the Stripe customer ──────────────────────────────
    // Prefer the cached stripe_customer_id from their profile.
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId: string = profile?.stripe_customer_id;

    if (!customerId) {
      // Check Stripe by email in case they subscribed before we cached the ID
      const existing = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        // Create a new customer with metadata so the webhook can link them
        // even if client_reference_id is somehow missing
        const newCustomer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = newCustomer.id;
      }

      // Persist immediately so future calls skip the Stripe lookup
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Use a hardcoded app URL to prevent open-redirect via a crafted Origin header
    const appUrl = Deno.env.get("APP_URL") ?? "https://listing-assistant-pro.vercel.app";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      // client_reference_id lets the webhook reliably identify the user
      // without needing to search by email
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${appUrl}/billing?success=true`,
      cancel_url: `${appUrl}/billing?canceled=true`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
