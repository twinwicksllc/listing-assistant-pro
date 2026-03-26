with open("supabase/functions/ebay-listings/index.ts", "r") as f:
    content = f.read()

# ─── Old fetchOrderCounts body to replace ───────────────────────────────────
old = """async function fetchOrderCounts(
  apiBase: string,
  ebayHeaders: Record<string, string>
): Promise<{ orders7d: number; orders30d: number; orders90d: number; financial: FinancialSummary }> {
  const counts = { orders7d: 0, orders30d: 0, orders90d: 0 };
  const financial: FinancialSummary = { w7: emptyWindow(), w30: emptyWindow(), w90: emptyWindow() };

  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fromStr = ninetyDaysAgo.toISOString();

    const filter = `creationdate:[${fromStr}..]`;
    const url = new URL(`${apiBase}/sell/fulfillment/v1/order`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", "200");

    console.log(`Fulfillment API: Fetching orders from ${fromStr}`);
    const resp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`Fulfillment API error: ${resp.status} - ${errText.substring(0, 300)}`);
      return { ...counts, financial };
    }

    const data = await resp.json();
    const orders: any[] = data.orders || [];
    console.log(`Fulfillment API: Got ${orders.length} orders (total: ${data.total ?? "?"})`);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const order of orders) {
      // Skip cancelled orders
      if (order.cancelStatus?.cancelState === "CANCELED") continue;
      // Only count paid orders
      if (order.orderPaymentStatus && order.orderPaymentStatus !== "PAID") continue;

      const lineItemCount = (order.lineItems?.length ?? 1);
      const createdAt = order.creationDate ? new Date(order.creationDate) : null;
      if (!createdAt) continue;

      // \u2500\u2500 Financial extraction \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const ps = order.pricingSummary ?? {};
      const revenue = amt(ps.priceSubtotal);
      const shippingCollected = Math.max(0, amt(ps.deliveryCost) - amt(ps.deliveryDiscount));
      const ebayFees = amt(order.totalMarketplaceFee);

      // eBay shipping label costs - summed across line items
      let shippingLabels = 0;
      for (const li of order.lineItems ?? []) {
        shippingLabels += amt(li.ebayCollectedCharges?.ebayShipping);
      }

      const netProfit = revenue + shippingCollected - ebayFees - shippingLabels;

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

    if (data.total && data.total > orders.length) {
      console.log(`Fulfillment API: ${data.total - orders.length} more orders not fetched (pagination needed)`);
    }

    console.log(`Fulfillment API: orders7d=${counts.orders7d}, orders30d=${counts.orders30d}, orders90d=${counts.orders90d}`);
    console.log(`Fulfillment API (30d): revenue=$${financial.w30.revenue.toFixed(2)}, fees=$${financial.w30.ebayFees.toFixed(2)}, labels=$${financial.w30.shippingLabels.toFixed(2)}, net=$${financial.w30.netProfit.toFixed(2)}`);
  } catch (e) {
    console.error("Fulfillment API error (non-fatal):", e);
  }

  return { ...counts, financial };
}"""

new = """async function fetchOrderCounts(
  apiBase: string,
  ebayHeaders: Record<string, string>
): Promise<{ orders7d: number; orders30d: number; orders90d: number; financial: FinancialSummary }> {
  const counts = { orders7d: 0, orders30d: 0, orders90d: 0 };
  const financial: FinancialSummary = { w7: emptyWindow(), w30: emptyWindow(), w90: emptyWindow() };

  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fromStr = ninetyDaysAgo.toISOString();

    // Fetch Fulfillment orders + real shipping label costs (from Finances API) in parallel
    const [labelCosts] = await Promise.all([
      fetchShippingLabelCosts(apiBase, ebayHeaders, ninetyDaysAgo),
    ]);

    const filter = `creationdate:[${fromStr}..]`;
    const url = new URL(`${apiBase}/sell/fulfillment/v1/order`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("limit", "200");

    console.log(`Fulfillment API: Fetching orders from ${fromStr}`);
    const resp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`Fulfillment API error: ${resp.status} - ${errText.substring(0, 300)}`);
      return { ...counts, financial };
    }

    const data = await resp.json();
    const orders: any[] = data.orders || [];
    console.log(`Fulfillment API: Got ${orders.length} orders (total: ${data.total ?? "?"})`);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const order of orders) {
      // Skip cancelled orders
      if (order.cancelStatus?.cancelState === "CANCELED") continue;
      // Only count paid orders
      if (order.orderPaymentStatus && order.orderPaymentStatus !== "PAID") continue;

      const lineItemCount = (order.lineItems?.length ?? 1);
      const createdAt = order.creationDate ? new Date(order.creationDate) : null;
      if (!createdAt) continue;

      // \u2500\u2500 Financial extraction \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const ps = order.pricingSummary ?? {};
      const revenue = amt(ps.priceSubtotal);
      // shippingCollected is tracked for display but excluded from net profit:
      // it's a pass-through — buyer pays it, seller pays it to carrier via label.
      const shippingCollected = Math.max(0, amt(ps.deliveryCost) - amt(ps.deliveryDiscount));
      const ebayFees = amt(order.totalMarketplaceFee);
      // shippingLabels per-order is now $0 here; real costs come from Finances API below
      const shippingLabels = 0;

      // Net profit = item revenue only - eBay fees (shipping is a wash)
      // Real label costs are applied at the window level from Finances API data
      const netProfit = revenue - ebayFees;

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

    // Apply real shipping label costs from Finances API and subtract from net profit
    financial.w7.shippingLabels  = labelCosts.labels7d;
    financial.w30.shippingLabels = labelCosts.labels30d;
    financial.w90.shippingLabels = labelCosts.labels90d;
    financial.w7.netProfit  -= labelCosts.labels7d;
    financial.w30.netProfit -= labelCosts.labels30d;
    financial.w90.netProfit -= labelCosts.labels90d;

    if (data.total && data.total > orders.length) {
      console.log(`Fulfillment API: ${data.total - orders.length} more orders not fetched (pagination needed)`);
    }

    console.log(`Fulfillment API: orders7d=${counts.orders7d}, orders30d=${counts.orders30d}, orders90d=${counts.orders90d}`);
    console.log(`Fulfillment API (30d): revenue=$${financial.w30.revenue.toFixed(2)}, fees=$${financial.w30.ebayFees.toFixed(2)}, labels=$${financial.w30.shippingLabels.toFixed(2)}, net=$${financial.w30.netProfit.toFixed(2)}`);
  } catch (e) {
    console.error("Fulfillment API error (non-fatal):", e);
  }

  return { ...counts, financial };
}"""

if old in content:
    content = content.replace(old, new, 1)
    print("Replacement successful!")
else:
    print("ERROR: old string not found in file!")
    # Debug: find the function
    idx = content.find("async function fetchOrderCounts(")
    if idx >= 0:
        print(f"Function found at index {idx}")
        print(repr(content[idx:idx+200]))
    exit(1)

with open("supabase/functions/ebay-listings/index.ts", "w") as f:
    f.write(content)

print("Done!")