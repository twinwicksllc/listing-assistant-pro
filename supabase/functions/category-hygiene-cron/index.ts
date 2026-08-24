import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ================================================================
// Category Hygiene Cron
//
// Rewritten for the Category Resolver v2 filter-then-rank model
// (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md, plan section 3.2). The old version had
// four duties, two of which (decay effective_score by 5 after 90 days;
// expire rows at effective_score <= 10) no longer make sense -- the
// resolver rewrite (Phase 4) deleted effective_score from the live decision
// path entirely, so there is nothing left to decay or threshold against.
//
// Three duties remain, weekly:
//   1. DEDUP -- precedence-based, not score-based (find_duplicate_mappings
//      RPC, rewritten in 20260825000000_category_hygiene_precedence_rewrite.sql):
//      keep the user_verified row among duplicates; otherwise the most
//      recently successfully-published; otherwise the most recently updated.
//   2. ROT DETECTION (new) -- find approved category_mappings rows whose
//      ebay_category_id is no longer a live leaf in ebay_taxonomy_cache
//      (Finding B's bug class, applied to our own table instead of the AI
//      prompt). Flagged status = 'needs_review', never silently rejected,
//      since a human should confirm the replacement.
//   3. AUDIT CLEANUP -- lookup_decisions older than 180 days. Unchanged,
//      never was score-related.
// ================================================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[CATEGORY-HYGIENE-CRON] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const results: Record<string, number> = {};

    // ────────────────────────────────────────────────────────────
    // 1. DEDUP: precedence-based (user_verified > most-recently-published
    //    > most-recently-updated). See find_duplicate_mappings() in
    //    20260825000000_category_hygiene_precedence_rewrite.sql -- no
    //    arithmetic here, consistent with the resolver's own model.
    // ────────────────────────────────────────────────────────────
    const { data: dupes, error: dupErr } = await supabase.rpc(
      "find_duplicate_mappings",
    );
    if (dupErr) {
      console.warn("category-hygiene: dedup RPC failed:", dupErr.message);
      results.dedup_errors = 1;
    } else if (dupes && dupes.length > 0) {
      const dupeIds = dupes.map((d: { id: string }) => d.id);
      const { error: rejectErr } = await supabase
        .from("category_mappings")
        .update({ status: "rejected" })
        .in("id", dupeIds);
      if (rejectErr) {
        console.warn(
          "category-hygiene: dedup reject failed:",
          rejectErr.message,
        );
      }
      results.dedup_rejected = dupeIds.length;
      console.log(
        `category-hygiene: rejected ${dupeIds.length} duplicate mappings (precedence-based)`,
      );
    } else {
      results.dedup_rejected = 0;
    }

    // ────────────────────────────────────────────────────────────
    // 2. ROT DETECTION (new, replaces decay + expire): approved mappings
    //    whose ebay_category_id is no longer a confirmed live leaf in
    //    ebay_taxonomy_cache. Flagged needs_review, not rejected outright --
    //    a human should confirm the replacement before it's trusted again.
    // ────────────────────────────────────────────────────────────
    const { data: rotted, error: rotErr } = await supabase.rpc(
      "find_rotted_mappings",
    );
    if (rotErr) {
      console.warn("category-hygiene: rot-detection RPC failed:", rotErr.message);
      results.rot_errors = 1;
    } else if (rotted && rotted.length > 0) {
      const rottenIds = rotted.map((r: { id: string }) => r.id);
      const { error: flagErr } = await supabase
        .from("category_mappings")
        .update({ status: "needs_review" })
        .in("id", rottenIds);
      if (flagErr) {
        console.warn("category-hygiene: rot-detection flag failed:", flagErr.message);
      }
      results.rot_flagged = rottenIds.length;
      console.log(
        `category-hygiene: flagged ${rottenIds.length} mappings needs_review (ebay_category_id no longer a live leaf)`,
      );
    } else {
      results.rot_flagged = 0;
    }

    // ────────────────────────────────────────────────────────────
    // 3. AUDIT CLEANUP: Delete lookup_decisions older than 180 days
    // ────────────────────────────────────────────────────────────
    const oneEightyDaysAgo = new Date(
      Date.now() - 180 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: deletedAudit, error: auditErr } = await supabase
      .from("lookup_decisions")
      .delete()
      .lt("created_at", oneEightyDaysAgo)
      .select("id");

    if (auditErr) {
      console.warn("category-hygiene: audit cleanup failed:", auditErr.message);
      results.audit_errors = 1;
    } else {
      results.audit_cleaned = deletedAudit?.length || 0;
      console.log(
        `category-hygiene: cleaned ${results.audit_cleaned} old audit entries`,
      );
    }

    // ────────────────────────────────────────────────────────────
    // 4. CACHE CLEANUP: Delete expired aspect cache entries (unchanged,
    //    unrelated to scoring)
    // ────────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data: deletedCache, error: cacheErr } = await supabase
      .from("category_aspects_cache")
      .delete()
      .lt("expires_at", now)
      .select("category_id");

    if (cacheErr) {
      console.warn("category-hygiene: cache cleanup failed:", cacheErr.message);
      results.cache_errors = 1;
    } else {
      results.cache_cleaned = deletedCache?.length || 0;
      console.log(
        `category-hygiene: cleaned ${results.cache_cleaned} expired cache entries`,
      );
    }

    // ────────────────────────────────────────────────────────────
    // Summary - log to database for monitoring
    // ────────────────────────────────────────────────────────────
    console.log("category-hygiene: completed", JSON.stringify(results));

    try {
      await supabase.from("category_hygiene_log").insert({
        status: "success",
        results: results,
      });
    } catch (logErr) {
      console.warn("category-hygiene: failed to log run:", logErr);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("category-hygiene: fatal error:", message);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from("category_hygiene_log").insert({
          status: "error",
          error: message,
        });
      }
    } catch (logErr) {
      console.warn("category-hygiene: failed to log error:", logErr);
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
