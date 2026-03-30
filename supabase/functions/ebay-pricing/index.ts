import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException, initSentry } from "../_helpers/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SoldItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemId?: string;
  imageUrl?: string | null;
  itemUrl?: string | null;
}

// ----------------------------------------------------------------
// Scrape eBay completed/sold listings via Jina AI reader.
// Jina converts the page to clean markdown, bypassing bot detection.
// ----------------------------------------------------------------
async function scrapeEbaySoldListings(query: string): Promise<SoldItem[]> {
  const encoded = encodeURIComponent(query);
  // LH_Complete=1&LH_Sold=1 → completed AND sold listings only
  // _sop=13 → sort by most recently ended
  // _ipg=50 → 50 results per page
  const ebayUrl =
    `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1&_ipg=50&_sop=13`;
  const jinaUrl = `https://r.jina.ai/${ebayUrl}`;

  console.log(
    `[ebay-pricing] Fetching via Jina: ${jinaUrl.substring(0, 100)}...`,
  );

  const resp = await fetch(jinaUrl, {
    headers: {
      "Accept": "text/plain,text/markdown,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; ListingAssistantBot/1.0)",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    console.error(`[ebay-pricing] Jina fetch failed: ${resp.status}`);
    return [];
  }

  const content = await resp.text();
  console.log(`[ebay-pricing] Jina content length: ${content.length} chars`);

  if (content.length < 200) {
    console.warn(`[ebay-pricing] Jina returned suspiciously short content`);
    return [];
  }

  return parseSoldItemsFromMarkdown(content, query);
}

// ----------------------------------------------------------------
// Parse sold items from Jina markdown output.
// eBay's Jina output contains lines like:
//   ## [Title](https://www.ebay.com/itm/...)
//   Sold  · $XX.XX
// or price patterns like:
//   **$XX.XX**
// ----------------------------------------------------------------
function parseSoldItemsFromMarkdown(
  content: string,
  query: string,
): SoldItem[] {
  const items: SoldItem[] = [];
  const lines = content.split("\n");

  // Strategy 1: Look for price patterns near "Sold" markers
  // eBay sold listings in Jina markdown typically have dollar amounts
  // Pattern: lines containing $ amounts that look like item prices
  const priceLineRegex = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;

  // Extract all price occurrences from content
  // Filter to realistic coin/bullion price range ($1 - $50,000)
  const allPrices: number[] = [];
  const priceMatches = content.matchAll(
    /(?:sold|price|bid)[^\n$]*\$\s*([\d,]+(?:\.\d{2})?)/gi,
  );
  for (const match of priceMatches) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price >= 1 && price <= 50000) {
      allPrices.push(price);
    }
  }

  // Strategy 2: Extract structured listing blocks
  // Jina outputs eBay listings as markdown sections with title links + price
  const listingBlocks = content.split(/\n(?=\[|\!\[|##\s|\*\*)/);

  for (const block of listingBlocks) {
    // Look for a price in this block
    const priceMatch = block.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    if (!priceMatch) continue;

    const price = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (price < 1 || price > 50000) continue;

    // Skip shipping cost lines (usually small amounts like $5.99)
    // but keep if it's the only price in the block
    const titleMatch = block.match(
      /\[([^\]]{10,120})\]\(https?:\/\/www\.ebay\.com\/itm\/[^)]+\)/,
    );
    const urlMatch = block.match(/\((https?:\/\/www\.ebay\.com\/itm\/[^)]+)\)/);
    const imageMatch = block.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);

    // Determine condition from block text
    let condition = "Pre-Owned";
    const blockLower = block.toLowerCase();
    if (
      blockLower.includes("new in") || blockLower.includes("brand new") ||
      blockLower.includes("sealed")
    ) {
      condition = "New";
    } else if (
      blockLower.includes("uncirculated") || blockLower.includes("ms-") ||
      blockLower.includes(" ms ")
    ) {
      condition = "Uncirculated";
    } else if (blockLower.includes("circulated")) {
      condition = "Circulated";
    }

    const title = titleMatch ? titleMatch[1].trim() : query;
    const itemUrl = urlMatch ? urlMatch[1] : null;
    const imageUrl = imageMatch ? imageMatch[1] : null;

    items.push({
      title,
      price,
      currency: "USD",
      condition,
      itemUrl,
      imageUrl,
    });
  }

  // If structured parsing yielded results, return them (deduplicated by price+title)
  if (items.length >= 2) {
    console.log(
      `[ebay-pricing] Parsed ${items.length} structured items from Jina`,
    );
    // Deduplicate: remove items with exact same price AND near-same title
    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      const key = `${item.price}-${item.title.substring(0, 30)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.slice(0, 15);
  }

  // Fallback: use raw price extraction if structured parsing failed
  if (allPrices.length >= 2) {
    console.log(
      `[ebay-pricing] Falling back to raw price extraction: ${allPrices.length} prices`,
    );
    return allPrices.slice(0, 15).map((price) => ({
      title: query,
      price,
      currency: "USD",
      condition: "Pre-Owned",
      itemUrl: null,
      imageUrl: null,
    }));
  }

  console.log(`[ebay-pricing] No sold items parsed from Jina content`);
  return [];
}

// ----------------------------------------------------------------
// Narrow the title to meaningful search tokens.
// Preserves coin grade notation (MS-63 → ms63) so graded coin comps
// are grade-specific rather than spanning all conditions.
// ----------------------------------------------------------------
function deriveSearchQuery(title: string): string {
  // Pre-process: join grade letter + number before general replacement
  // "MS-63" → "ms63", "VF-35" → "vf35", "MS 65" → "ms65"
  const gradeNormalised = title.replace(
    /\b(MS|VF|EF|XF|AU|PF|PR|SP|AG|G|F|VG)-?\s*(\d{1,2})\b/gi,
    (_, g, n) => `${g}${n}`,
  );

  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "in",
    "for",
    "to",
    "with",
    "lot",
    "set",
    "collection",
    "item",
    "listing",
    "ebay",
    "certified",
    "uncirculated",
    "beautiful",
    "stunning",
    "rare",
    "vintage",
    "antique",
    "original",
    "authentic",
  ]);

  const tokens = gradeNormalised
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  // Use up to 8 tokens so grade + grader (e.g. "pcgs ms63") aren't truncated
  return tokens.slice(0, 8).join(" ");
}

// ----------------------------------------------------------------
// Remove statistical outliers using the IQR (Tukey fence) method.
// Filters soldItems whose prices are below Q1 - 1.5*IQR or above
// Q3 + 1.5*IQR. Requires ≥ 5 items to activate (smaller sets are
// returned unchanged to avoid discarding too much data).
// ----------------------------------------------------------------
function filterOutliers(items: SoldItem[]): SoldItem[] {
  if (items.length < 5) return items;
  const sorted = [...items].sort((a, b) => a.price - b.price);
  const q1 = sorted[Math.floor(sorted.length * 0.25)].price;
  const q3 = sorted[Math.floor(sorted.length * 0.75)].price;
  const iqr = q3 - q1;
  if (iqr === 0) return items; // all same price, nothing to filter
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const filtered = items.filter((i) => i.price >= lo && i.price <= hi);
  if (filtered.length >= 3) {
    console.log(
      `[ebay-pricing] Outlier filter: ${items.length} → ${filtered.length} items (fence $${
        lo.toFixed(2)
      }–$${hi.toFixed(2)})`,
    );
    return filtered;
  }
  return items; // don't filter if it would leave fewer than 3 results
}

// ----------------------------------------------------------------
// Compute median
// ----------------------------------------------------------------
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
serve(async (req) => {
  initSentry();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query) {
      return new Response(
        JSON.stringify({ error: "No search query provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Derive a focused search query from the full title
    const searchQuery = deriveSearchQuery(query);
    console.log(`[ebay-pricing] Title: "${query}" → Search: "${searchQuery}"`);

    // Scrape sold listings via Jina
    let soldItems = await scrapeEbaySoldListings(searchQuery);

    // If not enough results with derived query, try with full query
    if (soldItems.length < 3 && searchQuery !== query.toLowerCase()) {
      console.log(
        `[ebay-pricing] Only ${soldItems.length} results with derived query, trying fuller query...`,
      );
      const fullerQuery = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t: string) => t.length > 1)
        .slice(0, 8)
        .join(" ");
      const moreItems = await scrapeEbaySoldListings(fullerQuery);
      if (moreItems.length > soldItems.length) {
        soldItems = moreItems;
      }
    }

    console.log(`[ebay-pricing] Total sold items found: ${soldItems.length}`);

    // Remove statistical outliers before computing price stats
    soldItems = filterOutliers(soldItems);

    const prices = soldItems.map((i) => i.price).sort((a, b) => a - b);
    const averagePrice = prices.length > 0
      ? parseFloat(
        (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2),
      )
      : 0;

    const lowPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const medianPrice = parseFloat(median(prices).toFixed(2));

    // Percentile stats (p25, p75) for IQR-based pricing
    const p25 = prices.length > 0
      ? prices[Math.max(0, Math.ceil(0.25 * prices.length) - 1)]
      : 0;
    const p75 = prices.length > 0
      ? prices[Math.max(0, Math.ceil(0.75 * prices.length) - 1)]
      : 0;

    // Price histogram buckets (5 buckets for mini chart)
    const histogram: {
      bucket: string;
      count: number;
      min: number;
      max: number;
    }[] = [];
    if (prices.length > 0 && highPrice > lowPrice) {
      const bucketSize = (highPrice - lowPrice) / 5 || 1;
      for (let i = 0; i < 5; i++) {
        const bucketMin = lowPrice + i * bucketSize;
        const bucketMax = bucketMin + bucketSize;
        const count = prices.filter((p) =>
          p >= bucketMin && (i === 4 ? p <= bucketMax : p < bucketMax)
        ).length;
        histogram.push({
          bucket: `$${bucketMin.toFixed(0)}–$${bucketMax.toFixed(0)}`,
          count,
          min: bucketMin,
          max: bucketMax,
        });
      }
    }

    console.log(
      `[ebay-pricing] Stats: avg=${averagePrice}, low=${lowPrice}, high=${highPrice}, median=${medianPrice}, n=${prices.length}`,
    );

    return new Response(
      JSON.stringify({
        soldItems,
        averagePrice,
        lowPrice,
        highPrice,
        medianPrice,
        p25,
        p75,
        histogram,
        totalFound: soldItems.length,
        query: searchQuery,
        originalQuery: query,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ebay-pricing error:", e);
    captureException(e, { function: "ebay-pricing", query });
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
