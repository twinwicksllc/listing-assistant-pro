import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ─── Analytics metrics we want per listing ───────────────────────────────────
const ANALYTICS_METRICS_ARRAY = [
  "LISTING_VIEWS_TOTAL",
  "LISTING_IMPRESSION_TOTAL",
  "CLICK_THROUGH_RATE",
  "SALES_CONVERSION_RATE",
  "TRANSACTION",
];
const ANALYTICS_METRICS = ANALYTICS_METRICS_ARRAY.join(",");

interface AnalyticsSnapshot {
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
}

type AnalyticsMap = Record<string, AnalyticsSnapshot>;

// ─── Fetch analytics for one date window ─────────────────────────────────────
async function fetchAnalyticsForWindow(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  days: number,
): Promise<AnalyticsMap> {
  const result: AnalyticsMap = {};
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const startDate = new Date(yesterday);
    startDate.setDate(startDate.getDate() - days);
    // eBay Analytics API requires yyyymmdd format (no hyphens), not yyyy-mm-dd
    // Use yesterday as end date - eBay doesn't accept today as end date
    const startDateStr = startDate.toISOString().split("T")[0].replace(
      /-/g,
      "",
    );
    const endDateStr = yesterday.toISOString().split("T")[0].replace(/-/g, "");
    // Build URL with properly encoded filter parameter
    const url = new URL(`${apiBase}/sell/analytics/v1/traffic_report`);
    url.searchParams.set("dimension", "LISTING");
    url.searchParams.set(
      "filter",
      `date_range:[${startDateStr}..${endDateStr}]`,
    );
    url.searchParams.set("metric", ANALYTICS_METRICS);

    console.log(`Analytics API (${days}d): Fetching from ${url.toString()}`);
    const trafficResp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!trafficResp.ok) {
      const errText = await trafficResp.text();
      console.warn(
        `Analytics API error (${days}d): ${trafficResp.status} - ${errText.substring(0, 200)}`,
      );
      return result;
    }

    let trafficData: any;
    try {
      const respText = await trafficResp.text();
      trafficData = JSON.parse(respText);
    } catch (e) {
      console.warn(
        `Analytics API error (${days}d): Failed to parse response: ${e}`,
      );
      return result;
    }

    // Debug: log the raw response structure
    console.log(
      `Analytics API (${days}d): Raw trafficData keys: ${Object.keys(trafficData).join(", ")}`,
    );

    // eBay Analytics API returns metric order in header.metrics[].key
    // (NOT in a "metricHeaders" field — that field does not exist in the response)
    // Fall back to our hardcoded request order if header is missing/empty,
    // since eBay guarantees values are returned in the same order as requested.
    const headerMetrics: string[] =
      Array.isArray(trafficData.header?.metrics) && trafficData.header.metrics.length > 0
        ? (trafficData.header.metrics as any[]).map((h: any) => h.key as string)
        : ANALYTICS_METRICS_ARRAY;

    console.log(
      `Analytics API (${days}d): metric order = [${headerMetrics.join(", ")}]`,
    );

    const metricHeaders = headerMetrics;

    const records = trafficData.records || [];

    console.log(
      `Analytics API (${days}d): Got ${records.length} records with ${metricHeaders.length} metric headers`,
    );

    // Log first record structure for debugging
    if (records.length > 0) {
      console.log(
        `Analytics API (${days}d): First record structure:`,
        JSON.stringify(records[0]).substring(0, 300),
      );
      // Log TRANSACTION metric specifically
      const transactionIdx = metricHeaders.indexOf("TRANSACTION");
      if (transactionIdx >= 0 && records[0].metricValues) {
        console.log(
          `Analytics API (${days}d): TRANSACTION metric - idx=${transactionIdx}, value=${
            records[0].metricValues[transactionIdx]?.value
          }`,
        );
      } else {
        console.log(
          `Analytics API (${days}d): TRANSACTION metric not found in response! metricHeaders: ${
            metricHeaders.join(", ")
          }`,
        );
      }
    }

    for (const record of records) {
      const listingKey = record.dimensionValues?.[0]?.value || "";
      if (!listingKey) {
        console.warn(
          `Analytics API (${days}d): Record has no dimensionValues[0].value`,
          record,
        );
        continue;
      }
      const metricValues = record.metricValues || [];
      const getMetric = (name: string): number => {
        const idx = metricHeaders.indexOf(name);
        if (idx < 0 || idx >= metricValues.length) return 0;
        const val = metricValues[idx]?.value;
        const parsed = val ? parseFloat(val) : 0;
        // Log individual metric parsing for first record
        if (listingKey === records[0]?.dimensionValues?.[0]?.value) {
          console.log(
            `Analytics API (${days}d): Metric ${name} (idx ${idx}): raw="${val}" parsed=${parsed}`,
          );
        }
        return parsed;
      };
      const views = Math.round(getMetric("LISTING_VIEWS_TOTAL"));
      const impressions = Math.round(getMetric("LISTING_IMPRESSION_TOTAL"));
      const ctr = getMetric("CLICK_THROUGH_RATE");
      const conversionRate = getMetric("SALES_CONVERSION_RATE");
      const transactions = Math.round(getMetric("TRANSACTION"));

      // Enhanced logging for transactions - log ALL records for first few listings
      if (Object.keys(result).length < 5) {
        console.log(
          `Analytics API (${days}d): Listing ${listingKey} - views=${views}, impressions=${impressions}, transactions=${transactions}`,
        );
      }

      // Enhanced logging for transactions
      if (transactions > 0) {
        console.log(
          `Analytics API (${days}d): Listing ${listingKey} has ${transactions} transaction(s)`,
        );
      }

      result[listingKey] = {
        views,
        impressions,
        clickThroughRate: ctr,
        salesConversionRate: conversionRate,
        transactions,
      };
    }
    const totalTransactions = Object.values(result).reduce(
      (sum, r) => sum + r.transactions,
      0,
    );
    console.log(
      `Analytics API (${days}d): Loaded metrics for ${
        Object.keys(result).length
      } listings, total transactions: ${totalTransactions}`,
    );
    console.log(
      `Analytics API (${days}d): All listing keys returned: ${Object.keys(result).slice(0, 10).join(", ")}${
        Object.keys(result).length > 10 ? "..." : ""
      }`,
    );
  } catch (e) {
    console.error(`Analytics API error (${days}d, non-fatal):`, e);
  }
  return result;
}

