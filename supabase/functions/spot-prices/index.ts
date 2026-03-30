import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_TTL_MINUTES = 15;
// Fallback spot prices used when API fetch fails (in USD per troy oz)
// These should be updated monthly or made configurable via env vars
// Last updated: March 2026
const FALLBACK = { gold: 2650, silver: 89, platinum: 1040 };

async function getSpotPrices(
  svc: ReturnType<typeof createClient>,
  forceRefresh = false,
): Promise<{
  gold: number;
  silver: number;
  platinum: number;
  fetched_at: string;
  source: string;
  refreshed: boolean;
}> {
  // 1. Read current cached row from DB
  const { data: cached, error: readErr } = await svc
    .from("spot_price_cache")
    .select("gold, silver, platinum, fetched_at, source")
    .eq("id", 1)
    .single();

  if (readErr) {
    console.error("Failed to read spot_price_cache:", readErr);
  }

  const now = new Date();
  const fetchedAt = cached?.fetched_at ? new Date(cached.fetched_at) : null;
  const ageMinutes = fetchedAt
    ? (now.getTime() - fetchedAt.getTime()) / 60000
    : Infinity;

  // 2. If cache is fresh (< 15 min) and not forced to refresh, return it immediately
  if (cached && ageMinutes < CACHE_TTL_MINUTES && !forceRefresh) {
    return {
      gold: Number(cached.gold),
      silver: Number(cached.silver),
      platinum: Number(cached.platinum),
      fetched_at: cached.fetched_at,
      source: cached.source,
      refreshed: false,
    };
  }

  // 3. Cache is stale — fetch fresh prices from Kitco (reliable fallback)
  let fresh: { gold: number; silver: number; platinum: number } | null = null;
  let source = "fallback";

  try {
    const resp = await fetch("https://www.kitco.com/price/precious-metals", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ListingAssistant/1.0)",
      },
    });
    if (resp.ok) {
      const html = await resp.text();

      // Parse prices from Kitco HTML using regex
      // Looking for patterns like: Silver</a></span><span>67.56</span>
      const goldMatch = html.match(/Gold<\/a>.*?<span>([\d,]+\.?\d*)<\/span>/s);
      const silverMatch = html.match(
        /Silver<\/a>.*?<span>([\d,]+\.?\d*)<\/span>/s,
      );
      const platinumMatch = html.match(
        /Platinum<\/a>.*?<span>([\d,]+\.?\d*)<\/span>/s,
      );

      const prices = {
        gold: goldMatch ? parseFloat(goldMatch[1].replace(/,/g, "")) : 0,
        silver: silverMatch ? parseFloat(silverMatch[1].replace(/,/g, "")) : 0,
        platinum: platinumMatch
          ? parseFloat(platinumMatch[1].replace(/,/g, ""))
          : 0,
      };

      console.log("Kitco parsed prices:", prices);

      if (prices.gold > 0 && prices.silver > 0) {
        fresh = prices;
        source = "kitco.com";
        console.log("Successfully fetched fresh prices from Kitco");
      } else {
        console.warn("Kitco parsed prices invalid:", { prices });
      }
    } else {
      console.warn(`Kitco returned status ${resp.status}`);
    }
  } catch (e) {
    console.error("Kitco fetch failed:", e);
  }

  // 4. If live fetch failed, use existing cached values or hardcoded fallback
  const prices = fresh ??
    (cached
      ? {
        gold: Number(cached.gold),
        silver: Number(cached.silver),
        platinum: Number(cached.platinum),
      }
      : FALLBACK);

  if (!fresh) {
    source = cached ? "db-stale" : "fallback";
    console.warn(`Using ${source} spot prices`);
  }

  // 5. Upsert fresh prices into DB so all users share the update
  const { error: upsertErr } = await svc
    .from("spot_price_cache")
    .upsert({
      id: 1,
      gold: prices.gold,
      silver: prices.silver,
      platinum: prices.platinum,
      fetched_at: now.toISOString(),
      source,
    });

  if (upsertErr) {
    console.error("Failed to upsert spot_price_cache:", upsertErr);
  }

  return {
    ...prices,
    fetched_at: now.toISOString(),
    source,
    refreshed: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Check for force_refresh query parameter to bypass cache
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("force_refresh") === "true";

    const { gold, silver, platinum, fetched_at, source, refreshed } =
      await getSpotPrices(svc, forceRefresh);

    // If body has metalType & weightOz, also calculate melt value
    let meltValue: number | null = null;
    let metalType: string | null = null;
    let weightOz: number | null = null;

    try {
      const body = await req.json();
      metalType = body.metalType?.toLowerCase() || null;
      weightOz = body.weightOz || null;
    } catch {
      // GET or empty body — just return spot prices
    }

    if (metalType && weightOz && weightOz > 0) {
      const spotPrice = metalType === "gold"
        ? gold
        : metalType === "silver"
        ? silver
        : metalType === "platinum"
        ? platinum
        : 0;
      meltValue = parseFloat((spotPrice * weightOz).toFixed(2));
    }

    return new Response(
      JSON.stringify({
        spotPrices: { gold, silver, platinum },
        meltValue,
        metalType,
        weightOz,
        fetched_at,
        source,
        refreshed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("spot-prices error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
