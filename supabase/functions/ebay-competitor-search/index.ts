import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserOrServiceRole } from "../_helpers/authGuard.ts";
import { runCompetitorSearch } from "../_helpers/competitorSearch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

console.log("[ebay-competitor-search] Module loaded, serve() initializing...");

serve(async (req) => {
  console.log("[ebay-competitor-search] *** REQUEST RECEIVED ***", {
    method: req.method,
    url: req.url,
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUserOrServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (parseErr) {
    return new Response(
      JSON.stringify({
        error: "Invalid JSON in request body",
        detail: String(parseErr),
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { title, categoryId, yourPrice } = body;
  const listingId: string | undefined = body.listingId;
  let userId: string | undefined = body.userId;

  if (!auth.isServiceRole) {
    // Real end-user session — never trust a client-supplied userId; force it
    // to the verified identity so cache rows can't be written/read under an
    // arbitrary user's id.
    userId = auth.userId!;
    body.userId = auth.userId;
  }
  // Trusted internal caller (ebay-pricing / optimize-listing / competitor-prices-cron /
  // analyze-item) legitimately passes userId for whichever end-user's listing it's
  // refreshing on their behalf — leave body.userId as-is in that case.

  if (!title) {
    return new Response(JSON.stringify({ error: "title is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[ebay-competitor-search] Loading environment variables...");
  // Default to "production" — sandbox has its own separate (tiny) quota
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  console.log(
    "[ebay-competitor-search] ebayEnv:",
    ebayEnv,
    "geminiKey exists:",
    !!geminiKey,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { status, body: resultBody } = await runCompetitorSearch({
    supabase,
    userId,
    listingId,
    title,
    categoryId,
    yourPrice,
    ebayEnv,
    geminiKey,
  });

  return new Response(JSON.stringify(resultBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

console.log("[ebay-competitor-search] *** FUNCTION READY ***");