// ─── Fetch all three windows in parallel ─────────────────────────────────────
async function fetchAllAnalytics(
  apiBase: string,
  ebayHeaders: Record<string, string>,
): Promise<{ a7: AnalyticsMap; a30: AnalyticsMap; a90: AnalyticsMap }> {
  const [a7, a30, a90] = await Promise.all([
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 7),
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 30),
    fetchAnalyticsForWindow(apiBase, ebayHeaders, 90),
  ]);
  return { a7, a30, a90 };
}

// ─── Merge analytics snapshots onto a listing object ─────────────────────────
function mergeAnalytics(
  listingId: string | null,
  sku: string,
  a7: AnalyticsMap,
  a30: AnalyticsMap,
  a90: AnalyticsMap,
) {
  const key = listingId || sku;
  const s7 = a7[key] || a7[listingId || ""] || a7[sku] || null;
  const s30 = a30[key] || a30[listingId || ""] || a30[sku] || null;
  const s90 = a90[key] || a90[listingId || ""] || a90[sku] || null;

  // Debug logging - show matching process for first few listings
  const shouldLog = Math.random() < 0.1; // Log 10% of merges to avoid spam
  if (shouldLog) {
    console.log(
      `mergeAnalytics: Matching for listingId="${listingId}" sku="${sku}"`,
      {
        key,
        s7Found: !!s7,
        s30Found: !!s30,
        s90Found: !!s90,
        a30SampleKeys: Object.keys(a30).slice(0, 5),
      },
    );
  }

  // Debug logging - once per merge when data found
  if (s7 || s30 || s90) {
    console.log(`mergeAnalytics: Found analytics for ${listingId || sku}`, {
      views7d: s7?.views,
      views30d: s30?.views,
      views90d: s90?.views,
    });
  } else if (!listingId && sku) {
    console.warn(`mergeAnalytics: No analytics found for SKU "${sku}"`, {
      a7Keys: Object.keys(a7).slice(0, 3),
      a30Keys: Object.keys(a30).slice(0, 3),
      a90Keys: Object.keys(a90).slice(0, 3),
    });
  }

  const result = {
    // 30d is the "primary" for backward compat fields
    views: s30?.views ?? 0,
    impressions: s30?.impressions ?? 0,
    clickThroughRate: s30?.clickThroughRate ?? 0,
    salesConversionRate: s30?.salesConversionRate ?? 0,
    transactions: s30?.transactions ?? 0,
    // Per-window breakdowns
    views7d: s7?.views ?? 0,
    views30d: s30?.views ?? 0,
    views90d: s90?.views ?? 0,
    impressions7d: s7?.impressions ?? 0,
    impressions30d: s30?.impressions ?? 0,
    impressions90d: s90?.impressions ?? 0,
    transactions7d: s7?.transactions ?? 0,
    transactions30d: s30?.transactions ?? 0,
    transactions90d: s90?.transactions ?? 0,
  };

  // Log if any transactions are found
  if (
    result.transactions > 0 || result.transactions7d > 0 ||
    result.transactions30d > 0 || result.transactions90d > 0
  ) {
    console.log(
      `mergeAnalytics: ${
        listingId || sku
      } - transactions7d=${result.transactions7d}, transactions30d=${result.transactions30d}, transactions90d=${result.transactions90d}`,
    );
  }

  return result;
}

