import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ================================================================
// Category Hygiene Cron (deficiency #9)
//
// Weekly maintenance job that:
//   1. Deduplicates category_mappings (normalised item_type)
//   2. Decays confidence on stale rows (no publish in 90 days)
//   3. Expires (soft-deletes) very low-confidence rows
//   4. Cleans up old audit entries (>180 days)
//   5. Removes expired aspect cache entries
// ================================================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    // 1. DEDUP: Find rows with same (ebay_category_id, item_type_normalized)
    //    Keep the row with the highest effective_score; reject the rest
    // ────────────────────────────────────────────────────────────
    const { data: dupes, error: dupErr } = await supabase.rpc(
      "find_duplicate_mappings"
    );
    if (dupErr) {
      console.warn("category-hygiene: dedup RPC failed:", dupErr.message);
      results.dedup_errors = 1;
    } else if (dupes && dupes.length > 0) {
      // dupes is an array of { id, category_id (ebay_category_id), item_type_normalized, effective_score }
      // grouped by (ebay_category_id, item_type_normalized) — the RPC returns losers only
      const dupeIds = dupes.map((d: { id: string }) => d.id);
      const { error: rejectErr } = await supabase
        .from("category_mappings")
        .update({ status: "rejected" })
        .in("id", dupeIds);
      if (rejectErr) {
        console.warn("category-hygiene: dedup reject failed:", rejectErr.message);
      }
      results.dedup_rejected = dupeIds.length;
      console.log(`category-hygiene: rejected ${dupeIds.length} duplicate mappings`);
    } else {
      results.dedup_rejected = 0;
    }

    // ────────────────────────────────────────────────────────────
    // 2. DECAY: Reduce effective_score by 5 for rows not published
    //    in the last 90 days (approved or quarantine only)
    // ────────────────────────────────────────────────────────────
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleRows, error: staleErr } = await supabase
      .from("category_mappings")
      .select("id, effective_score")
      .in("status", ["approved", "quarantine"])
      .or(`last_publish_success.is.null,last_publish_success.lt.${ninetyDaysAgo}`)
      .gt("effective_score", 0);

    if (staleErr) {
      console.warn("category-hygiene: stale query failed:", staleErr.message);
      results.decay_errors = 1;
    } else if (staleRows && staleRows.length > 0) {
      let decayed = 0;
      for (const row of staleRows) {
        const newScore = Math.max(0, (row.effective_score || 0) - 5);
        const { error: updateErr } = await supabase
          .from("category_mappings")
          .update({ effective_score: newScore })
          .eq("id", row.id);
        if (!updateErr) decayed++;
      }
      results.decay_applied = decayed;
      console.log(`category-hygiene: decayed ${decayed} stale mappings`);
    } else {
      results.decay_applied = 0;
    }

    // ────────────────────────────────────────────────────────────
    // 3. EXPIRE: Reject rows with effective_score <= 10
    //    These are too unreliable to keep active
    // ────────────────────────────────────────────────────────────
    const { data: expiredRows, error: expireErr } = await supabase
      .from("category_mappings")
      .update({ status: "rejected" })
      .in("status", ["approved", "quarantine"])
      .lte("effective_score", 10)
      .select("id");

    if (expireErr) {
      console.warn("category-hygiene: expire failed:", expireErr.message);
      results.expire_errors = 1;
    } else {
      results.expired = expiredRows?.length || 0;
      console.log(`category-hygiene: expired ${results.expired} low-score mappings`);
    }

    // ────────────────────────────────────────────────────────────
    // 4. AUDIT CLEANUP: Delete lookup_decisions older than 180 days
    // ────────────────────────────────────────────────────────────
    const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
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
      console.log(`category-hygiene: cleaned ${results.audit_cleaned} old audit entries`);
    }

    // ────────────────────────────────────────────────────────────
    // 5. CACHE CLEANUP: Delete expired aspect cache entries
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
      console.log(`category-hygiene: cleaned ${results.cache_cleaned} expired cache entries`);
    }

    // ────────────────────────────────────────────────────────────
    // Summary
    // ────────────────────────────────────────────────────────────
    console.log("category-hygiene: completed", JSON.stringify(results));

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("category-hygiene: fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});