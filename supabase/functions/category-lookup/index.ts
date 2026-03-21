import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// Note: Table initialization should be done via database migration, not in function code
// This function just queries the existing table
async function ensureTableExists() {
  // No-op - rely on migration to create table
  return;
}

// ── Helper: Get eBay app token (client credentials) ────────────────────
async function getEbayAppToken(): Promise<{ token: string; base: string } | null> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
  if (!clientId || !clientSecret) return null;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const tokenResp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    console.error("category-lookup: failed to get eBay app token", tokenResp.status, txt);
    return null;
  }

  const tokenJson = await tokenResp.json();
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  return { token: tokenJson.access_token, base };
}

// ── Helper: Build breadcrumb by walking up parent nodes ────────────────
// Uses getCategorySubtree for the initial node, then follows parentCategoryTreeNodeHref
// to collect ancestor names up to the root (max 8 levels to avoid runaway loops).
async function fetchBreadcrumb(
  categoryId: string,
  appToken: string,
  base: string,
): Promise<{ breadcrumb: string; categoryName: string; valid: boolean }> {
  const MAX_DEPTH = 8;
  const parts: string[] = [];
  let currentId = categoryId;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const url = `${base}/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${encodeURIComponent(currentId)}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${appToken}`, "Content-Type": "application/json" },
    });

    if (resp.status === 404) {
      if (depth === 0) return { breadcrumb: "", categoryName: "", valid: false };
      break; // root reached (shouldn't normally happen, but safe guard)
    }
    if (!resp.ok) {
      console.error(`category-lookup: taxonomy API error at depth ${depth}`, resp.status);
      break;
    }

    const json = await resp.json();
    const node = json.categorySubtreeNode || json.categoryNode;
    if (!node?.category) break;

    parts.unshift(node.category.categoryName);

    // Extract parent category ID from parentCategoryTreeNodeHref
    const parentHref = node.parentCategoryTreeNodeHref;
    if (!parentHref) break; // reached root

    const parentIdMatch = parentHref.match(/category_id=(\d+)/);
    if (!parentIdMatch) break;

    const parentId = parentIdMatch[1];
    // If parent ID equals current ID, we've hit the top-level self-reference
    if (parentId === currentId) break;
    currentId = parentId;
  }

  const categoryName = parts.length > 0 ? parts[parts.length - 1] : "";
  const breadcrumb = parts.join(" > ");
  return { breadcrumb, categoryName, valid: parts.length > 0 };
}

export async function handleRequest(req: Request): Promise<Response> {
  // IMPORTANT: Handle OPTIONS preflight first, before anything else
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Initialize table in background (non-blocking)
  ensureTableExists().catch((e) => console.warn("Table init error:", e));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    const { action, coinType, categoryId, categoryName, verificationSource } =
      payload;

    if (action === "lookup") {
      // Look up a coin type in the category mappings
      const normalizedType = (coinType || "").toLowerCase().trim();

      const { data, error } = await supabase
        .from("category_mappings")
        .select("ebay_category_id, category_name, confidence, verification_source")
        .eq("coin_type", normalizedType)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found (not an error)
        console.error("category-lookup: query error:", error);
      }

      if (data) {
        console.log(`category-lookup: found verified mapping for "${normalizedType}":`, {
          categoryId: data.ebay_category_id,
          confidence: data.confidence,
          source: data.verification_source,
        });
        return new Response(
          JSON.stringify({
            found: true,
            coinType: normalizedType,
            categoryId: data.ebay_category_id,
            categoryName: data.category_name,
            confidence: data.confidence,
            verificationSource: data.verification_source,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        console.log(
          `category-lookup: no verified mapping found for "${normalizedType}"`
        );
        return new Response(
          JSON.stringify({
            found: false,
            coinType: normalizedType,
            message: "Not in database — AI may need to verify via Google Search",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (action === "verify" || action === "breadcrumb") {
      // Verify whether a given eBay category ID is valid AND return full breadcrumb.
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for verify/breadcrumb action");

      // First check local mappings for a quick positive
      try {
        const { data: local } = await supabase
          .from("category_mappings")
          .select("ebay_category_id, category_name")
          .eq("ebay_category_id", cid)
          .single();
        if (local && local.ebay_category_id && local.category_name) {
          return new Response(
            JSON.stringify({
              valid: true,
              source: "db",
              categoryName: local.category_name,
              breadcrumb: local.category_name, // DB names are already breadcrumb-style
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        // ignore local lookup errors and continue to remote verification
        console.warn("category-lookup: local verify lookup failed", e);
      }

      // Remote verification via eBay Taxonomy API using app credentials
      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        // Cannot verify remotely without app credentials — report unknown
        return new Response(
          JSON.stringify({ valid: null, source: "none", message: "No eBay app credentials configured" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const result = await fetchBreadcrumb(cid, ebayAuth.token, ebayAuth.base);

        if (!result.valid) {
          return new Response(
            JSON.stringify({ valid: false, source: "remote", breadcrumb: null, categoryName: null }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            valid: true,
            source: "remote",
            categoryName: result.categoryName,
            breadcrumb: result.breadcrumb,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("category-lookup: remote verify exception", err);
        return new Response(
          JSON.stringify({ valid: null, source: "remote", error: String(err) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (action === "store") {
      // Store a new or updated category mapping
      // Require an Authorization header and admin privileges to upsert mappings
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization required for store action" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate user and admin flag
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user?.id) {
        console.error('category-lookup: auth.getUser failed', userErr);
        return new Response(
          JSON.stringify({ error: "Invalid authorization token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const userId = userData.user.id;
      const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", userId).single();
      const isAdmin = profile?.is_admin === true;
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Admin privileges required to store mappings" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const normalizedType = (coinType || "").toLowerCase().trim();

      if (!categoryId) {
        throw new Error("categoryId required for store action");
      }

      const { data, error } = await supabase
        .from("category_mappings")
        .upsert(
          {
            coin_type: normalizedType,
            ebay_category_id: categoryId,
            category_name: categoryName || null,
            verification_source: verificationSource || "ai_search",
            confidence: verificationSource === "user_verified" ? 100 : 80,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "coin_type" }
        )
        .select();

      if (error) {
        console.error("category-lookup: store error:", error);
        throw error;
      }

      console.log(`category-lookup: stored/updated mapping for "${normalizedType}":`, {
        categoryId,
        source: verificationSource,
      });

      return new Response(
        JSON.stringify({
          success: true,
          coinType: normalizedType,
          categoryId,
          stored: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("category-lookup error:", err);
    return new Response(
      JSON.stringify({
        error: err.message || "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

Deno.serve(handleRequest);