// ─── Financial summary shape ──────────────────────────────────────────────────
interface FinancialWindow {
  orders: number;
  revenue: number; // item sale prices (excl. tax)
  shippingCollected: number; // delivery cost buyer paid
  ebayFees: number; // totalMarketplaceFee (FVF + ad fees)
  shippingLabels: number; // eBay shipping label costs charged to seller
  refunds: number; // buyer refunds paid out (REFUND transactions)
  nonSaleCharges: number; // store subscription, listing fees, promoted offsite (NON_SALE_CHARGE)
  disputes: number; // lost INR/SNAD cases charged to seller (DISPUTE)
  credits: number; // eBay seller credits e.g. FVF credits (CREDIT)
  netProfit: number; // revenue + shippingCollected - ebayFees - shippingLabels - refunds - nonSaleCharges - disputes + credits
}
interface FinancialSummary {
  w7: FinancialWindow;
  w30: FinancialWindow;
  w90: FinancialWindow;
}
function emptyWindow(): FinancialWindow {
  return {
    orders: 0,
    revenue: 0,
    shippingCollected: 0,
    ebayFees: 0,
    shippingLabels: 0,
    refunds: 0,
    nonSaleCharges: 0,
    disputes: 0,
    credits: 0,
    netProfit: 0,
  };
}
function amt(obj: any): number {
  if (!obj) return 0;
  const v = parseFloat(obj.value ?? "0");
  return isNaN(v) ? 0 : v;
}

// ─── Fetch real order counts + financial data via Fulfillment API ─────────────
// ─── Fetch REFUND / NON_SALE_CHARGE / DISPUTE / CREDIT via Finances API ─────────
// These transaction types are not available in the Fulfillment API and must
// be sourced directly from the Finances API for accurate P&L reporting.
async function fetchFinancesTransactions(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  ninetyDaysAgo: Date,
): Promise<{
  refunds7d: number;
  refunds30d: number;
  refunds90d: number;
  nonSale7d: number;
  nonSale30d: number;
  nonSale90d: number;
  disputes7d: number;
  disputes30d: number;
  disputes90d: number;
  credits7d: number;
  credits30d: number;
  credits90d: number;
}> {
  const result = {
    refunds7d: 0,
    refunds30d: 0,
    refunds90d: 0,
    nonSale7d: 0,
    nonSale30d: 0,
    nonSale90d: 0,
    disputes7d: 0,
    disputes30d: 0,
    disputes90d: 0,
    credits7d: 0,
    credits30d: 0,
    credits90d: 0,
  };
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const fromStr = ninetyDaysAgo.toISOString();
    const toStr = now.toISOString();
    const financesBase = apiBase.replace("api.ebay.com", "apiz.ebay.com");

    // Fetch REFUND, NON_SALE_CHARGE, DISPUTE, CREDIT in parallel
    const types = ["REFUND", "NON_SALE_CHARGE", "DISPUTE", "CREDIT"] as const;
    const responses = await Promise.all(types.map(async (type) => {
      const url = new URL(`${financesBase}/sell/finances/v1/transaction`);
      url.searchParams.set(
        "filter",
        `transactionType:{${type}},transactionDate:[${fromStr}..${toStr}]`,
      );
      url.searchParams.set("limit", "1000");
      const resp = await fetch(url.toString(), { headers: ebayHeaders });
      if (!resp.ok) {
        const txt = await resp.text();
        console.warn(
          `Finances API: ${type} fetch failed (${resp.status}):`,
          txt.substring(0, 200),
        );
        return { type, transactions: [] };
      }
      if (resp.status === 204) return { type, transactions: [] };
      let data: any;
      try {
        const respText = await resp.text();
        data = JSON.parse(respText);
      } catch (e) {
        console.warn(
          `Finances API: ${type} fetch failed to parse (${resp.status}): ${e}`,
        );
        return { type, transactions: [] };
      }
      return { type, transactions: data.transactions || [] };
    }));

    for (const { type, transactions } of responses) {
      console.log(
        `Finances API: Got ${transactions.length} ${type} transactions`,
      );
      for (const tx of transactions) {
        const val = Math.abs(parseFloat(tx.amount?.value ?? "0") || 0);
        if (val <= 0) continue;
        const txDate = tx.transactionDate ? new Date(tx.transactionDate) : null;
        if (!txDate) continue;

        const is7d = txDate >= sevenDaysAgo;
        const is30d = txDate >= thirtyDaysAgo;

        if (type === "REFUND") {
          result.refunds90d += val;
          if (is30d) result.refunds30d += val;
          if (is7d) result.refunds7d += val;
        } else if (type === "NON_SALE_CHARGE") {
          result.nonSale90d += val;
          if (is30d) result.nonSale30d += val;
          if (is7d) result.nonSale7d += val;
        } else if (type === "DISPUTE") {
          result.disputes90d += val;
          if (is30d) result.disputes30d += val;
          if (is7d) result.disputes7d += val;
        } else if (type === "CREDIT") {
          result.credits90d += val;
          if (is30d) result.credits30d += val;
          if (is7d) result.credits7d += val;
        }
      }
    }

    console.log(
      `Finances API (30d): refunds=$${result.refunds30d.toFixed(2)}, nonSale=$${
        result.nonSale30d.toFixed(2)
      }, disputes=$${result.disputes30d.toFixed(2)}, credits=$${result.credits30d.toFixed(2)}`,
    );
  } catch (e) {
    console.warn("Finances API: transaction fetch error (non-fatal):", e);
  }
  return result;
}

