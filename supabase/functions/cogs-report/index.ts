import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userToken, startDate, endDate } = await req.json();

    if (!userToken) {
      return new Response(JSON.stringify({ error: "userToken required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialise Supabase with service role key so we can read listing_cogs
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase     = createClient(supabaseUrl, serviceKey);

    // Resolve the user from the JWT in the Authorization header
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt    = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(userJwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Date range ──────────────────────────────────────────────────────────
    const now      = new Date();
    const fromDate = startDate ? new Date(startDate) : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const toDate   = endDate   ? new Date(endDate)   : now;

    const fromStr = fromDate.toISOString();
    const toStr   = toDate.toISOString();

    // ── Fetch sold orders from eBay Fulfillment API ──────────────────────────
    const apiBase      = "https://api.ebay.com";
    const ebayHeaders  = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    };

    const ordersUrl = new URL(`${apiBase}/sell/fulfillment/v1/order`);
    ordersUrl.searchParams.set("filter", `lastModifiedDate:[${fromStr}..${toStr}]`);
    ordersUrl.searchParams.set("limit", "200");
    ordersUrl.searchParams.set("ordersFulfillmentStatus", "FULFILLED");

    const ordersResp = await fetch(ordersUrl.toString(), { headers: ebayHeaders });
    if (!ordersResp.ok) {
      const errText = await ordersResp.text();
      console.error("Fulfillment API error:", ordersResp.status, errText);
      return new Response(JSON.stringify({ error: "eBay Fulfillment API error", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let ordersData: any;
    try {
      const respText = await ordersResp.text();
      ordersData = JSON.parse(respText);
    } catch (e) {
      console.error("Fulfillment API parse error:", e);
      return new Response(JSON.stringify({ error: "eBay Fulfillment API parse error", detail: String(e) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rawOrders: any[] = ordersData.orders ?? [];

    // ── Collect all SKUs and listing IDs for the COGS lookup ────────────────
    const skuSet       = new Set<string>();
    const listingIdSet = new Set<string>();

    interface FlatOrder {
      orderId: string;
      title: string;
      ebayListingId: string | null;
      ebaySku: string | null;
      salePrice: number;
      shippingCollected: number;
      ebayFees: number;
      soldAt: string;
    }

    const flatOrders: FlatOrder[] = [];

    for (const order of rawOrders) {
      const soldAt = order.creationDate ?? order.lastModifiedDate ?? toStr;

      for (const line of order.lineItems ?? []) {
        const sku       = line.sku ?? null;
        const listingId = line.legacyItemId ?? null;
        const title     = line.title ?? "";
        const quantity  = Number(line.quantity ?? 1);

        const lineTotal   = Number(line.lineItemCost?.value ?? 0) * quantity;
        const shipping    = Number(line.deliveryCost?.shippingCost?.value ?? 0);
        const feeAmt      = (line.marketplaceFees ?? []).reduce(
          (sum: number, f: any) => sum + Number(f.amount?.value ?? 0), 0
        );

        if (sku)       skuSet.add(sku);
        if (listingId) listingIdSet.add(listingId);

        flatOrders.push({
          orderId: order.orderId,
          title,
          ebayListingId: listingId,
          ebaySku: sku,
          salePrice: parseFloat(lineTotal.toFixed(2)),
          shippingCollected: parseFloat(shipping.toFixed(2)),
          ebayFees: parseFloat(feeAmt.toFixed(2)),
          soldAt,
        });
      }
    }

    // ── Fetch COGS records from Supabase ────────────────────────────────────
    // Use separate maps for listing ID and SKU so we can match by either
    const cogsByListingId: Record<string, number> = {};
    const cogsBySku:       Record<string, number> = {};

    if (skuSet.size > 0 || listingIdSet.size > 0) {
      const skus       = Array.from(skuSet);
      const listingIds = Array.from(listingIdSet);

      const orParts: string[] = [];
      if (skus.length > 0)       orParts.push(`ebay_sku.in.(${skus.join(",")})`);
      if (listingIds.length > 0) orParts.push(`ebay_listing_id.in.(${listingIds.join(",")})`);

      const { data: cogsRows, error: cogsErr } = await supabase
        .from("listing_cogs")
        .select("ebay_sku, ebay_listing_id, cogs")
        .eq("user_id", user.id)
        .or(orParts.join(","));

      if (cogsErr) {
        console.warn("listing_cogs fetch error (non-fatal):", cogsErr.message);
      }

      for (const row of cogsRows ?? []) {
        const cogsVal = Number(row.cogs);
        if (row.ebay_listing_id) cogsByListingId[row.ebay_listing_id] = cogsVal;
        if (row.ebay_sku)        cogsBySku[row.ebay_sku]              = cogsVal;
      }

      console.log(`COGS lookup: ${Object.keys(cogsByListingId).length} by listing ID, ${Object.keys(cogsBySku).length} by SKU`);
    }

    // ── Build per-item result rows ──────────────────────────────────────────
    interface ResultItem {
      orderId: string;
      title: string;
      ebayListingId: string | null;
      ebaySku: string | null;
      salePrice: number;
      shippingCollected: number;
      ebayFees: number;
      cogs: number | null;
      netProfit: number;
      margin: number | null;
      soldAt: string;
    }

    let totalRevenue   = 0;
    let totalCogs      = 0;
    let totalFees      = 0;
    let totalShipping  = 0;
    let itemsWithCogs  = 0;
    let itemsWithout   = 0;

    const items: ResultItem[] = flatOrders.map((fo) => {
      // Match COGS: prefer listing ID match, fall back to SKU match
      const cogs =
        (fo.ebayListingId ? cogsByListingId[fo.ebayListingId] ?? null : null) ??
        (fo.ebaySku       ? cogsBySku[fo.ebaySku]             ?? null : null);

      const netProfit = fo.salePrice + fo.shippingCollected - fo.ebayFees - (cogs ?? 0);
      const margin    = cogs != null && fo.salePrice > 0
        ? (netProfit / fo.salePrice) * 100
        : null;

      totalRevenue  += fo.salePrice;
      totalFees     += fo.ebayFees;
      totalShipping += fo.shippingCollected;
      if (cogs != null) { totalCogs += cogs; itemsWithCogs++; }
      else              { itemsWithout++; }

      return {
        orderId:          fo.orderId,
        title:            fo.title,
        ebayListingId:    fo.ebayListingId,
        ebaySku:          fo.ebaySku,
        salePrice:        fo.salePrice,
        shippingCollected: fo.shippingCollected,
        ebayFees:         fo.ebayFees,
        cogs,
        netProfit:        parseFloat(netProfit.toFixed(2)),
        margin:           margin != null ? parseFloat(margin.toFixed(1)) : null,
        soldAt:           fo.soldAt,
      };
    });

    // Sort by soldAt descending (newest first)
    items.sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());

    const overallNet   = totalRevenue + totalShipping - totalFees - totalCogs;
    const avgMargin    = itemsWithCogs > 0 && totalRevenue > 0
      ? parseFloat(((overallNet / totalRevenue) * 100).toFixed(1))
      : null;

    return new Response(
      JSON.stringify({
        items,
        summary: {
          totalRevenue:    parseFloat(totalRevenue.toFixed(2)),
          totalCogs:       parseFloat(totalCogs.toFixed(2)),
          totalFees:       parseFloat(totalFees.toFixed(2)),
          totalShipping:   parseFloat(totalShipping.toFixed(2)),
          netProfit:       parseFloat(overallNet.toFixed(2)),
          avgMargin,
          itemsWithCogs,
          itemsWithoutCogs: itemsWithout,
        },
        dateRange: { from: fromStr, to: toStr },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("cogs-report error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});