import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Helper: Get eBay app token (client credentials) ────────────────────────
async function getEbayAppToken(): Promise<{ token: string; base: string } | null> {
  const clientId     = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv      = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
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
    console.error("category-lookup: failed to get eBay app token", tokenResp.status);
    return null;
  }

  const tokenJson = await tokenResp.json();
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  return { token: tokenJson.access_token, base };
}

// ── Helper: Build breadcrumb by walking up parent nodes ───────────────────
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
      break;
    }
    if (!resp.ok) {
      console.error(`category-lookup: taxonomy API error at depth ${depth}`, resp.status);
      break;
    }

    const json = await resp.json();
    const node = json.categorySubtreeNode || json.categoryNode;
    if (!node?.category) break;

    parts.unshift(node.category.categoryName);

    const parentHref     = node.parentCategoryTreeNodeHref;
    if (!parentHref) break;

    const parentIdMatch = parentHref.match(/category_id=(\d+)/);
    if (!parentIdMatch) break;

    const parentId = parentIdMatch[1];
    if (parentId === currentId) break;
    currentId = parentId;
  }

  const categoryName = parts.length > 0 ? parts[parts.length - 1] : "";
  const breadcrumb   = parts.join(" > ");
  return { breadcrumb, categoryName, valid: parts.length > 0 };
}

// ── Helper: Ask Gemini for the correct eBay category ID ───────────────────
async function askGeminiForCategory(itemDescription: string): Promise<{ categoryId: string; categoryName: string; confidence: number } | null> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    console.warn("category-lookup: GEMINI_API_KEY not set, cannot ask Gemini");
    return null;
  }

  const prompt = `You are an eBay category expert. Given the following item description, return the single most accurate eBay leaf category ID.

Item: "${itemDescription}"

Rules:
- Return ONLY a JSON object with fields: categoryId (string), categoryName (string), confidence (number 0-100)
- categoryId must be a valid eBay US leaf category ID (a number as a string)
- confidence: how confident you are this is the right leaf category (0-100)
- Do not include any explanation or extra text — only the JSON object

Example response:
{"categoryId": "19203", "categoryName": "Beanie Babies", "confidence": 97}`;

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        }),
      }
    );

    if (!resp.ok) {
      console.error("category-lookup: Gemini API error", resp.status);
      return null;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      console.warn("category-lookup: Gemini returned no JSON", text);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.categoryId || !parsed.categoryName) return null;

    console.log(`category-lookup: Gemini suggested category for "${itemDescription}":`, parsed);
    return {
      categoryId:   String(parsed.categoryId).trim(),
      categoryName: String(parsed.categoryName).trim(),
      confidence:   Number(parsed.confidence ?? 80),
    };
  } catch (err) {
    console.error("category-lookup: Gemini exception", err);
    return null;
  }
}

