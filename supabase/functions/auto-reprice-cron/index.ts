import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
interface RepriceRule {
  id: string;
  user_id: string;
  rule_name: string;
  rule_type: "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";
  adjustment_pct: number;
  floor_price: number | null;
  ceiling_price: number | null;
  category_filter: string | null;
  is_enabled: boolean;
}

interface EbayListing {
  listingId: string | null;
  offerId: string | null;
  sku: string;
  title: string;
  price: number;
  categoryId?: string | null;
}

interface MarketData {
  avgSoldPrice: number | null;
  minActivePrice: number | null;
  avgActivePrice: number | null;
}

// ----------------------------------------------------------------
// Apply a single reprice rule to a target price
// ----------------------------------------------------------------
function applyRule(rule: RepriceRule, market: MarketData): number | null {
  let basePrice: number | null = null;

  switch (rule.rule_type) {
    case "match_sold_avg":
      basePrice = market.avgSoldPrice;
      break;
    case "match_avg":
      basePrice = market.avgActivePrice;
      break;
    case "match_lowest":
      basePrice = market.minActivePrice;
      break;
    case "beat_lowest":
      // adjustment_pct is negative (e.g. -5 = 5% below lowest)
      if (market.minActivePrice) {
        basePrice = market.minActivePrice * (1 + rule.adjustment_pct / 100);
      }
      break;
  }

  if (!basePrice || basePrice <= 0) return null;

  // Apply adjustment percentage (for match_* rules)
  if (rule.rule_type !== "beat_lowest" && rule.adjustment_pct !== 0) {
    basePrice = basePrice * (1 + rule.adjustment_pct / 100);
  }

  // Apply floor / ceiling
  if (rule.floor_price && basePrice < rule.floor_price) {
    basePrice = rule.floor_price;
  }
  if (rule.ceiling_price && basePrice > rule.ceiling_price) {
    basePrice = rule.ceiling_price;
  }

  return Math.round(basePrice * 100) / 100;
}

