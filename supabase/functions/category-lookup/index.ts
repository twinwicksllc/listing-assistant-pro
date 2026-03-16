import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export async function handleRequest(req: Request): Promise<Response> {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    if (action === "store") {
      // Store a new or updated category mapping
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
