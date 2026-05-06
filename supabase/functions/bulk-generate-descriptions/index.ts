import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

interface DescriptionRow {
  rowIndex: number;
  title: string;
  condition?: string;
  categoryId?: string;
  itemSpecifics?: Record<string, string>;
  imageUrl?: string;
}

interface DescriptionResult {
  rowIndex: number;
  description: string;
  error?: string;
}

// Row cap per tier
const ROW_CAPS: Record<string, number> = {
  starter: 5,
  pro: 25,
  unlimited: 1000,
  admin: 1000,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const { data: ud } = await svc.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const userId = ud?.user?.id;
    const userEmail = ud?.user?.email;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Determine tier
    const ADMIN_EMAILS = ["twinwicksllc@gmail.com"];
    const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;
    let tier: "starter" | "pro" | "unlimited" | "admin" = isAdmin ? "admin" : "starter";

    if (!isAdmin) {
      const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
      if (STRIPE_SECRET_KEY && userEmail) {
        try {
          const { default: Stripe } = await import(
            "https://esm.sh/stripe@18.5.0"
          );
          const stripe = new Stripe(STRIPE_SECRET_KEY, {
            apiVersion: "2025-08-27.basil",
          });
          const customers = await stripe.customers.list({
            email: userEmail,
            limit: 1,
          });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({
              customer: customers.data[0].id,
              status: "active",
              limit: 1,
            });
            if (subs.data.length > 0) {
              const productId = subs.data[0].items.data[0].price.product;
              if (productId === "prod_U70aT1KvuI2uDx") tier = "unlimited";
              else if (productId === "prod_U6zUiC1SYuPrGU") tier = "pro";
            }
          }
        } catch (e) {
          console.warn("Stripe check failed:", e);
        }
      }
    }

    const body = await req.json();
    const rows: DescriptionRow[] = body.rows ?? [];

    const cap = ROW_CAPS[tier] ?? 5;
    if (rows.length > cap) {
      return new Response(
        JSON.stringify({
          error: `Your plan allows AI descriptions for up to ${cap} rows at a time. You submitted ${rows.length}.`,
          cap,
          tier,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const configuredProxyUrl = Deno.env.get("OPENAI_PROXY_URL")?.trim();
    const openAiEndpoint = configuredProxyUrl ||
      "https://api.openai.com/v1/chat/completions";
    const usingProxy = Boolean(configuredProxyUrl);
    const openAiKey = Deno.env.get("NEW_OPENAI_API_KEY");
    if (!usingProxy && !openAiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const openAiProxyAuthToken = Deno.env.get("OPENAI_PROXY_AUTH_TOKEN")?.trim();

    const results: DescriptionResult[] = [];

    for (const row of rows) {
      try {
        // Build a concise prompt from the row data
        const specificsText = row.itemSpecifics && Object.keys(row.itemSpecifics).length > 0
          ? Object.entries(row.itemSpecifics)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
          : "N/A";

        const conditionLabel = (row.condition ?? "PRE_OWNED_GOOD")
          .replace(/_/g, " ")
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase());

        const prompt =
          `Write a compelling eBay listing description for this item. I want a HUMAN-sounding description that is professional but conversational. Imagine you are an enthusiastic eBay seller.

Title: ${row.title}
Condition: ${conditionLabel}
Item Specifics: ${specificsText}

Structure your description using these ## Markdown headers:

## Overview
1-3 sentences. Start with a direct hook like "Up for sale is...", "You're looking at...", or "If you're looking for...". Explain what the item is and what makes it a great pick.

## Quick Specs
Use a bulleted list (-) for:
- Weight/Metal (if applicable)
- Design/Feature highlights
- Condition details (be honest about wear/scuffs)
- What's included (capsule, case, etc.)

## The Details
2-4 sentences explaining WHY this item matters. Mention the design details on the obverse/reverse. If there's a historical or patriotic motif, mention why it’s a nice addition to a collection.

## Bottom Line
One closing sentence on value or who this is for. Start with "Bottom Line:".

TONE RULES:
- Use contractions ("It's", "You're") to sound natural.
- Be honest about condition.
- AVOID "AI slop" like: "Discover", "Elevate your collection", "Unveil", "Showcases", "Whether you're a seasoned...", "In the realm of", "Features exceptional".
- No HTML, use plain Markdown.
- Keep it under 300 words.`;

        const response = await fetch(
          openAiEndpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(usingProxy ? {} : { Authorization: `Bearer ${openAiKey}` }),
              ...(openAiProxyAuthToken
                ? { "X-Proxy-Auth": openAiProxyAuthToken }
                : {}),
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              // user field: correlates requests to a user in OpenAI usage dashboard
              ...(userId ? { user: `uid_${userId}` } : {}),
              messages: [
                {
                  role: "system",
                  content:
                    "You are an expert eBay seller who writes honest, human-sounding listing descriptions. Write like a knowledgeable dealer talking to a fellow enthusiast - conversational but professional. Use contractions naturally. Always end with a 'Bottom line:' closing sentence. Never use: 'comprises', 'showcases', 'elevate your collection', 'delve into', 'museum-quality', 'in the realm of', 'features exceptional'. Use phrases like 'Here's what you're getting:', 'Let's be honest...', 'You're looking at...', 'What makes this special is...';",
                },
                { role: "user", content: prompt },
              ],
              max_tokens: 600,
              temperature: 0.7,
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(
            `OpenAI error ${response.status}: ${errText.slice(0, 200)}`,
          );
        }

        let data: any;
        try {
          const respText = await response.text();
          data = JSON.parse(respText);
        } catch (e) {
          throw new Error(`Failed to parse OpenAI response: ${e}`);
        }
        const description = data.choices?.[0]?.message?.content?.trim() ?? "";

        // Log OpenAI usage for cost tracking (non-blocking fire-and-forget)
        const oaiUsage = data.usage;
        if (oaiUsage) {
          const promptTokens = oaiUsage.prompt_tokens ?? 0;
          const completionTokens = oaiUsage.completion_tokens ?? 0;
          const totalTokens = oaiUsage.total_tokens ?? 0;
          // gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
          const costUsd = (promptTokens * 0.00000015) + (completionTokens * 0.00000060);
          svc.from("gemini_usage").insert({
            user_id: userId,
            function_name: "bulk-generate-descriptions",
            model: "gpt-4o-mini",
            provider: "openai",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            cost_usd: costUsd,
          }).then(() => {}).catch((e: unknown) =>
            console.warn("Failed to log OpenAI bulk-descriptions usage:", String(e))
          );
        }

        results.push({ rowIndex: row.rowIndex, description });

        // Small delay between rows to stay within OpenAI rate limits
        if (rows.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err: any) {
        console.error(`Row ${row.rowIndex} description error:`, err.message);
        results.push({
          rowIndex: row.rowIndex,
          description: "",
          error: err.message || "Failed to generate description",
        });
      }
    }

    return new Response(JSON.stringify({ results, tier, cap }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("bulk-generate-descriptions error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
