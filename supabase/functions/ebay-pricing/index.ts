import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException, initSentry } from "../_helpers/sentry.ts";
import { requireUser } from "../_helpers/authGuard.ts";

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

/**
 * What a `source` value actually IS, not just which path produced it.
 * `browse_api` (ebay-competitor-search) returns active asking-price listings
 * -- this app has no Marketplace Insights access -- while `jina` scrapes
 * eBay's LH_Sold=1 sold-search results. Exported/pure so it's testable
 * without exercising the whole HTTP handler.
 */
export function basisFromSource(source: "browse_api" | "jina"): "sold" | "active" {
  return source === "jina" ? "sold" : "active";
}

/**
 * How much to trust the *extraction itself*, independent of `basisFromSource`
 * (what the data IS). `browse_api` is one official, structured JSON call.
 * `jina` is an HTML scrape of eBay's sold-search page regex-parsed into
 * numbers (see parseSoldItemsFromMarkdown's own multi-strategy fallback
 * chain, including a last-resort "grab any dollar amount near the word sold"
 * pass) -- a fundamentally noisier extraction, and the ToS-risk surface
 * flagged in the pricing-reliability plan's Phase 3.3. Surfacing this
 * distinctly from `basis` lets the UI say "sold, but scraped" rather than
 * implying Jina-derived sold data is as trustworthy as a real API response.
 */
export function sourceReliabilityFromSource(
  source: "browse_api" | "jina",
): "structured" | "scraped" {
  return source === "jina" ? "scraped" : "structured";
}

// ----------------------------------------------------------------
// Primary source: delegate to ebay-competitor-search, which uses
// the official eBay Browse API with Gemini-optimised query +
// multi-attempt broadening. Much higher recall than the Jina
// scraper, especially for niche/coin queries like "1909-S VDB".
// Returns [] on any failure so the caller can fall back to Jina.
// ----------------------------------------------------------------
async function fetchViaCompetitorSearch(query: string): Promise<SoldItem[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.warn(
      "[ebay-pricing] SUPABASE_URL/key missing — skipping Browse API path",
    );
    return [];
  }

  try {
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/ebay-competitor-search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ title: query }),
        signal: AbortSignal.timeout(20000),
      },
    );

    if (!resp.ok) {
      console.warn(
        `[ebay-pricing] competitor-search returned ${resp.status} — falling back to Jina`,
      );
      return [];
    }

    const data = await resp.json();
    if (
      data?.noData ||
      !Array.isArray(data?.items) ||
      data.items.length === 0
    ) {
      console.log(
        `[ebay-pricing] competitor-search returned no items — falling back to Jina`,
      );
      return [];
    }

    const mapped: SoldItem[] = data.items
      .map((it: any): SoldItem | null => {
        const price = typeof it?.price === "number" ? it.price : parseFloat(String(it?.price ?? "0"));
        if (!isFinite(price) || price <= 0) return null;
        return {
          title: String(it?.title ?? query),
          price,
          currency: String(it?.currency ?? "USD"),
          condition: String(it?.condition ?? "Pre-Owned"),
          itemId: it?.itemId ? String(it.itemId) : undefined,
          itemUrl: it?.itemUrl ?? null,
          imageUrl: it?.imageUrl ?? null,
        };
      })
      .filter((x: SoldItem | null): x is SoldItem => x !== null);

    console.log(
      `[ebay-pricing] competitor-search yielded ${mapped.length} items (query="${
        data.finalSearchQuery ?? data.searchQuery
      }")`,
    );
    return mapped;
  } catch (err) {
    console.warn(
      `[ebay-pricing] competitor-search threw: ${String(err)} — falling back to Jina`,
    );
    return [];
  }
}

// ----------------------------------------------------------------
// Detects eBay's own error/interstitial page coming back *through* Jina,
// as opposed to a real sold-listings page with genuinely zero results.
//
// 2026-09-20 log investigation (Issue #4) found eBay returning a 403
// directly to Jina's scrape request, with Jina still responding 200 and
// wrapping eBay's "SORRY Something went wrong on our end" error page in
// markdown -- e.g.:
//   "Warning: Target URL returned error 403: Forbidden
//    Markdown Content: SORRY Something went wrong on our end ..."
// Per Jina's own documentation, Reader "doesn't circumvent website
// defenses" -- this is eBay's WAF/bot-detection blocking Jina's fetch
// infrastructure at the network level, not a fixable header/UA issue.
// Distinguishing this from "the search legitimately returned 0 sold
// comps" matters for two reasons: (1) the caller should not immediately
// re-fire an identical, guaranteed-to-be-blocked second Jina request with
// a "fuller query" -- that only doubles wasted traffic against a page
// that's already blocking us, and (2) the UI should say "pricing data
// temporarily unavailable" rather than implying the item has no market.
// Pure/exported so it's testable without a live Jina call.
export function isJinaBlockedContent(content: string): boolean {
  return (
    /Target URL returned error 4\d\d/i.test(content) ||
    /SORRY[\s\S]{0,40}Something went wrong on our end/i.test(content)
  );
}