// ─── Fetch shipping label costs via Finances API ─────────────────────────────
// The Fulfillment API order objects don't contain the seller's label costs.
// Label purchases appear as SHIPPING_LABEL debit transactions in the Finances API.
async function fetchShippingLabelCosts(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  ninetyDaysAgo: Date,
): Promise<{ labels7d: number; labels30d: number; labels90d: number }> {
  const result = { labels7d: 0, labels30d: 0, labels90d: 0 };
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const fromStr = ninetyDaysAgo.toISOString();
    const toStr = now.toISOString();

    // Finances API uses apiz subdomain
    const financesBase = apiBase.replace("api.ebay.com", "apiz.ebay.com");
    const url = new URL(`${financesBase}/sell/finances/v1/transaction`);
    url.searchParams.set(
      "filter",
      `transactionType:{SHIPPING_LABEL},transactionDate:[${fromStr}..${toStr}]`,
    );
    url.searchParams.set("limit", "200");

    console.log(
      `Finances API: Fetching SHIPPING_LABEL transactions from ${fromStr}`,
    );
    const resp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(
        `Finances API: SHIPPING_LABEL fetch failed (${resp.status}) - label costs will be 0:`,
        txt,
      );
      return result;
    }

    if (resp.status === 204) {
      console.log("Finances API: No SHIPPING_LABEL transactions found");
      return result;
    }

    let data: any;
    try {
      const respText = await resp.text();
      data = JSON.parse(respText);
    } catch (e) {
      console.warn(
        `Finances API: Failed to parse SHIPPING_LABEL response: ${e}`,
      );
      return result;
    }
    const transactions: any[] = data.transactions || [];
    console.log(
      `Finances API: Got ${transactions.length} SHIPPING_LABEL transactions`,
    );

    for (const tx of transactions) {
      // SHIPPING_LABEL are DEBIT transactions — amount.value is the cost (positive number)
      const cost = parseFloat(tx.amount?.value ?? "0") || 0;
      if (cost <= 0) continue;

      const txDate = tx.transactionDate ? new Date(tx.transactionDate) : null;
      if (!txDate) continue;

      result.labels90d += cost;
      if (txDate >= thirtyDaysAgo) result.labels30d += cost;
      if (txDate >= sevenDaysAgo) result.labels7d += cost;
    }

    console.log(
      `Finances API: label costs - 7d=$${result.labels7d.toFixed(2)}, 30d=$${result.labels30d.toFixed(2)}, 90d=$${
        result.labels90d.toFixed(2)
      }`,
    );
  } catch (e) {
    console.warn(
      "Finances API: SHIPPING_LABEL fetch error (non-fatal, label costs will be 0):",
      e,
    );
  }
  return result;
}

// The Analytics API TRANSACTION metric only counts active listings, so
// we use the Fulfillment API to get actual orders + revenue + fees.
async function fetchOrderCounts(
  apiBase: string,
  ebayHeaders: Record<string, string>,
): Promise<
  {
    orders7d: number;
    orders30d: number;
    orders90d: number;
    financial: FinancialSummary;
  }
