import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch shipping label costs from eBay Finances API
// Returns a map of orderId -> total label cost for that order
// ─────────────────────────────────────────────────────────────────────────────
async function fetchShippingLabelCosts(
  userToken: string,
  fromStr: string,
  toStr: string,
  marketplaceId: string = "EBAY_US",
): Promise<Map<string, number>> {
  const labelCosts = new Map<string, number>();

  try {
    // The Finances API uses a different base URL (apiz.ebay.com)
    const financesApiBase = "https://apiz.ebay.com";
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    };

    // Filter for SHIPPING_LABEL transactions within the date range
    // Note: transactionDate filter uses the same format as fulfillment API
    const filterValue = `transactionType:{SHIPPING_LABEL},transactionDate:[${fromStr}..${toStr}]`;
    const transactionsUrl = `${financesApiBase}/sell/finances/v1/transaction?filter=${
      encodeURIComponent(
        filterValue,
      )
    }&limit=200`;

    console.log(
      "Fetching shipping label transactions from Finances API:",
      transactionsUrl,
    );

    const resp = await fetch(transactionsUrl, { headers: ebayHeaders });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(
        "Finances API error (non-fatal, will use proxy):",
        resp.status,
        errText,
      );
      return labelCosts; // Return empty map, will fall back to proxy
    }

    const respText = await resp.text();
    const data = JSON.parse(respText);
    const transactions = data.transactions ?? [];

    console.log(`Found ${transactions.length} SHIPPING_LABEL transactions`);

    // Aggregate label costs by orderId
    for (const tx of transactions) {
      const orderId = tx.orderId;
      const amount = parseFloat(tx.amount?.value ?? 0);
      const bookingEntry = tx.bookingEntry; // DEBIT for purchases, CREDIT for refunds

      if (orderId) {
        const currentCost = labelCosts.get(orderId) ?? 0;
        // DEBIT increases cost (label purchase), CREDIT decreases (refund/adjustment)
        if (bookingEntry === "DEBIT") {
          labelCosts.set(orderId, currentCost + amount);
        } else if (bookingEntry === "CREDIT") {
          labelCosts.set(orderId, currentCost - amount);
        }
      }
    }

    console.log(`Aggregated label costs for ${labelCosts.size} orders`);
  } catch (err) {
    console.warn("Error fetching shipping label costs (non-fatal):", err);
  }

  return labelCosts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch eBay marketplace fees from Finances API
