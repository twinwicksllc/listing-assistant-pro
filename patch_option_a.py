with open("supabase/functions/ebay-listings/index.ts", "r") as f:
    content = f.read()

# ─── 1. Expand FinancialWindow interface ────────────────────────────────────
old_interface = """interface FinancialWindow {
  orders: number;
  revenue: number;           // item sale prices (excl. tax)
  shippingCollected: number; // delivery cost buyer paid
  ebayFees: number;          // totalMarketplaceFee (FVF + ad fees)
  shippingLabels: number;    // eBay shipping label costs charged to seller
  netProfit: number;         // revenue + shippingCollected - ebayFees - shippingLabels
}"""

new_interface = """interface FinancialWindow {
  orders: number;
  revenue: number;           // item sale prices (excl. tax)
  shippingCollected: number; // delivery cost buyer paid
  ebayFees: number;          // totalMarketplaceFee (FVF + ad fees)
  shippingLabels: number;    // eBay shipping label costs charged to seller
  refunds: number;           // buyer refunds paid out (REFUND transactions)
  nonSaleCharges: number;    // store subscription, listing fees, promoted offsite (NON_SALE_CHARGE)
  disputes: number;          // lost INR/SNAD cases charged to seller (DISPUTE)
  credits: number;           // eBay seller credits e.g. FVF credits (CREDIT)
  netProfit: number;         // revenue + shippingCollected - ebayFees - shippingLabels - refunds - nonSaleCharges - disputes + credits
}"""

if old_interface in content:
    content = content.replace(old_interface, new_interface, 1)
    print("✓ FinancialWindow interface updated")
else:
    print("ERROR: FinancialWindow interface not found")
    exit(1)

# ─── 2. Expand emptyWindow() ────────────────────────────────────────────────
old_empty = "  return { orders: 0, revenue: 0, shippingCollected: 0, ebayFees: 0, shippingLabels: 0, netProfit: 0 };"
new_empty = "  return { orders: 0, revenue: 0, shippingCollected: 0, ebayFees: 0, shippingLabels: 0, refunds: 0, nonSaleCharges: 0, disputes: 0, credits: 0, netProfit: 0 };"

if old_empty in content:
    content = content.replace(old_empty, new_empty, 1)
    print("✓ emptyWindow() updated")
else:
    print("ERROR: emptyWindow() not found")
    exit(1)

# ─── 3. Insert fetchFinancesTransactions() before fetchShippingLabelCosts ───
new_finances_fn = '''// \u2500\u2500\u2500 Fetch REFUND / NON_SALE_CHARGE / DISPUTE / CREDIT via Finances API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// These transaction types are not available in the Fulfillment API and must
// be sourced directly from the Finances API for accurate P&L reporting.
async function fetchFinancesTransactions(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  ninetyDaysAgo: Date
): Promise<{
  refunds7d: number;   refunds30d: number;   refunds90d: number;
  nonSale7d: number;   nonSale30d: number;   nonSale90d: number;
  disputes7d: number;  disputes30d: number;  disputes90d: number;
  credits7d: number;   credits30d: number;   credits90d: number;
}> {
  const result = {
    refunds7d: 0,  refunds30d: 0,  refunds90d: 0,
    nonSale7d: 0,  nonSale30d: 0,  nonSale90d: 0,
    disputes7d: 0, disputes30d: 0, disputes90d: 0,
    credits7d: 0,  credits30d: 0,  credits90d: 0,
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
      url.searchParams.set("filter", `transactionType:{${type}},transactionDate:[${fromStr}..${toStr}]`);
      url.searchParams.set("limit", "1000");
      const resp = await fetch(url.toString(), { headers: ebayHeaders });
      if (!resp.ok) {
        const txt = await resp.text();
        console.warn(`Finances API: ${type} fetch failed (${resp.status}):`, txt.substring(0, 200));
        return { type, transactions: [] };
      }
      if (resp.status === 204) return { type, transactions: [] };
      const data = await resp.json();
      return { type, transactions: data.transactions || [] };
    }));

    for (const { type, transactions } of responses) {
      console.log(`Finances API: Got ${transactions.length} ${type} transactions`);
      for (const tx of transactions) {
        const val = Math.abs(parseFloat(tx.amount?.value ?? "0") || 0);
        if (val <= 0) continue;
        const txDate = tx.transactionDate ? new Date(tx.transactionDate) : null;
        if (!txDate) continue;

        const is7d  = txDate >= sevenDaysAgo;
        const is30d = txDate >= thirtyDaysAgo;

        if (type === "REFUND") {
          result.refunds90d += val;
          if (is30d) result.refunds30d += val;
          if (is7d)  result.refunds7d  += val;
        } else if (type === "NON_SALE_CHARGE") {
          result.nonSale90d += val;
          if (is30d) result.nonSale30d += val;
          if (is7d)  result.nonSale7d  += val;
        } else if (type === "DISPUTE") {
          result.disputes90d += val;
          if (is30d) result.disputes30d += val;
          if (is7d)  result.disputes7d  += val;
        } else if (type === "CREDIT") {
          result.credits90d += val;
          if (is30d) result.credits30d += val;
          if (is7d)  result.credits7d  += val;
        }
      }
    }

    console.log(`Finances API (30d): refunds=$${result.refunds30d.toFixed(2)}, nonSale=$${result.nonSale30d.toFixed(2)}, disputes=$${result.disputes30d.toFixed(2)}, credits=$${result.credits30d.toFixed(2)}`);
  } catch (e) {
    console.warn("Finances API: transaction fetch error (non-fatal):", e);
  }
  return result;
}

'''

