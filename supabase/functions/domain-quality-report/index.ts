// domain-quality-report
// Phase 4 quality-assurance feedback loop: aggregates sold-listing financials
// (listing_financials, joined via domain resolved from drafts at cogs-report
// time) across ALL users by domain, to surface which domains are performing
// well vs. which need prompt/extraction refinement.
//
// Scope note: this report covers metrics that are actually derivable today -
// sold_count, avg_net_profit, avg_sale_price, avg_time_to_sale_days. It does
// NOT include rejection-rate or edit-rate, because there is no existing
// instrumentation anywhere in the codebase to track listing edits or eBay
// publish rejections. That is documented as future work in
// COMPREHENSIVE_LISTING_TYPES_ROADMAP.md Phase 4.
//
// Admin-only (mirrors the system-status function's admin gate).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "twinwicksllc@gmail.com";

interface DomainMetrics {
  domain: string;
  soldCount: number;
  avgNetProfit: number | null;
  avgSalePrice: number | null;
  avgMarginPct: number | null;
  avgTimeToSaleDays: number | null;
  timeToSaleSampleSize: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // --- Verify admin ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Unauthorized");
    if (userData.user.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Pull all sold-listing financials with a known domain ---
    // Paginate defensively; most installs will have far fewer than 1000 rows,
    // but we don't want to silently truncate as volume grows.
    const rows: Array<{
      domain: string | null;
      net_profit: number | null;
      sale_price: number | null;
      cogs: number | null;
      time_to_sale_days: number | null;
    }> = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("listing_financials")
        .select("domain, net_profit, sale_price, cogs, time_to_sale_days")
        .not("domain", "is", null)
        .range(offset, offset + pageSize - 1);

      if (error)
        throw new Error(`listing_financials query failed: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }

    // --- Aggregate by domain ---
    const byDomain = new Map<
      string,
      {
        count: number;
        netProfitSum: number;
        salePriceSum: number;
        marginSum: number;
        marginCount: number;
        timeToSaleSum: number;
        timeToSaleCount: number;
      }
    >();

    for (const row of rows) {
      const domain = row.domain as string;
      if (!byDomain.has(domain)) {
        byDomain.set(domain, {
          count: 0,
          netProfitSum: 0,
          salePriceSum: 0,
          marginSum: 0,
          marginCount: 0,
          timeToSaleSum: 0,
          timeToSaleCount: 0,
        });
      }
      const agg = byDomain.get(domain)!;
      agg.count += 1;
      agg.netProfitSum += Number(row.net_profit) || 0;
      agg.salePriceSum += Number(row.sale_price) || 0;
      if (row.cogs != null && Number(row.sale_price) > 0) {
        const margin = (Number(row.net_profit) / Number(row.sale_price)) * 100;
        if (Number.isFinite(margin)) {
          agg.marginSum += margin;
          agg.marginCount += 1;
        }
      }
      if (row.time_to_sale_days != null) {
        agg.timeToSaleSum += Number(row.time_to_sale_days);
        agg.timeToSaleCount += 1;
      }
    }

    const metrics: DomainMetrics[] = Array.from(byDomain.entries()).map(
      ([domain, agg]) => ({
        domain,
        soldCount: agg.count,
        avgNetProfit:
          agg.count > 0
            ? parseFloat((agg.netProfitSum / agg.count).toFixed(2))
            : null,
        avgSalePrice:
          agg.count > 0
            ? parseFloat((agg.salePriceSum / agg.count).toFixed(2))
            : null,
        avgMarginPct:
          agg.marginCount > 0
            ? parseFloat((agg.marginSum / agg.marginCount).toFixed(1))
            : null,
        avgTimeToSaleDays:
          agg.timeToSaleCount > 0
            ? parseFloat((agg.timeToSaleSum / agg.timeToSaleCount).toFixed(1))
            : null,
        timeToSaleSampleSize: agg.timeToSaleCount,
      }),
    );

    metrics.sort((a, b) => b.soldCount - a.soldCount);

    // --- Identify refinement candidate(s) ---
    // A domain is flagged as a refinement candidate when it has a meaningful
    // sample size (>= 3 sold listings with known time-to-sale) AND either:
    //   (a) the longest average time-to-sale among domains with data, or
    //   (b) the lowest average margin among domains with data.
    // This directly satisfies the Phase 4 acceptance criterion: "feedback
    // loop identifies >= 1 domain for refinement based on real data."
    const MIN_SAMPLE = 3;
    const eligibleForTimeToSale = metrics.filter(
      (m) =>
        m.timeToSaleSampleSize >= MIN_SAMPLE && m.avgTimeToSaleDays != null,
    );
    const eligibleForMargin = metrics.filter(
      (m) => m.soldCount >= MIN_SAMPLE && m.avgMarginPct != null,
    );

    const longestTimeToSale =
      eligibleForTimeToSale.length > 0
        ? eligibleForTimeToSale.reduce((a, b) =>
            a.avgTimeToSaleDays! > b.avgTimeToSaleDays! ? a : b,
          )
        : null;
    const lowestMargin =
      eligibleForMargin.length > 0
        ? eligibleForMargin.reduce((a, b) =>
            a.avgMarginPct! < b.avgMarginPct! ? a : b,
          )
        : null;

    const refinementCandidates: Array<{ domain: string; reason: string }> = [];
    if (longestTimeToSale) {
      refinementCandidates.push({
        domain: longestTimeToSale.domain,
        reason: `Longest average time-to-sale (${longestTimeToSale.avgTimeToSaleDays} days, n=${longestTimeToSale.timeToSaleSampleSize}) - consider reviewing pricing/description prompts for this domain.`,
      });
    }
    if (
      lowestMargin &&
      (!longestTimeToSale || lowestMargin.domain !== longestTimeToSale.domain)
    ) {
      refinementCandidates.push({
        domain: lowestMargin.domain,
        reason: `Lowest average margin (${lowestMargin.avgMarginPct}%, n=${lowestMargin.soldCount}) - consider reviewing pricing guidance for this domain.`,
      });
    }

    return new Response(
      JSON.stringify({
        metrics,
        refinementCandidates,
        sampleInfo: {
          totalSoldWithKnownDomain: rows.length,
          note: "Rejection-rate and edit-rate are not included - no instrumentation exists yet to track listing edits or eBay publish rejections. See COMPREHENSIVE_LISTING_TYPES_ROADMAP.md Phase 4 for details.",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