// ── Normalize item description for consistent key matching ────────────────
function normalizeItemType(input: string): string {
  return (input || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s\-]/g, "")   // strip special chars
    .replace(/\s+/g, " ");             // collapse whitespace
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl        = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload  = await req.json();
    const { action, itemType, coinType, categoryId, categoryName, verificationSource } = payload;

    // Support both old coinType and new itemType fields
    const rawItemType   = itemType || coinType || "";
    const normalizedKey = normalizeItemType(rawItemType);

    // ── ACTION: lookup ─────────────────────────────────────────────────────
    if (action === "lookup") {
      if (!normalizedKey) {
        return new Response(
          JSON.stringify({ found: false, message: "itemType is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Try exact match in DB (both item_type and coin_type columns)
      const { data: exact } = await supabase
        .from("category_mappings")
        .select("ebay_category_id, category_name, confidence, verification_source, item_type, coin_type")
        .or(`item_type.eq.${normalizedKey},coin_type.eq.${normalizedKey}`)
        .order("confidence", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (exact) {
        console.log(`category-lookup: DB hit for "${normalizedKey}":`, exact.ebay_category_id);
        return new Response(
          JSON.stringify({
            found:              true,
            itemType:           normalizedKey,
            categoryId:         exact.ebay_category_id,
            categoryName:       exact.category_name,
            confidence:         exact.confidence,
            verificationSource: exact.verification_source,
            source:             "db",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. Try fuzzy / partial match — find any row where item_type LIKE '%keyword%'
      //    Split the normalized key into words and try each
      const keywords = normalizedKey.split(" ").filter((w) => w.length > 3);
      let fuzzyMatch: any = null;

      for (const kw of keywords) {
        const { data: fuzzy } = await supabase
          .from("category_mappings")
          .select("ebay_category_id, category_name, confidence, verification_source, item_type, coin_type")
          .or(`item_type.ilike.%${kw}%,coin_type.ilike.%${kw}%`)
          .order("confidence", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fuzzy) {
          fuzzyMatch = fuzzy;
          break;
        }
      }

      if (fuzzyMatch) {
        console.log(`category-lookup: fuzzy DB hit for "${normalizedKey}" via keyword:`, fuzzyMatch.ebay_category_id);
        return new Response(
          JSON.stringify({
            found:              true,
            itemType:           normalizedKey,
            categoryId:         fuzzyMatch.ebay_category_id,
            categoryName:       fuzzyMatch.category_name,
            confidence:         Math.max(60, (fuzzyMatch.confidence ?? 80) - 15), // slight confidence penalty for fuzzy
            verificationSource: fuzzyMatch.verification_source,
            source:             "db_fuzzy",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 3. Not in DB — ask Gemini, then auto-save the result
      console.log(`category-lookup: no DB match for "${normalizedKey}", asking Gemini...`);
      const geminiResult = await askGeminiForCategory(rawItemType);

      if (geminiResult) {
        // Auto-save to DB so future lookups are instant
        try {
          await supabase.from("category_mappings").upsert(
            {
              coin_type:           normalizedKey,
              item_type:           normalizedKey,
              ebay_category_id:    geminiResult.categoryId,
              category_name:       geminiResult.categoryName,
              verification_source: "gemini_ai",
              confidence:          geminiResult.confidence,
              updated_at:          new Date().toISOString(),
            },
            { onConflict: "coin_type" }
          );
          console.log(`category-lookup: auto-saved Gemini result for "${normalizedKey}":`, geminiResult.categoryId);
        } catch (saveErr) {
          console.warn("category-lookup: failed to auto-save Gemini result", saveErr);
        }

        return new Response(
          JSON.stringify({
            found:              true,
            itemType:           normalizedKey,
            categoryId:         geminiResult.categoryId,
            categoryName:       geminiResult.categoryName,
            confidence:         geminiResult.confidence,
            verificationSource: "gemini_ai",
            source:             "gemini",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 4. Complete miss — nothing found
      return new Response(
        JSON.stringify({
          found:    false,
          itemType: normalizedKey,
          message:  "No category found — AI will determine category during analysis",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: verify / breadcrumb ────────────────────────────────────────
    if (action === "verify" || action === "breadcrumb") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for verify/breadcrumb action");

      // Quick local DB check first
      try {
        const { data: local } = await supabase
          .from("category_mappings")
          .select("ebay_category_id, category_name")
          .eq("ebay_category_id", cid)
          .maybeSingle();
        if (local?.category_name) {
          return new Response(
            JSON.stringify({
              valid:        true,
              source:       "db",
              categoryName: local.category_name,
              breadcrumb:   local.category_name,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (_) { /* continue to remote */ }

      // Remote eBay Taxonomy API
      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        return new Response(
          JSON.stringify({ valid: null, source: "none", message: "No eBay app credentials configured" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await fetchBreadcrumb(cid, ebayAuth.token, ebayAuth.base);
      if (!result.valid) {
        return new Response(
          JSON.stringify({ valid: false, source: "remote", breadcrumb: null, categoryName: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ valid: true, source: "remote", categoryName: result.categoryName, breadcrumb: result.breadcrumb }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ACTION: store (admin or auto-save from analyze-item) ──────────────
    if (action === "store") {
      const rawKey = normalizeItemType(rawItemType || categoryName || "");

      // If called with an Authorization header, verify admin
      const authHeader = req.headers.get("authorization");
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, "");
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user?.id) {
          return new Response(
            JSON.stringify({ error: "Invalid authorization token" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const userId = userData.user.id;
        const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
        // Allow any authenticated user to store (self-learning), but mark source appropriately
        const isAdmin = profile?.is_admin === true;
        const source  = isAdmin ? (verificationSource || "user_verified") : "ai_auto";

        if (!categoryId) throw new Error("categoryId required for store action");

        const { error } = await supabase.from("category_mappings").upsert(
          {
            coin_type:           rawKey,
            item_type:           rawKey,
            ebay_category_id:    categoryId,
            category_name:       categoryName || null,
            verification_source: source,
            confidence:          isAdmin ? 100 : 80,
            updated_at:          new Date().toISOString(),
          },
          { onConflict: "coin_type" }
        );

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, itemType: rawKey, categoryId, stored: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // No auth header — internal auto-save call from analyze-item
      if (!categoryId) throw new Error("categoryId required for store action");

      const { error } = await supabase.from("category_mappings").upsert(
        {
          coin_type:           rawKey,
          item_type:           rawKey,
          ebay_category_id:    categoryId,
          category_name:       categoryName || null,
          verification_source: verificationSource || "ai_auto",
          confidence:          75,
          updated_at:          new Date().toISOString(),
        },
        { onConflict: "coin_type" }
      );

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, itemType: rawKey, categoryId, stored: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("category-lookup error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

Deno.serve(handleRequest);