# Insert before fetchShippingLabelCosts
marker = "// \u2500\u2500\u2500 Fetch shipping label costs via Finances API"
idx = content.find(marker)
if idx == -1:
    # Try finding via ASCII
    marker = "async function fetchShippingLabelCosts("
    idx = content.find(marker)
    if idx == -1:
        print("ERROR: fetchShippingLabelCosts marker not found")
        exit(1)
    # Go back to find the comment line
    comment_start = content.rfind("\n", 0, idx - 10)
    idx = comment_start + 1

content = content[:idx] + new_finances_fn + content[idx:]
print("✓ fetchFinancesTransactions() inserted")

# ─── 4. Wire into fetchOrderCounts: add to Promise.all ──────────────────────
old_parallel = """    // Fetch Fulfillment orders + real shipping label costs (from Finances API) in parallel
    const [labelCosts] = await Promise.all([
      fetchShippingLabelCosts(apiBase, ebayHeaders, ninetyDaysAgo),
    ]);"""

new_parallel = """    // Fetch label costs + refunds/credits/disputes/non-sale charges in parallel
    const [labelCosts, finTx] = await Promise.all([
      fetchShippingLabelCosts(apiBase, ebayHeaders, ninetyDaysAgo),
      fetchFinancesTransactions(apiBase, ebayHeaders, ninetyDaysAgo),
    ]);"""

if old_parallel in content:
    content = content.replace(old_parallel, new_parallel, 1)
    print("✓ Promise.all updated to include fetchFinancesTransactions")
else:
    print("ERROR: Promise.all block not found")
    exit(1)

# ─── 5. Apply finTx values after label costs section ────────────────────────
old_apply = """    // Apply real shipping label costs from Finances API and subtract from net profit
    financial.w7.shippingLabels  = labelCosts.labels7d;
    financial.w30.shippingLabels = labelCosts.labels30d;
    financial.w90.shippingLabels = labelCosts.labels90d;
    financial.w7.netProfit  -= labelCosts.labels7d;
    financial.w30.netProfit -= labelCosts.labels30d;
    financial.w90.netProfit -= labelCosts.labels90d;"""

new_apply = """    // Apply real shipping label costs from Finances API
    financial.w7.shippingLabels  = labelCosts.labels7d;
    financial.w30.shippingLabels = labelCosts.labels30d;
    financial.w90.shippingLabels = labelCosts.labels90d;
    financial.w7.netProfit  -= labelCosts.labels7d;
    financial.w30.netProfit -= labelCosts.labels30d;
    financial.w90.netProfit -= labelCosts.labels90d;

    // Apply refunds, non-sale charges, disputes, credits from Finances API
    financial.w7.refunds      = finTx.refunds7d;
    financial.w30.refunds     = finTx.refunds30d;
    financial.w90.refunds     = finTx.refunds90d;
    financial.w7.nonSaleCharges  = finTx.nonSale7d;
    financial.w30.nonSaleCharges = finTx.nonSale30d;
    financial.w90.nonSaleCharges = finTx.nonSale90d;
    financial.w7.disputes     = finTx.disputes7d;
    financial.w30.disputes    = finTx.disputes30d;
    financial.w90.disputes    = finTx.disputes90d;
    financial.w7.credits      = finTx.credits7d;
    financial.w30.credits     = finTx.credits30d;
    financial.w90.credits     = finTx.credits90d;

    // Adjust net profit: subtract refunds, non-sale charges, disputes; add credits
    for (const w of [financial.w7, financial.w30, financial.w90]) {
      w.netProfit = w.netProfit - w.refunds - w.nonSaleCharges - w.disputes + w.credits;
    }"""

if old_apply in content:
    content = content.replace(old_apply, new_apply, 1)
    print("✓ Finances API application block updated")
else:
    print("ERROR: apply block not found")
    exit(1)

with open("supabase/functions/ebay-listings/index.ts", "w") as f:
    f.write(content)

print("\nAll patches applied successfully!")