// ----------------------------------------------------------------
// Fetch market data for a listing title via keyword-research
// ----------------------------------------------------------------
async function fetchMarketData(
  supabaseUrl: string,
  serviceKey: string,
  title: string,
  categoryId?: string | null
): Promise<MarketData> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/keyword-research`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: title, categoryId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { avgSoldPrice: null, minActivePrice: null, avgActivePrice: null };
    const data = await resp.json();
    return {
      avgSoldPrice: data.avgSoldPrice ?? null,
      minActivePrice: data.minActivePrice ?? null,
      avgActivePrice: data.avgActivePrice ?? null,
    };
  } catch {
    return { avgSoldPrice: null, minActivePrice: null, avgActivePrice: null };
  }
}

// ----------------------------------------------------------------
// Apply price update via ebay-reprice function
// ----------------------------------------------------------------
async function applyRepriceUpdate(
  supabaseUrl: string,
  serviceKey: string,
  ebayToken: string,
  listing: EbayListing,
  newPrice: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/ebay-reprice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "x-supabase-auth-token": ebayToken,
      },
      body: JSON.stringify({
        action: "single_update",
        offerId: listing.offerId,
        sku: listing.sku,
        listingId: listing.listingId,
        newPrice,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { success: data.success ?? false, error: data.error };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const { userId, dryRun = false, listingIds } = body as {
      userId?: string;
      dryRun?: boolean;
      listingIds?: string[];
    };

    // If no userId provided, process all users with enabled rules (cron mode)
    let userIds: string[] = [];
    if (userId) {
      userIds = [userId];
    } else {
      // Cron mode: get all distinct users with at least one enabled rule
      const { data: ruleUsers } = await supabase
        .from("reprice_rules")
        .select("user_id")
        .eq("is_enabled", true);
      userIds = [...new Set((ruleUsers ?? []).map((r: { user_id: string }) => r.user_id))];
    }

    console.log(`[auto-reprice-cron] Processing ${userIds.length} user(s), dryRun=${dryRun}`);

    const allResults: object[] = [];

    for (const uid of userIds) {
      // Get enabled rules for this user
      const { data: rules } = await supabase
        .from("reprice_rules")
        .select("*")
        .eq("user_id", uid)
        .eq("is_enabled", true);

      if (!rules || rules.length === 0) continue;

      // Get eBay token for this user from profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("ebay_token")
        .eq("id", uid)
        .single();

      const ebayToken = profile?.ebay_token;
      if (!ebayToken) {
        console.warn(`[auto-reprice-cron] No eBay token for user ${uid}, skipping`);
        continue;
      }

      // Fetch user's active listings
      let listingsResp;
      try {
        listingsResp = await fetch(`${supabaseUrl}/functions/v1/ebay-listings`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "x-supabase-auth-token": ebayToken,
          },
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        console.warn(`[auto-reprice-cron] Failed to fetch listings for ${uid}: ${e}`);
        continue;
      }

      if (!listingsResp.ok) continue;

      const listingsData = await listingsResp.json();
      let listings: EbayListing[] = (listingsData.listings ?? []).map((l: {
        listingId?: string | null;
        offerId?: string | null;
        sku?: string;
        title?: string;
        price?: number;
        categoryId?: string | null;
      }) => ({
        listingId: l.listingId ?? null,
        offerId: l.offerId ?? null,
        sku: l.sku ?? "",
        title: l.title ?? "",
        price: l.price ?? 0,
        categoryId: l.categoryId ?? null,
      }));

      // Filter to specific listings if provided
      if (listingIds && listingIds.length > 0) {
        listings = listings.filter(l => listingIds.includes(l.listingId ?? ""));
      }

      // Limit to top 20 per run to avoid rate limits
      listings = listings.slice(0, 20);

      console.log(`[auto-reprice-cron] User ${uid}: ${listings.length} listings, ${rules.length} rules`);

      for (const listing of listings) {
        if (!listing.title || listing.price <= 0) continue;

        // Find matching rule for this listing
        const matchingRule = (rules as RepriceRule[]).find(rule => {
          if (!rule.is_enabled) return false;
          if (rule.category_filter && listing.categoryId !== rule.category_filter) return false;
          return true;
        });

        if (!matchingRule) continue;

        // Fetch market data (cached in keyword-research for 4h)
        const market = await fetchMarketData(supabaseUrl, serviceKey, listing.title, listing.categoryId);

        const newPrice = applyRule(matchingRule, market);
        if (!newPrice || newPrice === listing.price) continue;

        // Skip if change is less than 1% (noise)
        const pctChange = Math.abs((newPrice - listing.price) / listing.price);
        if (pctChange < 0.01) continue;

        const result = {
          listingId: listing.listingId,
          title: listing.title,
          oldPrice: listing.price,
          newPrice,
          ruleApplied: matchingRule.rule_name,
          ruleType: matchingRule.rule_type,
          applied: false,
          error: null as string | null,
        };

        if (!dryRun) {
          // Apply the price change
          const applyResult = await applyRepriceUpdate(
            supabaseUrl, serviceKey, ebayToken, listing, newPrice
          );
          result.applied = applyResult.success;
          result.error = applyResult.error ?? null;

          // Log to optimization_history
          await supabase.from("optimization_history").insert({
            user_id: uid,
            listing_id: listing.listingId ?? listing.sku,
            listing_title: listing.title,
            optimization_type: "reprice_rule",
            old_value: String(listing.price),
            new_value: String(newPrice),
            reasoning: `Rule "${matchingRule.rule_name}" (${matchingRule.rule_type})`,
            applied_by: "auto",
            result: applyResult.success ? "accepted" : "pending",
          });
        } else {
          result.applied = false; // dry run
        }

        allResults.push(result);
        console.log(`[auto-reprice-cron] ${dryRun ? "[DRY RUN]" : ""} ${listing.title}: $${listing.price} → $${newPrice} (${matchingRule.rule_name})`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        processed: allResults.length,
        results: allResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-reprice-cron] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});