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
 * Schedule: weekly (Sunday 03:00 UTC) via Supabase pg_cron.
 * Can also be triggered manually by POSTing to the function URL.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_TREE_ID = "0"; // EBAY_US
const BATCH_SIZE = 300;        // rows per upsert call

// ── eBay token ────────────────────────────────────────────────────────────────

async function getEbayAppToken(): Promise<
  { token: string; base: string } | null
> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  if (!clientId || !clientSecret) return null;

  const base = ebayEnv === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
  const tokenUrl = `${base}/identity/v1/oauth2/token`;

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
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

  const startMs = Date.now();
  console.log("[sync-ebay-taxonomy] ▶️ started");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey);

  // ── 1. Get eBay token ─────────────────────────────────────────────────────
  const ebay = await getEbayAppToken();
  if (!ebay) {
    return new Response(
      JSON.stringify({ error: "eBay credentials not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  console.log("[sync-ebay-taxonomy] ✅ eBay token acquired");

  // ── 2. Fetch full category tree ───────────────────────────────────────────
  const treeUrl =
    `${ebay.base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}`;
  console.log(`[sync-ebay-taxonomy] 📡 fetching ${treeUrl}`);

  const treeResp = await fetch(treeUrl, {
    headers: {
      "Authorization": `Bearer ${ebay.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!treeResp.ok) {
    const errText = await treeResp.text();
    console.error(`[sync-ebay-taxonomy] eBay tree fetch failed ${treeResp.status}:`, errText.slice(0, 300));
    return new Response(
      JSON.stringify({ error: `eBay API error ${treeResp.status}`, detail: errText.slice(0, 300) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log(`[sync-ebay-taxonomy] 📥 tree response received (${treeResp.headers.get("content-length") ?? "?"} bytes). Parsing...`);
  const treeJson = await treeResp.json();
  const fetchMs = Date.now() - startMs;
  console.log(`[sync-ebay-taxonomy] ✅ tree parsed in ${fetchMs}ms`);

  // eBay uses "rootCategoryNode" for the full tree; "categoryTreeNode" for subtrees
  const rootNode = treeJson.rootCategoryNode ?? treeJson.categoryTreeNode;
  if (!rootNode) {
    return new Response(
      JSON.stringify({ error: "eBay response missing rootCategoryNode", keys: Object.keys(treeJson) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Walk the tree collecting all leaf nodes ────────────────────────────
  const now = new Date().toISOString();
  const leaves: LeafRow[] = [];
  walkTree(rootNode, [], null, leaves, now);

  console.log(`[sync-ebay-taxonomy] 🌳 found ${leaves.length} leaf categories`);

  // ── 4. Batch-upsert into ebay_taxonomy_cache ──────────────────────────────
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < leaves.length; i += BATCH_SIZE) {
    const batch = leaves.slice(i, i + BATCH_SIZE);
    const { error } = await svc
      .from("ebay_taxonomy_cache")
      .upsert(batch, { onConflict: "category_id" });

    if (error) {
      console.error(`[sync-ebay-taxonomy] upsert error (batch ${i}):`, error.message);
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
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
      durationMs: totalMs,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
