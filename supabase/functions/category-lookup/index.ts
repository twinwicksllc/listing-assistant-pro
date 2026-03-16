import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Initialize the category_mappings table if it doesn't exist
async function ensureTableExists() {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    console.warn("DATABASE_URL not set, cannot create table");
    return;
  }

  const client = new postgres.Client(databaseUrl);

  try {
    await client.connect();

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public.category_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coin_type TEXT NOT NULL UNIQUE,
        ebay_category_id TEXT NOT NULL,
        category_name TEXT,
        verified_at TIMESTAMPTZ DEFAULT NOW(),
        verification_source TEXT DEFAULT 'user_verified',
        confidence SMALLINT DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_category_mappings_coin_type ON public.category_mappings(coin_type);

      -- Pre-populate if empty
      INSERT INTO public.category_mappings (coin_type, ebay_category_id, category_name, verification_source, confidence)
      VALUES
        ('wheat penny 1909-1958', '39455', 'Wheat Penny (1909-1958)', 'user_verified', 100),
        ('kennedy half dollar', '41102', 'Kennedy Half Dollar', 'user_verified', 100),
        ('franklin half dollar', '11973', 'Franklin Half Dollar', 'user_verified', 100),
        ('copper rounds', '166679', 'Copper Rounds', 'user_verified', 100),
        ('morgan dollar', '41419', 'Morgan Dollar', 'user_verified', 100),
        ('peace dollar', '41421', 'Peace Dollar', 'user_verified', 100),
        ('barber coin', '11970', 'Barber Coin', 'user_verified', 100),
        ('liberty walking half dollar', '11973', 'Liberty Walking Half Dollar', 'user_verified', 100),
        ('lincoln cent 1909-1958', '39455', 'Lincoln Cent (1909-1958)', 'user_verified', 100),
        ('silver eagle', '165752', 'Silver Eagle', 'user_verified', 100)
      ON CONFLICT (coin_type) DO NOTHING;
    `;

    await client.queryArray(createTableSQL);
    console.log("category-lookup: table initialized");

    await client.end();
  } catch (error) {
    console.warn("category-lookup: error initializing table:", error);
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Ensure table exists on first call
  await ensureTableExists();

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
