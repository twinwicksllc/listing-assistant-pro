import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

// auto-reprice-trigger: Manual trigger for auto-reprice operations
// Applies enabled repricing rules to user's active listings
// 
// API Quota Awareness:
// - eBay Inventory API: ~500 bulk operations/day
// - This function calls ebay-reprice which batches updates (25 per call)
// - Recommended: Debounce manual triggers to 1x per minute on frontend
//   to avoid exhausting daily quota from repeated rapid clicks
// 
// Front-end should prevent abuse via:
// 1. Button disabled while running
// 2. Cooldown period (60s) between consecutive runs
// 3. Dry-run preview before committing changes

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface RepriceRule {
  id: string;
  rule_name: string;
  rule_type: "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";
  adjustment_pct: number;
  floor_price: number | null;
  ceiling_price: number | null;
  category_filter: string | null;
  is_enabled: boolean;
}

interface Listing {
  id: string;
  ebay_item_id: string;
  current_price: number;
  currency: string;
}

interface MarketData {
  min_competitor_price?: number;
  avg_competitor_price?: number;
  avg_sold_price?: number;
}

// Apply a single rule to a listing
async function applyRule(
  rule: RepriceRule,
  listing: Listing,
  marketData: MarketData,
): Promise<number | null> {
  let basePrice: number | undefined;

  switch (rule.rule_type) {
    case "match_lowest":
      basePrice = marketData.min_competitor_price;
      break;
    case "beat_lowest":
      basePrice = marketData.min_competitor_price;
      if (basePrice) basePrice += Math.abs(rule.adjustment_pct) * 0.01 * basePrice;
      break;
    case "match_avg":
      basePrice = marketData.avg_competitor_price;
      break;
    case "match_sold_avg":
      basePrice = marketData.avg_sold_price;
      break;
  }

  if (!basePrice || basePrice <= 0) return null;

  // Apply adjustment percentage (if not already applied for beat_lowest)
  if (rule.rule_type !== "beat_lowest") {
    basePrice += (rule.adjustment_pct * 0.01) * basePrice;
  }

  // Apply floor/ceiling constraints
  if (rule.floor_price !== null && basePrice < rule.floor_price) {
    basePrice = rule.floor_price;
  }
  if (rule.ceiling_price !== null && basePrice > rule.ceiling_price) {
    basePrice = rule.ceiling_price;
  }

  return Math.max(basePrice, 0.99);
}

// Main handler
serve(async (req) => {
  try {
    const { userId, dryRun = false } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId required" }),
        { status: 400 },
      );
    }

    // Fetch enabled rules for this user
    const { data: rules, error: rulesError } = await supabase
      .from("reprice_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("is_enabled", true);

    if (rulesError) throw rulesError;

    if (!rules || rules.length === 0) {
      return new Response(
        JSON.stringify({ message: "No enabled rules", updated: 0 }),
        { status: 200 },
      );
    }

    // Fetch user's listings
    const { data: listings, error: listingsError } = await supabase
      .from("listings")
      .select("id, ebay_item_id, current_price, currency")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (listingsError) throw listingsError;

    let updated = 0;
    const priceUpdates: Array<{ listing_id: string; new_price: number }> = [];

    // For each listing, apply all enabled rules
    for (const listing of listings || []) {
      // Fetch market data for this listing
      const { data: priceData } = await supabase
        .from("competitor_prices")
        .select("min_price, avg_price, avg_sold_price")
        .eq("listing_id", listing.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!priceData) continue;

      const marketData: MarketData = {
        min_competitor_price: priceData.min_price,
        avg_competitor_price: priceData.avg_price,
        avg_sold_price: priceData.avg_sold_price,
      };

      // Apply first enabled rule that has market data
      for (const rule of rules) {
        const newPrice = await applyRule(rule, listing, marketData);
        if (newPrice && newPrice !== listing.current_price) {
          priceUpdates.push({
            listing_id: listing.id,
            new_price: newPrice,
          });
          break; // Only apply first matching rule
        }
      }
    }

    // If dry run, just return counts
    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          wouldUpdate: priceUpdates.length,
          totalListings: listings?.length || 0,
        }),
        { status: 200 },
      );
    }

    // Apply updates via eBay API
    for (const update of priceUpdates) {
      try {
        const { data: listing } = await supabase
          .from("listings")
          .select("ebay_item_id, currency")
          .eq("id", update.listing_id)
          .single();

        if (listing) {
          // Call eBay reprice function
          const { error: repriceError } = await supabase.functions.invoke(
            "ebay-reprice",
            {
              body: {
                itemId: listing.ebay_item_id,
                price: update.new_price,
                currency: listing.currency,
              },
            },
          );

          if (!repriceError) {
            updated++;

            // Log to optimization_history
            await supabase.from("optimization_history").insert({
              user_id: userId,
              listing_id: update.listing_id,
              action_type: "auto_reprice",
              old_price: null,
              new_price: update.new_price,
              reason: "Rule-based auto-reprice",
            });
          }
        }
      } catch (e) {
        console.error(`Failed to reprice listing ${update.listing_id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated }),
      { status: 200 },
    );
  } catch (error) {
    console.error("Auto-reprice trigger error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 },
    );
  }
});
