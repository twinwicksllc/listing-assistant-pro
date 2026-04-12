import re

with open("supabase/functions/ebay-listings/index.ts", "r") as f:
    content = f.read()

# The new fetchShippingLabelCosts function to insert before fetchOrderCounts
new_function = '''// ─── Fetch shipping label costs via Finances API ─────────────────────────────
// The Fulfillment API order objects don't contain the seller's label costs.
// Label purchases appear as SHIPPING_LABEL debit transactions in the Finances API.
async function fetchShippingLabelCosts(
  apiBase: string,
  ebayHeaders: Record<string, string>,
  ninetyDaysAgo: Date
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
    url.searchParams.set("filter", `transactionType:{SHIPPING_LABEL},transactionDate:[${fromStr}..${toStr}]`);
    url.searchParams.set("limit", "200");

    console.log(`Finances API: Fetching SHIPPING_LABEL transactions from ${fromStr}`);
    const resp = await fetch(url.toString(), { headers: ebayHeaders });

    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`Finances API: SHIPPING_LABEL fetch failed (${resp.status}) - label costs will be 0:`, txt);
      return result;
    }

    if (resp.status === 204) {
      console.log("Finances API: No SHIPPING_LABEL transactions found");
      return result;
    }

    const data = await resp.json();
    const transactions: any[] = data.transactions || [];
    console.log(`Finances API: Got ${transactions.length} SHIPPING_LABEL transactions`);

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

    console.log(`Finances API: label costs - 7d=$${result.labels7d.toFixed(2)}, 30d=$${result.labels30d.toFixed(2)}, 90d=$${result.labels90d.toFixed(2)}`);
  } catch (e) {
    console.warn("Finances API: SHIPPING_LABEL fetch error (non-fatal, label costs will be 0):", e);
  }
  return result;
}

'''

# Find the position of the fetchOrderCounts comment line (using a safe ASCII search)
marker = "// we use the Fulfillment API to get actual orders + revenue + fees.\nasync function fetchOrderCounts("
idx = content.find(marker)
if idx == -1:
    print("ERROR: marker not found")
    exit(1)

# Find start of the comment block (go back to find the ─── line)
# Search backwards from idx for the start of the comment
comment_start = content.rfind("\n", 0, idx - 50)
insert_pos = comment_start + 1  # insert before the comment block

content = content[:insert_pos] + new_function + content[insert_pos:]
print(f"Inserted fetchShippingLabelCosts at position {insert_pos}")

with open("supabase/functions/ebay-listings/index.ts", "w") as f:
    f.write(content)

print("Done!")