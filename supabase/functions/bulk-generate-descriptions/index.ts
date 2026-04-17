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

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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

        const prompt = `Write a compelling eBay listing description for this item.

Title: ${row.title}
Condition: ${conditionLabel}
Item Specifics: ${specificsText}

Structure your description using these FOUR sections:

1. OPENING (1-2 sentences): Direct, conversational hook. Lead with the best feature or an honest note about condition. Use "You're looking at...", "Here's a great...", or "Let's be honest..." as openers. Do NOT start with the item title.

2. WHAT YOU'RE GETTING (bullet list using - ):
   - List the key facts: year/model, condition, specs, what's included
   - Be specific to what's provided above - do not invent details

3. WHY IT WORKS (2-3 sentences): Honest appeal - who is this for and why does it stand out? Historical note, rarity, or practical value. Be SPECIFIC to this item.

4. Bottom line: (always labeled exactly "Bottom line:") One closing sentence with your honest take on value and who should buy this.

TONE RULES:
- Write like a knowledgeable seller talking to a fellow enthusiast, not a corporate email
- Use contractions naturally ("it's", "you're", "here's")
- Be honest about condition - builds trust and reduces returns
- Max 400 words total
- Plain text only, no HTML
- AVOID these phrases: "comprises", "showcases", "features exceptional", "museum-quality", "elevate your collection", "delve into", "in the realm of"
- Do NOT include the title as a heading`;

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openAiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
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