// ----------------------------------------------------------------
// Scrape eBay completed/sold listings via Jina AI reader.
// Jina converts the page to clean markdown -- this does NOT bypass eBay's
// own bot detection (see isJinaBlockedContent above); it just gives us
// clean markdown when the fetch succeeds.
// ----------------------------------------------------------------
async function scrapeEbaySoldListings(
  query: string,
): Promise<{ items: SoldItem[]; blocked: boolean }> {
  const encoded = encodeURIComponent(query);
  // LH_Complete=1&LH_Sold=1 → completed AND sold listings only
  // _sop=13 → sort by most recently ended
  // _ipg=50 → 50 results per page
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1&_ipg=50&_sop=13`;
  const jinaUrl = `https://r.jina.ai/${ebayUrl}`;

  console.log(
    `[ebay-pricing] Fetching via Jina: ${jinaUrl.substring(0, 100)}...`,
  );

  let resp: Response;
  try {
    resp = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain,text/markdown,*/*",
        // A standard browser UA rather than a self-identifying bot UA
        // ("ListingAssistantBot/1.0") -- a lower-cost, legitimate change,
        // though per Jina's own docs a paid key/header change does not
        // reliably "unblock" a site that's already blocking Reader's
        // infrastructure at the WAF level (see isJinaBlockedContent).
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    // Network error / timeout -- degrade gracefully instead of throwing an
    // unhandled 500 up to the main handler (unlike fetchViaCompetitorSearch,
    // this fetch previously had no try/catch at all).
    console.error(`[ebay-pricing] Jina fetch threw: ${String(err)}`);
    return { items: [], blocked: false };
  }

  if (!resp.ok) {
    console.error(`[ebay-pricing] Jina fetch failed: ${resp.status}`);
    return { items: [], blocked: false };
  }

  const content = await resp.text();
  console.log(`[ebay-pricing] Jina content length: ${content.length} chars`);

  if (content.length < 200) {
    console.warn(`[ebay-pricing] Jina returned suspiciously short content`);
    return { items: [], blocked: false };
  }

  if (isJinaBlockedContent(content)) {
    console.warn(
      `[ebay-pricing] Jina relayed an eBay block/error page instead of real results (preview: ${
        content.substring(0, 160)
      })`,
    );
    return { items: [], blocked: true };
  }

  return { items: parseSoldItemsFromMarkdown(content, query), blocked: false };
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
  const listingBlocks = content.split(/\n(?=\[|!\[|##\s|\*\*)/);

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
      blockLower.includes("new in") ||
      blockLower.includes("brand new") ||
      blockLower.includes("sealed")
    ) {
      condition = "New";
    } else if (
      blockLower.includes("uncirculated") ||
      blockLower.includes("ms-") ||
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
  if (items.length >= 1) {
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

  console.log(
    `[ebay-pricing] No sold items parsed from Jina content (preview: ${content.slice(0, 400).replace(/\s+/g, " ")})`,
  );
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
      `[ebay-pricing] Outlier filter: ${items.length} → ${filtered.length} items (fence $${lo.toFixed(2)}–$${
        hi.toFixed(
          2,
        )
      })`,
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
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
serve(async (req) => {
  initSentry();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUser(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Hoisted so the catch block below can report which query was in flight --
  // `query` itself is destructured inside the try and out of scope there.
  let requestQuery: string | undefined;

  try {
    const { query } = await req.json();
    requestQuery = query;
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

    // Primary path: official eBay Browse API via ebay-competitor-search.
    // Higher recall + Gemini-optimised query. Falls through to Jina on empty.
    let soldItems: SoldItem[] = await fetchViaCompetitorSearch(query);
    const source: "browse_api" | "jina" = soldItems.length > 0 ? "browse_api" : "jina";
    const basis = basisFromSource(source);
    const sourceReliability = sourceReliabilityFromSource(source);

    // Set when Jina relayed an eBay block/interstitial page rather than real
    // results (see isJinaBlockedContent) -- surfaced in the response so the
    // UI/priceRecommender can say "pricing data temporarily unavailable"
    // instead of implying the item genuinely has zero market comps.
    let jinaBlocked = false;

    if (soldItems.length === 0) {
      // Fallback: scrape sold listings via Jina
      const first = await scrapeEbaySoldListings(searchQuery);
      soldItems = first.items;
      jinaBlocked = first.blocked;

      // If not enough results with derived query, try with full query --
      // but only when the first attempt wasn't blocked. eBay's WAF block is
      // a fetch-level/IP-level response, not query-content-dependent, so an
      // immediate second Jina call with a different query string is
      // guaranteed to hit the same block. Retrying anyway just doubles
      // wasted traffic against a page that's already blocking us (2026-09-20
      // log review: 6 consecutive Jina calls in ~1 minute, every single one
      // relaying the same eBay error page).
      if (
        !jinaBlocked && soldItems.length < 3 &&
        searchQuery !== query.toLowerCase()
      ) {
        console.log(
          `[ebay-pricing] Only ${soldItems.length} Jina results with derived query, trying fuller query...`,
        );
        const fullerQuery = query
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((t: string) => t.length > 1)
          .slice(0, 8)
          .join(" ");
        const second = await scrapeEbaySoldListings(fullerQuery);
        if (second.items.length > soldItems.length) {
          soldItems = second.items;
        }
        jinaBlocked = second.blocked && soldItems.length === 0;
      }
    }

    console.log(
      `[ebay-pricing] Total items found: ${soldItems.length} (source=${source})`,
    );

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
    const p25 = prices.length > 0 ? prices[Math.max(0, Math.ceil(0.25 * prices.length) - 1)] : 0;
    const p75 = prices.length > 0 ? prices[Math.max(0, Math.ceil(0.75 * prices.length) - 1)] : 0;

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
        const count = prices.filter(
          (p) => p >= bucketMin && (i === 4 ? p <= bucketMax : p < bucketMax),
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
        source,
        basis,
        sourceReliability,
        // True only when the Jina fallback path was blocked by eBay (see
        // isJinaBlockedContent) -- distinct from a legitimate zero-comp
        // result. Additive field; existing consumers that don't read it are
        // unaffected.
        jinaBlocked,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ebay-pricing error:", e);
    captureException(e, { function: "ebay-pricing", query: requestQuery });
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
