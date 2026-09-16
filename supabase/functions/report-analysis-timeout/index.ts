// report-analysis-timeout
//
// Client-side half of the analysis_attempts diagnostic signal (see the
// 20260916000000_create_analysis_attempts.sql migration for the full
// rationale). analyze-item's own catch block can never see a platform-level
// gateway kill -- the function is terminated from outside, no exception is
// thrown, nothing reaches Sentry. The frontend is the only party that
// reliably observes "I called and never got an answer" (supabase-js throws
// FunctionsFetchError specifically for that case), so it reports it here.
//
// The frontend has no service-role key, so this endpoint authenticates the
// calling user's own JWT (requireUser) and then uses ITS OWN service-role
// client to write the row -- the same shape as every other frontend-facing
// function in this codebase that needs a service-role write.
//
// Deliberately narrow: this endpoint does exactly one thing (flag
// client_observed_timeout=true on a matching analysis_attempts row, or
// insert a new one if analyze-item's own 'started' row never made it out
// either). It is not a general-purpose logging endpoint.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireUser } from "../_helpers/authGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUser(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { invocationId } = await req.json();
    if (!invocationId || typeof invocationId !== "string") {
      return new Response(
        JSON.stringify({ error: "invocationId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Prefer flagging analyze-item's own 'started' row for this invocation
    // (the common case -- analyze-item got far enough to write one, then the
    // gateway killed it before the response). If no such row exists (the
    // frontend's own request timeout can in principle fire before
    // analyze-item even wrote the row, or the invocationId was never
    // received server-side at all), fall back to inserting a standalone
    // client-only record so the signal isn't lost.
    const { data: updated, error: updateErr } = await svc
      .from("analysis_attempts")
      .update({ client_observed_timeout: true })
      .eq("invocation_id", invocationId)
      .eq("user_id", auth.userId)
      .select("id");

    if (updateErr) {
      console.error(
        `report-analysis-timeout: update failed for invocation ${invocationId}:`,
        updateErr,
      );
    }

    if (!updateErr && (!updated || updated.length === 0)) {
      const { error: insertErr } = await svc.from("analysis_attempts").insert({
        invocation_id: invocationId,
        user_id: auth.userId,
        status: "failed",
        client_observed_timeout: true,
      });
      if (insertErr) {
        console.error(
          `report-analysis-timeout: fallback insert failed for invocation ${invocationId}:`,
          insertErr,
        );
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Best-effort diagnostics endpoint -- a failure here must never surface
    // as a user-facing error on top of the timeout the user already hit.
    console.error("report-analysis-timeout: unexpected error:", e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
