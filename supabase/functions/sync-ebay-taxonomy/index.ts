/**
 * sync-ebay-taxonomy — Weekly cron job
 *
 * Fetches the ENTIRE eBay US category tree in a single API call:
 *   GET /commerce/taxonomy/v1/category_tree/0
 *
 * Walks all leaf nodes recursively (building breadcrumbs as it descends),
 * then bulk-upserts into ebay_taxonomy_cache.
 *
 * Result: every eBay leaf category is always in the DB with a fresh breadcrumb.
 * No more hardcoded maps anywhere in the codebase.
 *
 * Schedule: weekly (Sunday 03:11 UTC) via Supabase pg_cron, job
 * 'sync-ebay-taxonomy-weekly' -- confirmed present in production cron.job.
 * pg_cron is the single scheduler for this function;
 * .github/workflows/category-taxonomy-sync.yml can invoke it on demand but no
 * longer schedules it (it used to, double-invoking this 11 minutes apart).
 * Can also be triggered manually by POSTing to the function URL.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_TREE_ID = "0"; // EBAY_US
const BATCH_SIZE = 300; // rows per upsert call

// ── eBay token ────────────────────────────────────────────────────────────────

async function getEbayAppToken(): Promise<
  {
    token: string;
    base: string;
  } | null
> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  if (!clientId || !clientSecret) return null;

  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const tokenUrl = `${base}/identity/v1/oauth2/token`;

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  if (!resp.ok) return null;

  const json = await resp.json();
  return json.access_token ? { token: json.access_token, base } : null;
}

// ── Tree walking ──────────────────────────────────────────────────────────────

interface LeafRow {
  category_id: string;
  category_name: string;
  breadcrumb: string;
  parent_category_id: string | null;
  is_leaf: boolean;
  synced_at: string;
}

/**
 * Recursive DFS tree walk. Accumulates leaf nodes in `leaves`.
 * @param node      eBay categoryTreeNode object
 * @param ancestors Breadcrumb segments built so far (we push catName then recurse)
 * @param parentId  The parent category's ID (null at root)
 * @param leaves    Output array — mutated in place for memory efficiency
 */
