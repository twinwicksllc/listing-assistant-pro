import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Cache TTL ────────────────────────────────────────────────────────────────
// 12 hours keeps us well within metals.dev free tier (100 req/month).
// 2 refreshes/day × 31 days = ~62 requests/month.
const CACHE_TTL_MINUTES = 12 * 60; // 720 minutes

// ── Fallback values ──────────────────────────────────────────────────────────
// Updated to approximate March 2026 spot prices.
// These are only used if the DB cache is empty AND metals.dev is unreachable.
const FALLBACK = { gold: 5200, silver: 89, platinum: 2200 };

// ── metals.dev API ───────────────────────────────────────────────────────────
// API key stored as Supabase secret: METALS_DEV_API_KEY
// Sign up free at https://metals.dev — 100 req/month on free tier.
// Endpoint: GET https://api.metals.dev/v1/latest?api_key=KEY&currency=USD&unit=toz
async function fetchFromMetalsDev(): Promise<{ gold: number; silver: number; platinum: number } | null> {
  const apiKey = Deno.env.get("METALS_DEV_API_KEY");
  if (!apiKey) {
    console.warn("METALS_DEV_API_KEY secret not set — skipping live fetch");
    return null;
  }

  try {
    const url = `https://api.metals.dev/v1/latest?api_key=${apiKey}&currency=USD&unit=toz`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000), // 8s timeout
    });

    if (!resp.ok) {
      console.error(`metals.dev returned HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    if (data.status !== "success" || !data.metals) {
      console.error("metals.dev unexpected response:", JSON.stringify(data).slice(0, 200));
      return null;
    }

    const gold     = parseFloat(data.metals.gold)     || 0;
    const silver   = parseFloat(data.metals.silver)   || 0;
    const platinum = parseFloat(data.metals.platinum) || 0;

    if (gold <= 0 || silver <= 0) {
      console.error("metals.dev returned zero/invalid prices:", data.metals);
      return null;
    }

    console.log(`metals.dev prices — gold: ${gold}, silver: ${silver}, platinum: ${platinum}`);
    return { gold, silver, platinum };
  } catch (e) {
    console.error("metals.dev fetch error:", e);
    return null;
  }
}

// ── Main cache logic ─────────────────────────────────────────────────────────
async function getSpotPrices(svc: ReturnType<typeof createClient>): Promise<{
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

  // 2. If cache is fresh (< 12 hours), return it immediately — no API call needed
  if (cached && ageMinutes < CACHE_TTL_MINUTES) {
    console.log(`Cache hit — age: ${Math.round(ageMinutes)}min, source: ${cached.source}`);
    return {
      gold: Number(cached.gold),
      silver: Number(cached.silver),
      platinum: Number(cached.platinum),
      fetched_at: cached.fetched_at,
      source: cached.source,
      refreshed: false,
    };
  }

  console.log(`Cache stale (age: ${Math.round(ageMinutes)}min) — fetching from metals.dev`);

  // 3. Cache is stale — fetch fresh prices from metals.dev
  const fresh = await fetchFromMetalsDev();

  // 4. If live fetch failed, use existing cached values or hardcoded fallback
  const prices = fresh ?? (cached
    ? { gold: Number(cached.gold), silver: Number(cached.silver), platinum: Number(cached.platinum) }
    : FALLBACK);

  const source = fresh
    ? "metals.dev"
    : cached ? "db-stale" : "fallback";

  if (!fresh) {
    console.warn(`Using ${source} spot prices — metals.dev unavailable`);
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

// ── HTTP handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { gold, silver, platinum, fetched_at, source, refreshed } =
      await getSpotPrices(svc);

    // If body has metalType & weightOz, also calculate melt value
    let meltValue: number | null = null;
    let metalType: string | null = null;
    let weightOz: number | null = null;

    try {
      const body = await req.json();
      metalType = body.metalType?.toLowerCase() || null;
      weightOz  = body.weightOz || null;
    } catch {
      // GET or empty body — just return spot prices
    }

    if (metalType && weightOz && weightOz > 0) {
      const spotPrice =
        metalType === "gold"     ? gold :
        metalType === "silver"   ? silver :
        metalType === "platinum" ? platinum : 0;
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