// Returns a map of orderId -> total fees for that order
// Covers: FINAL_VALUE_FEE, FINAL_VALUE_FEE_FIXED_PER_ORDER, AD_FEE, etc.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchEbayFees(
  userToken: string,
  fromStr: string,
  toStr: string,
  marketplaceId: string = "EBAY_US",
): Promise<Map<string, number>> {
  const feesMap = new Map<string, number>();

  try {
    const financesApiBase = "https://apiz.ebay.com";
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    };

    // Fetch all fee-type transactions in the date range.
    // eBay fee transaction types that reduce seller payout:
    //   FINAL_VALUE_FEE, FINAL_VALUE_FEE_FIXED_PER_ORDER, AD_FEE,
    //   LISTING_FEE, REGULATORY_FEE, DISPUTE_FEE, etc.
    // We fetch ALL transaction types and filter to DEBIT entries,
    // then exclude SHIPPING_LABEL (handled separately) and SALE/REFUND types.
    const filterValue = `transactionDate:[${fromStr}..${toStr}]`;
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      const transactionsUrl = `${financesApiBase}/sell/finances/v1/transaction?filter=${
        encodeURIComponent(
          filterValue,
        )
      }&limit=${limit}&offset=${offset}`;

      console.log(
        `Fetching Finances API transactions (offset=${offset}):`,
        transactionsUrl,
      );

      const resp = await fetch(transactionsUrl, { headers: ebayHeaders });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(
          "Finances API fees fetch error (non-fatal):",
          resp.status,
          errText,
        );
        break;
      }

      const data = JSON.parse(await resp.text());
      const transactions = data.transactions ?? [];
      const total = data.total ?? 0;

      for (const tx of transactions) {
        const orderId = tx.orderId;
        if (!orderId) continue;

        const txType: string = tx.transactionType ?? "";
        const bookingEntry: string = tx.bookingEntry ?? "";
        const amount = parseFloat(tx.amount?.value ?? "0");

        // Skip non-fee transaction types
        const skipTypes = new Set([
          "SALE",
          "REFUND",
          "SHIPPING_LABEL",
          "CREDIT",
          "NON_SALE_CHARGE",
        ]);
        if (skipTypes.has(txType)) continue;

        // Only count DEBITs (charges to seller), not CREDITs (adjustments/refunds of fees)
        if (bookingEntry === "DEBIT") {
          feesMap.set(orderId, (feesMap.get(orderId) ?? 0) + amount);
        } else if (bookingEntry === "CREDIT") {
          // Fee refunds/adjustments reduce the fee
          feesMap.set(orderId, (feesMap.get(orderId) ?? 0) - amount);
        }
      }

      offset += transactions.length;
      hasMore = offset < total && transactions.length > 0;
    }

    console.log(
      `Aggregated eBay fees for ${feesMap.size} orders from Finances API`,
    );
  } catch (err) {
    console.warn("Error fetching eBay fees (non-fatal):", err);
  }

  return feesMap;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { userToken, startDate, endDate } = await req.json();

    if (!userToken) {
      return new Response(JSON.stringify({ error: "userToken required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialise Supabase with service role key so we can read listing_cogs
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve the user from the JWT in the Authorization header
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(userJwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Date range ───────────────────────────────────────────────────────────
    const now = new Date();
    const fromDate = startDate ? new Date(startDate) : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const toDate = endDate ? new Date(endDate) : now;

    // eBay expects ISO 8601 dates without milliseconds for the filter
    // Format: 2024-01-01T00:00:00Z
    const fromStr = fromDate.toISOString().replace(/\.\d{3}Z$/, "Z");
    const toStr = toDate.toISOString().replace(/\.\d{3}Z$/, "Z");

    // ── Fetch sold orders from eBay Fulfillment API ──────────────────────────
    // IMPORTANT: Build URL manually to avoid URLSearchParams encoding the
    // square brackets and dots in eBay filter syntax.
    // eBay filter format: creationdate:[2024-01-01T00:00:00Z..2024-03-31T23:59:59Z]
    const apiBase = "https://api.ebay.com";
    const ebayHeaders = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    };

    // Build filter string: date range only (fulfilled orders are the default
    // for creationdate queries; adding orderfulfillmentstatus causes 400 errors
    // on some accounts). We filter by creationdate which is more reliable.
    const filterValue = `creationdate:[${fromStr}..${toStr}]`;

    // Manually construct the URL to prevent double-encoding of filter brackets
    const ordersUrlStr = `${apiBase}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filterValue)}&limit=200`;

    console.log("Fetching eBay orders:", ordersUrlStr);

    const ordersResp = await fetch(ordersUrlStr, {
      headers: ebayHeaders,
    });

    if (!ordersResp.ok) {
      const errText = await ordersResp.text();
      console.error("Fulfillment API error:", ordersResp.status, errText);

      // If we get a 400/404 with creationdate, try lastmodifieddate as fallback
      if (ordersResp.status === 400 || ordersResp.status === 404) {
        const filterValue2 = `lastmodifieddate:[${fromStr}..${toStr}]`;
        const ordersUrlStr2 = `${apiBase}/sell/fulfillment/v1/order?filter=${
          encodeURIComponent(
            filterValue2,
          )
        }&limit=200`;
        console.log("Retrying with lastmodifieddate:", ordersUrlStr2);

        const ordersResp2 = await fetch(ordersUrlStr2, {
          headers: ebayHeaders,
        });
        if (!ordersResp2.ok) {
          const errText2 = await ordersResp2.text();
          console.error(
            "Fulfillment API fallback error:",
            ordersResp2.status,
            errText2,
          );
          return new Response(
            JSON.stringify({
              error: "eBay Fulfillment API error",
              detail: errText2,
              originalError: errText,
            }),
            {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Use the fallback response
        let ordersData2: any;
        try {
          const respText2 = await ordersResp2.text();
          ordersData2 = JSON.parse(respText2);
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: "eBay Fulfillment API parse error",
              detail: String(e),
            }),
            {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        return processOrders(
          ordersData2,
          fromStr,
          toStr,
          user.id,
          supabase,
          corsHeaders,
          userToken,
        );
      }

      return new Response(
        JSON.stringify({
          error: "eBay Fulfillment API error",
          detail: errText,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let ordersData: any;
    try {
      const respText = await ordersResp.text();
      ordersData = JSON.parse(respText);
    } catch (e) {
      console.error("Fulfillment API parse error:", e);
      return new Response(
        JSON.stringify({
          error: "eBay Fulfillment API parse error",
          detail: String(e),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return processOrders(
      ordersData,
      fromStr,
      toStr,
      user.id,
      supabase,
      corsHeaders,
      userToken,
    );
  } catch (err: any) {
    console.error("cogs-report error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helper: process orders and return response ───────────────────────────────
async function processOrders(
  ordersData: any,
  fromStr: string,
  toStr: string,
  userId: string,
  supabase: any,
  corsHeaders: Record<string, string>,
  userToken: string,
): Promise<Response> {
  const rawOrders: any[] = ordersData.orders ?? [];

  // Use the marketplace from the first order if possible, fallback to EBAY_US
  const marketplaceId = rawOrders.length > 0 ? (rawOrders[0].marketplaceId ?? "EBAY_US") : "EBAY_US";

  // Broaden the finances search range to catch fees that settled before or after the
  // order creation/modification window. We go 15 days back from fromStr.
  const fromDateMatch = fromStr.match(/^(\d{4}-\d{2}-\d{2})/);
  const fromDateBase = fromDateMatch ? new Date(fromDateMatch[1]) : new Date();
  const broaderFromDate = new Date(
    fromDateBase.getTime() - 15 * 24 * 60 * 60 * 1000,
  );
  const broaderFromStr = broaderFromDate
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  // ── Fetch shipping label costs from eBay Finances API ─────────────────────────────
  // This gives us the actual cost the seller paid for labels purchased through eBay
  // Run both Finances API fetches in parallel for performance
  const [labelCosts, financeFees] = await Promise.all([
    fetchShippingLabelCosts(userToken, broaderFromStr, toStr, marketplaceId),
    fetchEbayFees(userToken, broaderFromStr, toStr, marketplaceId),
  ]);

  // ── Collect all SKUs and listing IDs for the COGS lookup ─────────────────
  const skuSet = new Set<string>();
  const listingIdSet = new Set<string>();

  interface FlatOrder {
    orderId: string;
    title: string;
    ebayListingId: string | null;
    ebaySku: string | null;
    quantity: number;
    salePrice: number;
    shippingCollected: number;
    // shippingLabelCost: actual cost the seller paid for the outbound label.
    // Fetched from eBay Finances API (SHIPPING_LABEL transactions).
    // Falls back to shippingCollected as proxy if Finances API unavailable.
    shippingLabelCost: number;
    ebayFees: number;
    soldAt: string;
  }

  const flatOrders: FlatOrder[] = [];

  for (const order of rawOrders) {
    const soldAt = order.creationDate ?? order.lastModifiedDate ?? toStr;

    // First pass: calculate total order revenue for fee apportionment
    let orderTotalValue = 0;
    for (const line of order.lineItems ?? []) {
      const q = Number(line.quantity ?? 1);
      orderTotalValue += Number(line.lineItemCost?.value ?? 0) * q;
    }

    for (const line of order.lineItems ?? []) {
      const sku = line.sku ?? null;
      const listingId = line.legacyItemId ?? null;
      const title = line.title ?? "";
      const quantity = Number(line.quantity ?? 1);

      const lineTotal = Number(line.lineItemCost?.value ?? 0) * quantity;
      const shipping = Number(line.deliveryCost?.shippingCost?.value ?? 0);
      // eBay Fulfillment API rarely populates marketplaceFees on line items.
      // We use the Finances API (FINAL_VALUE_FEE etc.) as the authoritative
      // source. marketplaceFees is kept as a fallback for orders not yet
      // settled in the Finances API.
      const fallbackFeeAmt = (line.marketplaceFees ?? []).reduce(
        (sum: number, f: any) => sum + Number(f.amount?.value ?? 0),
        0,
      );
      // Finances API fees are per-order (not per line item), so for multi-line
      // orders we apportion fees proportionally by line item sale value.
      // For single-line orders (the common case) this is just the full fee.
      const financesFeeForOrder = financeFees.get(order.orderId) ?? null;

      let feeAmt = 0;
      if (financesFeeForOrder !== null) {
        // Apportion fee based on this line's share of total order value
        feeAmt = orderTotalValue > 0
          ? (lineTotal / orderTotalValue) * financesFeeForOrder
          : financesFeeForOrder / (order.lineItems?.length || 1);
      } else {
        feeAmt = fallbackFeeAmt;
      }

      if (sku) skuSet.add(sku);
      if (listingId) listingIdSet.add(listingId);

      // Look up actual shipping label cost from Finances API
      // Fall back to shippingCollected as proxy if no label cost found
      const actualLabelCost = labelCosts.get(order.orderId) ?? null;
      const labelCost = actualLabelCost !== null ? actualLabelCost : shipping;

      flatOrders.push({
        orderId: order.orderId,
        title,
        ebayListingId: listingId,
        ebaySku: sku,
        quantity,
        salePrice: parseFloat(lineTotal.toFixed(2)),
        shippingCollected: parseFloat(shipping.toFixed(2)),
        // Use actual label cost from Finances API if available, otherwise proxy
        shippingLabelCost: parseFloat(labelCost.toFixed(2)),
        ebayFees: parseFloat(feeAmt.toFixed(2)),
        soldAt,
      });
    }
  }

  // ── Fetch COGS records from Supabase ──────────────────────────────────────
  // Use separate maps for listing ID and SKU so matching is unambiguous
  const cogsByListingId: Record<string, number> = {};
  const cogsBySku: Record<string, number> = {};

  if (skuSet.size > 0 || listingIdSet.size > 0) {
    const skus = Array.from(skuSet);
    const listingIds = Array.from(listingIdSet);

    const orParts: string[] = [];
    if (skus.length > 0) orParts.push(`ebay_sku.in.(${skus.join(",")})`);
    if (listingIds.length > 0) {
      orParts.push(`ebay_listing_id.in.(${listingIds.join(",")})`);
    }

    const { data: cogsRows, error: cogsErr } = await supabase
      .from("listing_cogs")
      .select("ebay_sku, ebay_listing_id, cogs")
      .eq("user_id", userId)
      .or(orParts.join(","));

    if (cogsErr) {
      console.warn("listing_cogs fetch error (non-fatal):", cogsErr.message);
    }

    for (const row of cogsRows ?? []) {
      const cogsVal = Number(row.cogs);
      if (row.ebay_listing_id) cogsByListingId[row.ebay_listing_id] = cogsVal;
      if (row.ebay_sku) cogsBySku[row.ebay_sku] = cogsVal;
    }

    console.log(
      `COGS lookup: ${Object.keys(cogsByListingId).length} by listing ID, ${Object.keys(cogsBySku).length} by SKU`,
    );
  }

  // ── Build per-item result rows ─────────────────────────────────────────────
  interface ResultItem {
    orderId: string;
    title: string;
    ebayListingId: string | null;
    ebaySku: string | null;
    quantity: number;
    salePrice: number;
    shippingCollected: number;
    shippingLabelCost: number;
    ebayFees: number;
    unitCogs: number | null;
    cogs: number | null;
    netProfit: number;
    margin: number | null;
    soldAt: string;
  }

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalFees = 0;
  let totalShippingCollected = 0;
  let totalShippingLabels = 0;
  let itemsWithCogs = 0;
  let itemsWithout = 0;

  const items: ResultItem[] = flatOrders.map((fo) => {
    // unitCogs: the cost of a single unit (as stored in listing_cogs)
    // Prefer listing ID over SKU — it's the most stable eBay identifier.
    // Match by listing ID first (most precise), then fall back to SKU
    const unitCogs = (fo.ebayListingId ? (cogsByListingId[fo.ebayListingId] ?? null) : null) ??
      (fo.ebaySku ? (cogsBySku[fo.ebaySku] ?? null) : null) ??
      null;

    // totalLineCogs: multiply per-unit COGS by quantity sold
    const totalLineCogs = unitCogs != null ? unitCogs * fo.quantity : null;

    // Net profit:
    //   salePrice + shippingCollected - shippingLabelCost - ebayFees - (unitCogs x quantity)
    // salePrice already reflects lineItemCost x quantity (set in the lineItems loop above).
    // shippingLabelCost is fetched from Finances API for accurate P&L.
    const netProfit = fo.salePrice +
      fo.shippingCollected -
      fo.shippingLabelCost -
      fo.ebayFees -
      (totalLineCogs ?? 0);
    const margin = totalLineCogs != null && fo.salePrice > 0 ? (netProfit / fo.salePrice) * 100 : null;

    totalRevenue += fo.salePrice;
    totalFees += fo.ebayFees;
    totalShippingCollected += fo.shippingCollected;
    totalShippingLabels += fo.shippingLabelCost;
    if (totalLineCogs != null) {
      totalCogs += totalLineCogs;
      itemsWithCogs++;
    } else {
      itemsWithout++;
    }

    return {
      orderId: fo.orderId,
      title: fo.title,
      ebayListingId: fo.ebayListingId,
      ebaySku: fo.ebaySku,
      quantity: fo.quantity,
      salePrice: fo.salePrice,
      shippingCollected: fo.shippingCollected,
      shippingLabelCost: fo.shippingLabelCost,
      ebayFees: fo.ebayFees,
      unitCogs,
      cogs: totalLineCogs,
      netProfit: parseFloat(netProfit.toFixed(2)),
      margin: margin != null ? parseFloat(margin.toFixed(1)) : null,
      soldAt: fo.soldAt,
    };
  });

  // Sort by soldAt descending (newest first)
  items.sort(
    (a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime(),
  );

  // shippingNet = collected - labels (actual label costs from Finances API)
  const totalShippingNet = totalShippingCollected - totalShippingLabels;
  const overallNet = totalRevenue + totalShippingNet - totalFees - totalCogs;
  const avgMargin = itemsWithCogs > 0 && totalRevenue > 0
    ? parseFloat(((overallNet / totalRevenue) * 100).toFixed(1))
    : null;

  // ── Phase 1 dual-write: upsert into listing_financials ────────────────────
  // This is fire-and-forget: errors are logged but never affect the response.
  // The upsert is idempotent — re-running the report for the same date range
  // simply refreshes the stored financials with the latest COGS values.
  await dualWriteFinancials(items, userId, supabase);

  return new Response(
    JSON.stringify({
      items,
      summary: {
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCogs: parseFloat(totalCogs.toFixed(2)),
        totalFees: parseFloat(totalFees.toFixed(2)),
        totalShippingCollected: parseFloat(totalShippingCollected.toFixed(2)),
        totalShippingLabels: parseFloat(totalShippingLabels.toFixed(2)),
        totalShippingNet: parseFloat(totalShippingNet.toFixed(2)),
        netProfit: parseFloat(overallNet.toFixed(2)),
        avgMargin,
        itemsWithCogs,
        itemsWithoutCogs: itemsWithout,
      },
      dateRange: { from: fromStr, to: toStr },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Phase 1: Dual-write helper ────────────────────────────────────────────────
// Upserts each result item into listing_financials.
// Called after the response payload is assembled so the existing report logic
// is completely unchanged.  Any failure here is non-fatal.
//
// Conflict resolution:
//   - When ebay_listing_id IS NOT NULL → conflict on (user_id, order_id, ebay_listing_id)
//     matching uidx_lf_order_listing
//   - When ebay_listing_id IS NULL     → conflict on (user_id, order_id, ebay_sku)
//     matching uidx_lf_order_sku
// We issue two batched upserts (one per index) to keep it simple and correct.
async function dualWriteFinancials(
  items: Array<{
    orderId: string;
    title: string;
    ebayListingId: string | null;
    ebaySku: string | null;
    quantity: number;
    salePrice: number;
    shippingCollected: number;
    shippingLabelCost: number;
    ebayFees: number;
    unitCogs: number | null;
    cogs: number | null;
    netProfit: number;
    soldAt: string;
  }>,
  userId: string,
  supabase: any,
): Promise<void> {
  if (items.length === 0) return;

  // --- Phase 4: Resolve domain + published_at from drafts ---
  // Look up the matching drafts row (by ebay_sku / ebay_listing_id) to get
  // the item's domain (set by Pass-1 AI at analysis time) and published_at
  // (set when the draft was published). This powers the domain_quality_metrics
  // view / domain-quality-report edge function. Non-fatal on any error - a
  // missing draft (e.g. listing created outside the app, or before domain
  // tracking existed) simply leaves domain/time_to_sale_days as NULL.
  const domainByListingId: Record<string, string> = {};
  const domainBySku: Record<string, string> = {};
  const publishedAtByListingId: Record<string, string> = {};
  const publishedAtBySku: Record<string, string> = {};

  try {
    const listingIds = Array.from(
      new Set(
        items.map((it) => it.ebayListingId).filter((v): v is string => !!v),
      ),
    );
    const skus = Array.from(
      new Set(items.map((it) => it.ebaySku).filter((v): v is string => !!v)),
    );

    if (listingIds.length > 0 || skus.length > 0) {
      const orParts: string[] = [];
      if (skus.length > 0) orParts.push(`ebay_sku.in.(${skus.join(",")})`);
      if (listingIds.length > 0) {
        orParts.push(`ebay_listing_id.in.(${listingIds.join(",")})`);
      }

      const { data: draftRows, error: draftErr } = await supabase
        .from("drafts")
        .select("ebay_sku, ebay_listing_id, domain, published_at")
        .eq("user_id", userId)
        .or(orParts.join(","));

      if (draftErr) {
        console.warn(
          "drafts lookup for domain/published_at (non-fatal):",
          draftErr.message,
        );
      } else {
        for (const row of draftRows ?? []) {
          if (row.domain) {
            if (row.ebay_listing_id) {
              domainByListingId[row.ebay_listing_id] = row.domain;
            }
            if (row.ebay_sku) domainBySku[row.ebay_sku] = row.domain;
          }
          if (row.published_at) {
            if (row.ebay_listing_id) {
              publishedAtByListingId[row.ebay_listing_id] = row.published_at;
            }
            if (row.ebay_sku) publishedAtBySku[row.ebay_sku] = row.published_at;
          }
        }
      }
    }
  } catch (e) {
    console.warn(
      "Domain/published_at resolution failed (non-fatal):",
      (e as Error).message,
    );
  }

  // Separate rows by which unique index they resolve against
  const rowsWithListingId = items.filter((it) => it.ebayListingId != null);
  const rowsSkuOnly = items.filter(
    (it) => it.ebayListingId == null && it.ebaySku != null,
  );

  const toRow = (it: (typeof items)[number]) => {
    const domain = (it.ebayListingId ? domainByListingId[it.ebayListingId] : undefined) ??
      (it.ebaySku ? domainBySku[it.ebaySku] : undefined) ??
      null;
    const publishedAt = (it.ebayListingId ? publishedAtByListingId[it.ebayListingId] : undefined) ??
      (it.ebaySku ? publishedAtBySku[it.ebaySku] : undefined) ??
      null;
    let timeToSaleDays: number | null = null;
    if (publishedAt) {
      const days = (new Date(it.soldAt).getTime() - new Date(publishedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      if (Number.isFinite(days) && days >= 0) {
        timeToSaleDays = parseFloat(days.toFixed(2));
      }
    }

    return {
      user_id: userId,
      order_id: it.orderId,
      ebay_listing_id: it.ebayListingId,
      ebay_sku: it.ebaySku,
      title: it.title,
      quantity: it.quantity,
      sale_price: it.salePrice,
      shipping_buyer_paid: it.shippingCollected,
      ebay_fees: it.ebayFees,
      cogs: it.cogs, // total line COGS (unit_cogs x quantity)
      unit_cogs: it.unitCogs, // per-unit COGS for reference
      shipping_label_cost: it.shippingLabelCost,
      refund: 0, // Phase 2+
      net_profit: it.netProfit,
      sold_at: it.soldAt,
      domain,
      time_to_sale_days: timeToSaleDays,
    };
  };

  // Upsert rows that have a listing ID (most common case)
  if (rowsWithListingId.length > 0) {
    const { error } = await supabase
      .from("listing_financials")
      .upsert(rowsWithListingId.map(toRow), {
        onConflict: "user_id,order_id,ebay_listing_id",
        ignoreDuplicates: false,
      });
    if (error) {
      console.warn(
        "listing_financials upsert (listing_id batch) non-fatal error:",
        error.message,
      );
    } else {
      console.log(
        `listing_financials: upserted ${rowsWithListingId.length} rows (listing_id batch)`,
      );
    }
  }

  // Upsert rows that only have a SKU (no listing ID)
  if (rowsSkuOnly.length > 0) {
    const { error } = await supabase
      .from("listing_financials")
      .upsert(rowsSkuOnly.map(toRow), {
        onConflict: "user_id,order_id,ebay_sku",
        ignoreDuplicates: false,
      });
    if (error) {
      console.warn(
        "listing_financials upsert (sku-only batch) non-fatal error:",
        error.message,
      );
    } else {
      console.log(
        `listing_financials: upserted ${rowsSkuOnly.length} rows (sku-only batch)`,
      );
    }
  }
}