> {
  const counts = { orders7d: 0, orders30d: 0, orders90d: 0 };
  const financial: FinancialSummary = {
    w7: emptyWindow(),
    w30: emptyWindow(),
    w90: emptyWindow(),
  };

  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fromStr = ninetyDaysAgo.toISOString();

    // Fetch label costs + refunds/credits/disputes/non-sale charges in parallel
    const [labelCosts, finTx] = await Promise.all([
      fetchShippingLabelCosts(apiBase, ebayHeaders, ninetyDaysAgo),
      fetchFinancesTransactions(apiBase, ebayHeaders, ninetyDaysAgo),
    ]);

    const filter = `creationdate:[${fromStr}..]`;
    const url = new URL(`${apiBase}/sell/fulfillment/v1/order`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", "200");

    console.log(`Fulfillment API: Fetching orders from ${fromStr}`);
    const resp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(
        `Fulfillment API error: ${resp.status} - ${errText.substring(0, 300)}`,
      );
      return { ...counts, financial };
    }

    let data: any;
    try {
      const respText = await resp.text();
      data = JSON.parse(respText);
    } catch (e) {
      console.warn(`Fulfillment API: Failed to parse response: ${e}`);
      return { ...counts, financial };
    }
    const orders: any[] = data.orders || [];
    console.log(
      `Fulfillment API: Got ${orders.length} orders (total: ${data.total ?? "?"})`,
    );

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const order of orders) {
      // Skip cancelled orders
      if (order.cancelStatus?.cancelState === "CANCELED") continue;
      // Only count paid orders
      if (order.orderPaymentStatus && order.orderPaymentStatus !== "PAID") {
        continue;
      }

      const lineItemCount = order.lineItems?.length ?? 1;
      const createdAt = order.creationDate ? new Date(order.creationDate) : null;
      if (!createdAt) continue;

      // ── Financial extraction ──────────────────────────────────────────────
      const ps = order.pricingSummary ?? {};
      const revenue = amt(ps.priceSubtotal);
      // shippingCollected = what the buyer paid for shipping (included as income).
      // Offset by real label costs from Finances API applied below at window level.
      // Both must be included together for a correct wash calculation.
      const shippingCollected = Math.max(
        0,
        amt(ps.deliveryCost) - amt(ps.deliveryDiscount),
      );
      const ebayFees = amt(order.totalMarketplaceFee);
      // shippingLabels per-order is $0 here; real costs applied at window level below
      const shippingLabels = 0;

      // Net profit includes shipping collected as income (offset by label costs applied below)
      const netProfit = revenue + shippingCollected - ebayFees;

      const addToWindow = (w: FinancialWindow) => {
        w.orders += lineItemCount;
        w.revenue += revenue;
        w.shippingCollected += shippingCollected;
        w.ebayFees += ebayFees;
        w.shippingLabels += shippingLabels;
        w.netProfit += netProfit;
      };

      addToWindow(financial.w90);
      counts.orders90d += lineItemCount;

      if (createdAt >= thirtyDaysAgo) {
        addToWindow(financial.w30);
        counts.orders30d += lineItemCount;
      }
      if (createdAt >= sevenDaysAgo) {
        addToWindow(financial.w7);
        counts.orders7d += lineItemCount;
      }
    }

    // Apply real shipping label costs from Finances API
    financial.w7.shippingLabels = labelCosts.labels7d;
    financial.w30.shippingLabels = labelCosts.labels30d;
    financial.w90.shippingLabels = labelCosts.labels90d;
    financial.w7.netProfit -= labelCosts.labels7d;
    financial.w30.netProfit -= labelCosts.labels30d;
    financial.w90.netProfit -= labelCosts.labels90d;

    // Apply refunds, non-sale charges, disputes, credits from Finances API
    financial.w7.refunds = finTx.refunds7d;
    financial.w30.refunds = finTx.refunds30d;
    financial.w90.refunds = finTx.refunds90d;
    financial.w7.nonSaleCharges = finTx.nonSale7d;
    financial.w30.nonSaleCharges = finTx.nonSale30d;
    financial.w90.nonSaleCharges = finTx.nonSale90d;
    financial.w7.disputes = finTx.disputes7d;
    financial.w30.disputes = finTx.disputes30d;
    financial.w90.disputes = finTx.disputes90d;
    financial.w7.credits = finTx.credits7d;
    financial.w30.credits = finTx.credits30d;
    financial.w90.credits = finTx.credits90d;

    // Adjust net profit: subtract refunds, non-sale charges, disputes; add credits
    for (const w of [financial.w7, financial.w30, financial.w90]) {
      w.netProfit = w.netProfit - w.refunds - w.nonSaleCharges - w.disputes +
        w.credits;
    }

    if (data.total && data.total > orders.length) {
      console.log(
        `Fulfillment API: ${data.total - orders.length} more orders not fetched (pagination needed)`,
      );
    }

    console.log(
      `Fulfillment API: orders7d=${counts.orders7d}, orders30d=${counts.orders30d}, orders90d=${counts.orders90d}`,
    );
    console.log(
      `Fulfillment API (30d): revenue=$${financial.w30.revenue.toFixed(2)}, fees=$${
        financial.w30.ebayFees.toFixed(2)
      }, labels=$${financial.w30.shippingLabels.toFixed(2)}, net=$${financial.w30.netProfit.toFixed(2)}`,
    );
  } catch (e) {
    console.error("Fulfillment API error (non-fatal):", e);
  }

  return { ...counts, financial };
}

