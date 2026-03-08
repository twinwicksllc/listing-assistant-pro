import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Cache spot prices for 5 minutes to avoid hammering the API
let cachedPrices: { gold: number; silver: number; platinum: number } | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchSpotPrices(): Promise<{ gold: number; silver: number; platinum: number }> {
  const now = Date.now();
  if (cachedPrices && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPrices;
  }

  // Try metals.live (free, no API key)
  try {
    const resp = await fetch("https://api.metals.live/v1/spot", {
      headers: { "Accept": "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json();
      // metals.live returns array: [{gold: x, silver: y, platinum: z, ...}]
      const spot = Array.isArray(data) ? data[0] : data;
      const prices = {
        gold: parseFloat(spot.gold) || 0,
        silver: parseFloat(spot.silver) || 0,
        platinum: parseFloat(spot.platinum) || 0,
      };
      if (prices.gold > 0) {
        cachedPrices = prices;
        cacheTimestamp = now;
        return prices;
      }
    }
  } catch (e) {
    console.error("metals.live fetch failed:", e);
  }

  // Fallback: use reasonable defaults (updated periodically)
  const fallback = { gold: 2650, silver: 31, platinum: 1000 };
  console.warn("Using fallback spot prices");
  cachedPrices = fallback;
  cacheTimestamp = now;
  return fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const prices = await fetchSpotPrices();

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
      const spotPrice =
        metalType === "gold" ? prices.gold :
        metalType === "silver" ? prices.silver :
        metalType === "platinum" ? prices.platinum : 0;
      meltValue = parseFloat((spotPrice * weightOz).toFixed(2));
    }

    return new Response(
      JSON.stringify({
        spotPrices: prices,
        meltValue,
        metalType,
        weightOz,
        cached: Date.now() - cacheTimestamp < 1000 ? false : true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("spot-prices error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
