import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { deleteEbayCacheForUser } from "../_helpers/ebayAccountDeletion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Extract auth user
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
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Server-side disconnect: clear all eBay connection metadata
    // Uses service role to bypass RLS and update user's own row
    // OQ-5 mitigation: After token-clear migration in Phase 6, users reconnect with new scope

    const { error: updateErr } = await svc
      .from("profiles")
      .update({
        ebay_access_token: null,
        ebay_refresh_token: null,
        ebay_token_expires_at: null,
        ebay_username: null,
        ebay_account_type: null,
      })
      .eq("id", userId);

    if (updateErr) {
      console.error("Disconnect eBay error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Failed to disconnect eBay account" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Tokens are already cleared, so syncs have stopped; now drop the eBay-derived
    // caches that nothing would prune anymore. A failure here returns 500 and the
    // user can simply press Disconnect again.
    try {
      await deleteEbayCacheForUser(svc, userId);
    } catch (cacheErr) {
      console.error("Disconnect eBay cache cleanup error:", cacheErr);
      return new Response(
        JSON.stringify({ error: "Disconnected, but failed to clear stored eBay data. Please try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "eBay account disconnected" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("disconnect-ebay error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