function walkTree(
  node: any,
  ancestors: string[],
  parentId: string | null,
  leaves: LeafRow[],
  now: string,
): void {
  const catId: string | undefined = node?.category?.categoryId;
  const catName: string | undefined = node?.category?.categoryName;
  if (!catId || !catName) return;

  const path = [...ancestors, catName];
  const children: any[] | undefined = node.childCategoryTreeNodes;

  if (!children || children.length === 0) {
    // This is a leaf — store it
    leaves.push({
      category_id: catId,
      category_name: catName,
      breadcrumb: path.join(" > "),
      parent_category_id: parentId,
      is_leaf: true,
      synced_at: now,
    });
  } else {
    // Non-leaf — recurse into children, skipping "All Categories" root label
    for (const child of children) {
      // Pass the current node's name as part of ancestors only if it's not the
      // invisible root ("All Categories" / category_id "0" or similar stub).
      const nextAncestors = catId === "0" ? [] : path;
      walkTree(child, nextAncestors, catId === "0" ? null : catId, leaves, now);
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    // Redacted diagnostic to the function log only -- lengths and booleans, no
    // secret material, and nothing added to the response body. See RBR-0025.
    console.warn(
      "[SYNC-EBAY-TAXONOMY] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startMs = Date.now();
  console.log("[sync-ebay-taxonomy] ▶️ started");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey);

  // ── 1. Get eBay token ─────────────────────────────────────────────────────
  const ebay = await getEbayAppToken();
  if (!ebay) {
    return new Response(
      JSON.stringify({
        error: "eBay credentials not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  console.log("[sync-ebay-taxonomy] ✅ eBay token acquired");

  // ── 2. Fetch full category tree ───────────────────────────────────────────
  const treeUrl = `${ebay.base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}`;
  console.log(`[sync-ebay-taxonomy] 📡 fetching ${treeUrl}`);

  const treeResp = await fetch(treeUrl, {
    headers: {
      Authorization: `Bearer ${ebay.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!treeResp.ok) {
    const errText = await treeResp.text();
    console.error(
      `[sync-ebay-taxonomy] eBay tree fetch failed ${treeResp.status}:`,
      errText.slice(0, 300),
    );
    return new Response(
      JSON.stringify({
        error: `eBay API error ${treeResp.status}`,
        detail: errText.slice(0, 300),
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  console.log(
    `[sync-ebay-taxonomy] 📥 tree response received (${
      treeResp.headers.get("content-length") ?? "?"
    } bytes). Parsing...`,
  );
  const treeJson = await treeResp.json();
  const fetchMs = Date.now() - startMs;
  console.log(`[sync-ebay-taxonomy] ✅ tree parsed in ${fetchMs}ms`);

  // ── Category tree version / drift detection ──────────────────────────────
  // eBay returns `categoryTreeVersion` on taxonomy responses and their docs
  // recommend tracking it: when the version changes, eBay has restructured the
  // tree, which can silently invalidate cached breadcrumbs, stored
  // category_mappings, and any hardcoded leaf ID we rely on.
  //
  // We record it and log loudly on change so a restructure is visible in logs
  // rather than surfacing later as mysterious "wrong category" reports.
  const categoryTreeVersion = typeof treeJson.categoryTreeVersion === "string" ? treeJson.categoryTreeVersion : null;

  let previousTreeVersion: string | null = null;
  if (categoryTreeVersion) {
    const { data: versionRow } = await svc
      .from("ebay_taxonomy_meta")
      .select("category_tree_version")
      .eq("category_tree_id", CATEGORY_TREE_ID)
      .maybeSingle();

    previousTreeVersion = versionRow?.category_tree_version ?? null;

    if (previousTreeVersion && previousTreeVersion !== categoryTreeVersion) {
      console.warn(
        `[sync-ebay-taxonomy] ⚠️  CATEGORY TREE VERSION CHANGED: ${previousTreeVersion} → ${categoryTreeVersion}. ` +
          `eBay has restructured the taxonomy. Cached breadcrumbs are being refreshed by this run, but ` +
          `stored category_mappings and any hardcoded leaf IDs should be re-verified.`,
      );
    } else if (!previousTreeVersion) {
      console.log(
        `[sync-ebay-taxonomy] recording category tree version ${categoryTreeVersion} (first observation)`,
      );
    } else {
      console.log(
        `[sync-ebay-taxonomy] category tree version unchanged (${categoryTreeVersion})`,
      );
    }
  } else {
    console.warn(
      "[sync-ebay-taxonomy] eBay response did not include categoryTreeVersion — skipping drift detection",
    );
  }

  // eBay uses "rootCategoryNode" for the full tree; "categoryTreeNode" for subtrees
  const rootNode = treeJson.rootCategoryNode ?? treeJson.categoryTreeNode;
  if (!rootNode) {
    return new Response(
      JSON.stringify({
        error: "eBay response missing rootCategoryNode",
        keys: Object.keys(treeJson),
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── 3. Walk the tree collecting all leaf nodes ────────────────────────────
  const now = new Date().toISOString();
  const leaves: LeafRow[] = [];
  walkTree(rootNode, [], null, leaves, now);

  console.log(`[sync-ebay-taxonomy] 🌳 found ${leaves.length} leaf categories`);

  // ── Drift-diff logging (plan §3.1): which leaf IDs disappeared this sync ─────
  // Finding B showed hardcoded leaf IDs can silently go dead between syncs.
  // The full new tree is already in memory here, so diffing against the
  // previous snapshot is cheap — this turns "found by hand, weeks later"
  // into "logged automatically the week it happened."
  let disappearedCount = 0;
  let disappearedSample: { category_id: string; category_name: string }[] = [];
  try {
    const { data: previousLeaves, error: prevErr } = await svc
      .from("ebay_taxonomy_cache")
      .select("category_id, category_name")
      .eq("is_leaf", true);

    if (prevErr) {
      console.warn("[sync-ebay-taxonomy] drift-diff: failed to load previous leaf set:", prevErr.message);
    } else if (previousLeaves && previousLeaves.length > 0) {
      const newIds = new Set(leaves.map((l) => l.category_id));
      const disappeared = previousLeaves.filter((p) => !newIds.has(p.category_id));
      disappearedCount = disappeared.length;
      disappearedSample = disappeared.slice(0, 25);
      if (disappearedCount > 0) {
        console.warn(
          `[sync-ebay-taxonomy] ⚠️  DRIFT: ${disappearedCount} previously-leaf category ID(s) are no longer in the tree ` +
            `(no longer a leaf, or removed entirely): ${
              disappearedSample.map((d) => `${d.category_id} (${d.category_name})`).join(", ")
            }${disappearedCount > disappearedSample.length ? ", ..." : ""}`,
        );
      } else {
        console.log("[sync-ebay-taxonomy] drift-diff: no previously-leaf categories disappeared");
      }
    }
  } catch (err) {
    console.warn("[sync-ebay-taxonomy] drift-diff: exception during diff:", err);
  }

  // ── 4. Batch-upsert into ebay_taxonomy_cache ──────────────────────────────
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < leaves.length; i += BATCH_SIZE) {
    const batch = leaves.slice(i, i + BATCH_SIZE);
    const { error } = await svc
      .from("ebay_taxonomy_cache")
      .upsert(batch, { onConflict: "category_id" });

    if (error) {
      console.error(
        `[sync-ebay-taxonomy] upsert error (batch ${i}):`,
        error.message,
      );
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }

  // Persist the tree version only after a materially successful sync, so a
  // failed/partial run does not mask a genuine restructure on the next pass.
  const treeVersionChanged = !!categoryTreeVersion &&
    !!previousTreeVersion &&
    previousTreeVersion !== categoryTreeVersion;

  if (categoryTreeVersion && upserted > 0) {
    const { error: versionError } = await svc
      .from("ebay_taxonomy_meta")
      .upsert(
        {
          category_tree_id: CATEGORY_TREE_ID,
          category_tree_version: categoryTreeVersion,
          leaf_count: leaves.length,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "category_tree_id" },
      );

    if (versionError) {
      console.error(
        "[sync-ebay-taxonomy] failed to record category tree version:",
        versionError.message,
      );
    }
  }

  // ── Staleness health check (plan §3.1) ──────────────────────────────────────────
  // Under the resolver rewrite ebay_taxonomy_cache is load-bearing (gate 1),
  // so staleness should be visible without a manual query. This counts rows
  // this run just refreshed too, so a healthy sync should always report 0
  // right after it runs — a nonzero count on a later manual check means the
  // NEXT scheduled sync hasn't happened yet (missed cron, revoked eBay
  // creds, etc.).
  let staleRowCount: number | null = null;
  try {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error: staleErr } = await svc
      .from("ebay_taxonomy_cache")
      .select("category_id", { count: "exact", head: true })
      .lt("synced_at", eightDaysAgo);
    if (staleErr) {
      console.warn("[sync-ebay-taxonomy] staleness check failed:", staleErr.message);
    } else {
      staleRowCount = count ?? 0;
      if (staleRowCount > 0) {
        console.warn(
          `[sync-ebay-taxonomy] ⚠️  ${staleRowCount} ebay_taxonomy_cache row(s) have not been synced in over 8 days`,
        );
      }
    }
  } catch (err) {
    console.warn("[sync-ebay-taxonomy] staleness check exception:", err);
  }

  const totalMs = Date.now() - startMs;
  console.log(
    `[sync-ebay-taxonomy] ✅ done — ${upserted} upserted, ${errors} errors, ${totalMs}ms total`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      leafCount: leaves.length,
      upserted,
      errors,
      categoryTreeVersion,
      previousTreeVersion,
      treeVersionChanged,
      disappearedLeafCount: disappearedCount,
      disappearedLeafSample: disappearedSample,
      staleRowCount,
      durationMs: totalMs,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
