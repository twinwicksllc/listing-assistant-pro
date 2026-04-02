import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      userJwt,
    );
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
          encodeURIComponent(filterValue2)
        }&limit=200`;
        console.log("Retrying with lastmodifieddate:", ordersUrlStr2);

        const ordersResp2 = await fetch(ordersUrlStr2, { headers: ebayHeaders });
        if (!ordersResp2.ok) {
          const errText2 = await ordersResp2.text();
          console.error("Fulfillment API fallback error:", ordersResp2.status, errText2);
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
            JSON.stringify({ error: "eBay Fulfillment API parse error", detail: String(e) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return processOrders(ordersData2, fromStr, toStr, user.id, supabase, corsHeaders);
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

    return processOrders(ordersData, fromStr, toStr, user.id, supabase, corsHeaders);
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
): Promise<Response> {
  const rawOrders: any[] = ordersData.orders ?? [];

  // ── Collect all SKUs and listing IDs for the COGS lookup ─────────────────
  const skuSet = new Set<string>();
  const listingIdSet = new Set<string>();

  interface FlatOrder {
    orderId: string;
    title: string;
    ebayListingId: string | null;
    ebaySku: string | null;
    salePrice: number;
    shippingCollected: number;
    // shippingLabelCost: what the seller paid for the outbound label.
    // eBay Fulfillment API does not expose label costs directly.
    // We use shippingCollected as the best proxy (they typically wash).
    // When a real label cost is stored in listing_financials it will
    // override this estimate in Phase 2.
    shippingLabelCost: number;
    ebayFees: number;
    soldAt: string;
  }

  const flatOrders: FlatOrder[] = [];

  for (const order of rawOrders) {
    const soldAt = order.creationDate ?? order.lastModifiedDate ?? toStr;

    for (const line of order.lineItems ?? []) {
      const sku = line.sku ?? null;
      const listingId = line.legacyItemId ?? null;
      const title = line.title ?? "";
      const quantity = Number(line.quantity ?? 1);

      const lineTotal = Number(line.lineItemCost?.value ?? 0) * quantity;
      const shipping = Number(line.deliveryCost?.shippingCost?.value ?? 0);
      const feeAmt = (line.marketplaceFees ?? []).reduce(
        (sum: number, f: any) => sum + Number(f.amount?.value ?? 0),
        0,
      );

      if (sku) skuSet.add(sku);
      if (listingId) listingIdSet.add(listingId);

      flatOrders.push({
        orderId: order.orderId,
        title,
        ebayListingId: listingId,
        ebaySku: sku,
        salePrice: parseFloat(lineTotal.toFixed(2)),
        shippingCollected: parseFloat(shipping.toFixed(2)),
        // Default label cost = collected (net-zero assumption until real data available)
        shippingLabelCost: parseFloat(shipping.toFixed(2)),
        ebayFees: parseFloat(feeAmt.toFixed(2)),
        soldAt,
      });
    }
  }

  // ── Fetch COGS records from Supabase ──────────────────────────────────────
  const cogsMap: Record<string, number> = {};

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
      if (row.ebay_sku) cogsMap[row.ebay_sku] = Number(row.cogs);
      if (row.ebay_listing_id) {
        cogsMap[row.ebay_listing_id] = Number(row.cogs);
      }
    }
  }

  // ── Build per-item result rows ─────────────────────────────────────────────
  interface ResultItem {
    orderId: string;
    title: string;
    ebayListingId: string | null;
    ebaySku: string | null;
    salePrice: number;
    shippingCollected: number;
    shippingLabelCost: number;
    ebayFees: number;
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
    const cogs = (fo.ebaySku ? cogsMap[fo.ebaySku] : null) ??
      (fo.ebayListingId ? cogsMap[fo.ebayListingId] : null) ??
      null;

    // Net profit:
    //   salePrice + shippingCollected - shippingLabelCost - ebayFees - cogs
    // shippingCollected - shippingLabelCost nets to ~$0 by default (proxy assumption)
    // and will be overridden by real label costs in Phase 2.
    const netProfit = fo.salePrice + fo.shippingCollected - fo.shippingLabelCost -
      fo.ebayFees - (cogs ?? 0);
    const margin = cogs != null && fo.salePrice > 0 ? (netProfit / fo.salePrice) * 100 : null;

    totalRevenue += fo.salePrice;
    totalFees += fo.ebayFees;
    totalShippingCollected += fo.shippingCollected;
    totalShippingLabels += fo.shippingLabelCost;
    if (cogs != null) {
      totalCogs += cogs;
      itemsWithCogs++;
    } else {
      itemsWithout++;
    }

    return {
      orderId: fo.orderId,
      title: fo.title,
      ebayListingId: fo.ebayListingId,
      ebaySku: fo.ebaySku,
      salePrice: fo.salePrice,
      shippingCollected: fo.shippingCollected,
      shippingLabelCost: fo.shippingLabelCost,
      ebayFees: fo.ebayFees,
      cogs,
      netProfit: parseFloat(netProfit.toFixed(2)),
      margin: margin != null ? parseFloat(margin.toFixed(1)) : null,
      soldAt: fo.soldAt,
    };
  });

  // Sort by soldAt descending (newest first)
  items.sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());

  // shippingNet = collected - labels (nets to ~0 with proxy, real value in Phase 2)
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
    salePrice: number;
    shippingCollected: number;
    shippingLabelCost: number;
    ebayFees: number;
    cogs: number | null;
    netProfit: number;
    soldAt: string;
  }>,
  userId: string,
  supabase: any,
): Promise<void> {
  if (items.length === 0) return;

  // Separate rows by which unique index they resolve against
  const rowsWithListingId = items.filter((it) => it.ebayListingId != null);
  const rowsSkuOnly = items.filter(
    (it) => it.ebayListingId == null && it.ebaySku != null,
  );

  const toRow = (it: (typeof items)[number]) => ({
    user_id: userId,
    order_id: it.orderId,
    ebay_listing_id: it.ebayListingId,
    ebay_sku: it.ebaySku,
    title: it.title,
    sale_price: it.salePrice,
    shipping_buyer_paid: it.shippingCollected,
    ebay_fees: it.ebayFees,
    cogs: it.cogs,
    shipping_label_cost: it.shippingLabelCost,
    refund: 0, // Phase 2+
    net_profit: it.netProfit,
    sold_at: it.soldAt,
  });

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