// ─── Fetch WatchCount + QuestionCount via GetItem ────────────────────────────
async function fetchWatchDataForListings(
  listingIds: string[],
  tradingUrl: string,
  userToken: string,
): Promise<Record<string, { watchCount: number; questionCount: number }>> {
  const result: Record<string, { watchCount: number; questionCount: number }> = {};
  if (listingIds.length === 0) return result;

  const promises = listingIds.map(async (itemId) => {
    const singleXml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <IncludeWatchCount>true</IncludeWatchCount>
  <OutputSelector>ItemID,WatchCount,QuestionCount</OutputSelector>
</GetItemRequest>`;
    try {
      const resp = await fetch(tradingUrl, {
        method: "POST",
        headers: {
          "X-EBAY-API-CALL-NAME": "GetItem",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-SITEID": "0",
          "Content-Type": "text/xml",
          "X-EBAY-API-IAF-TOKEN": userToken,
        },
        body: singleXml,
      });
      if (!resp.ok) return;
      const xmlText = await resp.text();
      const getTag = (tag: string) =>
        xmlText.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]
          ?.trim() || "";
      const watchCount = parseInt(getTag("WatchCount") || "0", 10);
      const questionCount = parseInt(getTag("QuestionCount") || "0", 10);
      result[itemId] = {
        watchCount: isNaN(watchCount) ? 0 : watchCount,
        questionCount: isNaN(questionCount) ? 0 : questionCount,
      };
    } catch (e) {
      console.warn(`GetItem failed for ${itemId}:`, e);
    }
  });

  await Promise.all(promises);
  return result;
}

// ─── Trading API fallback ─────────────────────────────────────────────────────
async function fetchListingsViaTradingAPI(
  apiBase: string,
  userToken: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const tradingUrl = apiBase.includes("sandbox")
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";

  // Helper to fetch one page from Trading API
  const fetchTradingPage = async (
    pageNumber: number,
  ): Promise<string | null> => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
  <SoldList><Include>false</Include></SoldList>
  <UnsoldList><Include>false</Include></UnsoldList>
  <ScheduledList><Include>false</Include></ScheduledList>
  <IncludeWatchCount>true</IncludeWatchCount>
</GetMyeBaySellingRequest>`;

    const resp = await fetch(tradingUrl, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-SITEID": "0",
        "Content-Type": "text/xml",
        "X-EBAY-API-IAF-TOKEN": userToken,
      },
      body: xml,
    });

    if (!resp.ok) {
      console.error(`Trading API page ${pageNumber} error: ${resp.status}`);
      return null;
    }
    return await resp.text();
  };

  try {
    // Fetch page 1 first to determine total pages
    const firstPageXml = await fetchTradingPage(1);
    if (!firstPageXml) {
      return new Response(
        JSON.stringify({ listings: [], error: "Trading API error on page 1" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      "Trading API page 1 status: 200 — first 800 chars:",
      firstPageXml.substring(0, 800),
    );

    if (
      firstPageXml.includes("<Ack>Failure</Ack>") ||
      firstPageXml.includes("<Ack>PartialFailure</Ack>")
    ) {
      const errMsg = firstPageXml.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
        firstPageXml.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ||
        "Unknown Trading API error";
      return new Response(
        JSON.stringify({
          listings: [],
          error: `eBay Trading API error: ${errMsg}`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Extract total pages from pagination info
    const totalPages = parseInt(
      firstPageXml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)
        ?.[1] || "1",
      10,
    );
    const totalEntries = parseInt(
      firstPageXml.match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)
        ?.[1] || "0",
      10,
    );
    console.log(
      `Trading API: totalPages=${totalPages}, totalEntries=${totalEntries}`,
    );

    // Collect all XML pages
    const allXmlPages: string[] = [firstPageXml];
    if (totalPages > 1) {
      const pagePromises = [];
      for (let p = 2; p <= totalPages; p++) {
        pagePromises.push(fetchTradingPage(p));
      }
      const extraPages = await Promise.all(pagePromises);
      for (const pg of extraPages) {
        if (pg) allXmlPages.push(pg);
      }
    }
    console.log(`Trading API: fetched ${allXmlPages.length} pages`);

    const listings: any[] = [];

    for (const xmlText of allXmlPages) {
      const activeListMatch = xmlText.match(
        /<ActiveList[^>]*>([\s\S]*?)<\/ActiveList>/,
      );
      if (!activeListMatch) continue;

      const activeListContent = activeListMatch[1];
      const itemMatches = activeListContent.matchAll(
        /<Item>([\s\S]*?)<\/Item>/g,
      );

      for (const match of itemMatches) {
        const item = match[1];
        const get = (tag: string) => {
          const m = item.match(
            new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`),
          );
          return m ? m[1].trim() : "";
        };

        const listingId = get("ItemID");
        const title = get("Title");
        const priceStr = get("CurrentPrice") || get("BuyItNowPrice") || "0";
        const price = parseFloat(priceStr) || 0;
        const currency = item.match(/<CurrentPrice currencyID="([^"]+)"/)?.[1] || "USD";
        const imageUrl = get("GalleryURL") || get("PictureURL") || "";
        const sku = get("SKU");
        const categoryId = get("CategoryID") || "";
        const listingStatus = get("ListingStatus");

        const quantity = parseInt(get("Quantity") || "0", 10);
        const quantitySold = parseInt(get("QuantitySold") || "0", 10);
        const quantityAvailable = quantity - quantitySold;

        const isCompletedOrEnded = listingStatus === "Completed" ||
          listingStatus === "Ended";
        const isSingleQtySold = quantity === 1 && quantitySold >= 1;
        const isGenuinelyActive = quantityAvailable > 0 &&
          !isCompletedOrEnded && !isSingleQtySold;

        if (listingId && isGenuinelyActive) {
          const watchCount = parseInt(get("WatchCount") || "0", 10);
          const questionCount = parseInt(get("QuestionCount") || "0", 10);

          listings.push({
            offerId: null,
            sku: sku || listingId,
            title: title || listingId,
            imageUrl,
            price,
            currency,
            status: "Active",
            categoryId,
            listingId,
            ebayUrl: `https://www.ebay.com/itm/${listingId}`,
            quantity: quantityAvailable,
            format: get("ListingType") === "Chinese" ? "AUCTION" : "FIXED_PRICE",
            condition: get("ConditionDisplayName") || "",
            listingDate: get("StartTime") || null,
            watchCount: isNaN(watchCount) ? 0 : watchCount,
            questionCount: isNaN(questionCount) ? 0 : questionCount,
            // Analytics — filled below
            views: 0,
            views7d: 0,
            views30d: 0,
            views90d: 0,
            impressions: 0,
            impressions7d: 0,
            impressions30d: 0,
            impressions90d: 0,
            clickThroughRate: 0,
            salesConversionRate: 0,
            transactions: 0,
            transactions7d: 0,
            transactions30d: 0,
            transactions90d: 0,
          });
        }
      } // end for itemMatches
    } // end for allXmlPages

    console.log(
      `Trading API fallback: collected ${listings.length} active listings across all pages`,
    );

    // Fetch all three analytics windows + real order counts in parallel
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    };
    const [{ a7, a30, a90 }, orderCounts] = await Promise.all([
      fetchAllAnalytics(apiBase, ebayHeaders),
      fetchOrderCounts(apiBase, ebayHeaders),
    ]);
    console.log(
      `Trading API fallback: Real order counts - 7d=${orderCounts.orders7d}, 30d=${orderCounts.orders30d}, 90d=${orderCounts.orders90d}`,
    );

    // Direct eBay listing URL (no affiliate wrapping)
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      return `https://www.ebay.com/itm/${listingId}`;
    };

    const finalListings = listings.map((l) => ({
      ...l,
      ...mergeAnalytics(l.listingId, l.sku, a7, a30, a90),
      ebayUrl: buildEbayUrl(l.listingId),
    }));

    console.log(
      `Trading API fallback: loaded ${finalListings.length} active listings`,
    );

    return new Response(
      JSON.stringify({
        listings: finalListings,
        needsAuth: false,
        orderCount7d: orderCounts.orders7d,
        orderCount30d: orderCounts.orders30d,
        orderCount90d: orderCounts.orders90d,
        financial: orderCounts.financial,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Trading API fallback exception:", e);
    return new Response(
      JSON.stringify({
        listings: [],
        error: "Failed to load listings via Trading API fallback",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userToken } = await req.json();

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    console.log(
      "ebay-listings: env =",
      ebayEnv,
      "token prefix =",
      userToken ? userToken.substring(0, 20) + "..." : "NONE",
    );
    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

    if (!userToken) {
      return new Response(
        JSON.stringify({ listings: [], needsAuth: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    };

    // eBay Inventory API max limit per page is 100 — paginate to get all offers
    const offers: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 100;
    let totalOffers = 0;

    while (true) {
      const offersResp = await fetch(
        `${apiBase}/sell/inventory/v1/offer?limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: ebayHeaders },
      );

      if (offersResp.status === 401) {
        return new Response(
          JSON.stringify({ listings: [], needsAuth: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!offersResp.ok) {
        const errText = await offersResp.text();
        console.error("eBay offers error:", offersResp.status, errText);

        if (offersResp.status === 401 || offersResp.status === 403) {
          return new Response(
            JSON.stringify({
              listings: [],
              needsAuth: true,
              debug: `eBay API ${offersResp.status}: ${errText}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (offersResp.status === 400 && errText.includes("SKU")) {
          console.warn(
            "eBay Inventory API /offer rejected with SKU error — falling back to Trading API.",
          );
          return await fetchListingsViaTradingAPI(
            apiBase,
            userToken,
            corsHeaders,
          );
        }

        return new Response(
          JSON.stringify({
            listings: [],
            error: `eBay API error ${offersResp.status}: ${errText}`,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let offersData: any;
      try {
        const respText = await offersResp.text();
        offersData = JSON.parse(respText);
      } catch (e) {
        console.warn(`ebay-listings: Failed to parse offers response: ${e}`);
        const page: any[] = [];
        totalOffers = 0;
        continue;
      }
      const page = offersData.offers || [];
      totalOffers = offersData.total ?? page.length;
      offers.push(...page);

      console.log(
        `ebay-listings: Fetched page offset=${offset}, got ${page.length} offers (total=${totalOffers}, accumulated=${offers.length})`,
      );

      // Stop if we've fetched all offers or got an empty page
      if (page.length < PAGE_SIZE || offers.length >= totalOffers) break;

      offset += PAGE_SIZE;
    }

    console.log(
      `ebay-listings: Fetched ${offers.length} total offers from eBay Inventory API (reported total: ${totalOffers})`,
    );

    // Fetch inventory item details for each offer
    const listings = await Promise.all(
      offers.map(async (offer: any) => {
        let product: any = {};
        try {
          const itemResp = await fetch(
            `${apiBase}/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`,
            { headers: ebayHeaders },
          );
          if (itemResp.ok) {
            let itemData: any;
            try {
              const respText = await itemResp.text();
              itemData = JSON.parse(respText);
            } catch (e) {
              console.warn(
                `ebay-listings: Failed to parse inventory item response for SKU "${offer.sku}": ${e}`,
              );
              itemData = {};
            }
            product = itemData.product || {};
          } else if (itemResp.status === 400 || itemResp.status === 404) {
            console.warn(
              `Skipping inventory fetch for SKU "${offer.sku}": ${itemResp.status}`,
            );
          }
        } catch (err) {
          console.warn(`Error fetching inventory for SKU "${offer.sku}":`, err);
        }

        return {
          offerId: offer.offerId,
          sku: offer.sku,
          title: product.title || offer.sku,
          imageUrl: product.imageUrls?.[0] || "",
          price: parseFloat(offer.pricingSummary?.price?.value || "0"),
          currency: offer.pricingSummary?.price?.currency || "USD",
          status: offer.status || "UNKNOWN",
          categoryId: offer.categoryId || "",
          listingId: offer.listing?.listingId || null,
          quantity: offer.availableQuantity ?? 1,
          format: offer.format || "FIXED_PRICE",
          condition: offer.condition || "",
          listingDate: offer.listing?.publishedDate || null,
          // Stats placeholder
          views: 0,
          views7d: 0,
          views30d: 0,
          views90d: 0,
          impressions: 0,
          impressions7d: 0,
          impressions30d: 0,
          impressions90d: 0,
          clickThroughRate: 0,
          salesConversionRate: 0,
          transactions: 0,
          transactions7d: 0,
          transactions30d: 0,
          transactions90d: 0,
          watchCount: 0,
          questionCount: 0,
        };
      }),
    );

    const tradingUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/ws/api.dll"
      : "https://api.ebay.com/ws/api.dll";

    // Fetch watch data and all three analytics windows in parallel
    const listingIds = listings.map((l: any) => l.listingId).filter(
      Boolean,
    ) as string[];
    console.log(
      `ebay-listings: Found ${listingIds.length} listings with IDs for analytics lookup: ${
        listingIds.slice(0, 3).join(", ")
      }${listingIds.length > 3 ? "..." : ""}`,
    );
    console.log(
      `ebay-listings: First 5 listing keys (listingId|sku): ${
        listings.slice(0, 5).map((l) => `${l.listingId || "null"}|${l.sku}`)
          .join(", ")
      }`,
    );

    const [watchMap, { a7, a30, a90 }, orderCounts] = await Promise.all([
      fetchWatchDataForListings(listingIds, tradingUrl, userToken),
      fetchAllAnalytics(apiBase, ebayHeaders),
      fetchOrderCounts(apiBase, ebayHeaders),
    ]);

    console.log(
      `ebay-listings: Analytics merge - a7 ${Object.keys(a7).length} items, a30 ${Object.keys(a30).length} items, a90 ${
        Object.keys(a90).length
      } items`,
    );
    console.log(
      `ebay-listings: Real order counts - 7d=${orderCounts.orders7d}, 30d=${orderCounts.orders30d}, 90d=${orderCounts.orders90d}`,
    );

    // Direct eBay listing URL (no affiliate wrapping)
    const buildEbayUrl = (listingId: string | null) => {
      if (!listingId) return null;
      return `https://www.ebay.com/itm/${listingId}`;
    };

    const enrichedListings = listings.map((l: any) => {
      const w = l.listingId ? (watchMap[l.listingId] || null) : null;
      return {
        ...l,
        ...mergeAnalytics(l.listingId, l.sku, a7, a30, a90),
        watchCount: w?.watchCount ?? 0,
        questionCount: w?.questionCount ?? 0,
        ebayUrl: buildEbayUrl(l.listingId),
      };
    });

    return new Response(
      JSON.stringify({
        listings: enrichedListings,
        needsAuth: false,
        orderCount7d: orderCounts.orders7d,
        orderCount30d: orderCounts.orders30d,
        orderCount90d: orderCounts.orders90d,
        financial: orderCounts.financial,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-listings error:", errorMsg);
    const isProduction = Deno.env.get("ENVIRONMENT") === "production";
    return new Response(
      JSON.stringify({
        listings: [],
        error: `Server error: ${errorMsg}`,
        debug: !isProduction ? String(e) : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
