import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Stripe sends POST — no CORS preflight needed
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    logStep("Missing secrets");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  // Must read raw body BEFORE any other body parsing for signature verification
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    logStep("Missing Stripe-Signature header");
    return new Response("Missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err: any) {
    logStep("Signature verification failed", { error: err.message });
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  logStep("Event received", { type: event.type, id: event.id });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        // client_reference_id is set in create-checkout to the Supabase user ID
        const userId = session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        logStep("checkout.session.completed", { userId, customerId, subscriptionId });

        if (!userId) {
          logStep("No client_reference_id — cannot link user, skipping");
          break;
        }

        // Persist stripe_customer_id to their profile for all future lookups
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", userId);

        // Fetch full subscription details and write to subscriptions table
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscription(supabase, sub, userId, customerId);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Resolve user via profiles.stripe_customer_id (set during checkout)
        const userId = await resolveUserId(supabase, customerId);
        if (!userId) {
          logStep("Could not resolve user for customer", { customerId });
          break;
        }

        await upsertSubscription(supabase, sub, userId, customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        logStep("Subscription deleted", { subId: sub.id });
        const { error } = await supabase
          .from("subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("stripe_sub_id", sub.id);
        if (error) logStep("Error marking canceled", { error: error.message });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        // invoice.subscription can be a string ID or an expanded object
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : (invoice.subscription as any)?.id;
        if (subId) {
          logStep("Payment failed, marking past_due", { subId });
          const { error } = await supabase
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_sub_id", subId);
          if (error) logStep("Error marking past_due", { error: error.message });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        // Payment recovered after past_due — restore active status
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : (invoice.subscription as any)?.id;
        if (subId) {
          logStep("Payment recovered, marking active", { subId });
          await supabase
            .from("subscriptions")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("stripe_sub_id", subId);
        }
        break;
      }

      default:
        logStep("Unhandled event type (ignored)", { type: event.type });
    }
  } catch (err: any) {
    logStep("Handler error", { message: err.message });
    // Return 200 so Stripe doesn't retry on logic errors — error is logged above
    return new Response(JSON.stringify({ received: true, error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Look up a Supabase user ID from the stripe_customer_id stored on their profile. */
async function resolveUserId(supabase: any, customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

/** Upsert a Stripe subscription row into the subscriptions table. */
async function upsertSubscription(
  supabase: any,
  sub: Stripe.Subscription,
  userId: string,
  customerId: string,
) {
  const productId = sub.items.data[0]?.price?.product as string | undefined;
  const priceId = sub.items.data[0]?.price?.id;
  const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

  logStep("upsertSubscription", {
    userId,
    subId: sub.id,
    status: sub.status,
    productId,
  });

  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_sub_id: sub.id,
      stripe_cust_id: customerId,
      product_id: productId ?? null,
      price_id: priceId ?? null,
      status: sub.status,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_sub_id" },
  );

  if (error) {
    logStep("Error upserting subscription", { error: error.message });
  } else {
    logStep("Subscription upserted", { userId, status: sub.status });
  }
}
