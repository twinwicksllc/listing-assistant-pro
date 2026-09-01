/**
 * suggestedCategories.ts — server-side breadcrumb resolution
 *
 * Provides `buildSuggestedCategories(listing, svc)` which turns the AI's raw
 * category IDs into display-ready objects with full breadcrumb strings.
 *
 * Breadcrumb resolution order (no hardcoded maps — ever):
 *  1. ebay_taxonomy_cache  — seeded weekly by sync-ebay-taxonomy cron
 *  2. category_mappings    — legacy item-type→category DB records
 *  3. Live eBay getCategorySubtree API — last-resort fallback; auto-caches result
 *  4. null → caller renders "Category #<id>" label
 *
 * The weekly sync-ebay-taxonomy job covers ALL ~5 000 eBay US leaf categories
 * so tiers 3 and 4 should only fire for brand-new categories or on the very
 * first run before the sync has ever executed.
 */

// ---------------------------------------------------------------------------
// DEPRECATED: hardcoded map retained only as an emergency bootstrap reference.
// After running sync-ebay-taxonomy at least once this entire object is unused.
// DO NOT ADD NEW ENTRIES HERE — run the sync job instead.
//
// 2026-09-01: removed 10 confirmed live-leaf-wrong-domain entries (verified
// against corpus/ebay_taxonomy_snapshot.json) rather than "correcting" them —
// this map's own policy above is to shrink, not be maintained, and a deleted
// entry makes Tier 4 return `null` (the caller renders a visible "Category
// #<id>" placeholder) instead of a confidently wrong breadcrumb. Exported
// (was module-private) purely so a test can iterate its keys directly; see
// suggestedCategories.test.ts.
// ---------------------------------------------------------------------------
export const _LEGACY_BOOTSTRAP_BREADCRUMBS: Record<string, string> = {
  // ── Coins & Bullion ──────────────────────────────────────────────────────
  "178906": "Coins & Paper Money > Bullion > Gold > Bars & Rounds",
  "39489": "Coins & Paper Money > Bullion > Silver > Bars & Rounds",
  "3361": "Coins & Paper Money > Bullion > Silver > Other",
  "532": "Coins & Paper Money > Coins: Ancient",
  "173685": "Coins & Paper Money > Coins: Medieval",
  "11981": "Coins & Paper Money > Coins: US > Dollars > Eisenhower (1971-78)",
  "39464": "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)",
  "11980": "Coins & Paper Money > Coins: US > Dollars > Peace (1921-35)",
  "11971": "Coins & Paper Money > Coins: US > Half Dollars > Barber (1892-1915)",
  "41099": "Coins & Paper Money > Coins: US > Half Dollars > Liberty Walking (1916-47)",
  "41102": "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",
  "11973": "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",
  "41109": "Coins & Paper Money > Coins: US > Proof Sets",
  "526": "Coins & Paper Money > Coins: US > Mint Sets",
  "253": "Coins & Paper Money > Coins: US",
  "11116": "Coins & Paper Money > Coins: US > Pennies > Lincoln Memorial (1959-2008)",
  "11118": "Coins & Paper Money > Coins: US > Half Dollars",
  "40149": "Coins & Paper Money > Coins: US > Quarters > Washington (1932-1998)",
  // 40150/40152 removed 2026-09-01: confirmed LIVE LEAVES silently
  // reassigned by eBay to Action Figures / Go-Karts (Recreational), not
  // Roosevelt Dime / Jefferson Nickel.
  "40151": "Coins & Paper Money > Coins: US > Dimes > Mercury (1916-1945)",
  "40153": "Coins & Paper Money > Coins: US > Nickels > Buffalo (1913-1938)",
  "40154": "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)",
  "40155": "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  "40156": "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",
  "40157": "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",
  "39461": "Coins & Paper Money > Coins: US > Quarters > Washington (1932-98)",
  "179531": "Coins & Paper Money > Coins: US > Commemorative > Silver (1892-1954)",
  "179532": "Coins & Paper Money > Coins: US > Commemorative > Gold (1903-1926)",
  "179533": "Coins & Paper Money > Coins: US > Commemorative > Modern Silver/Clad (1982-Now)",
  "179534": "Coins & Paper Money > Coins: US > Commemorative > Modern Gold (1984-Now)",
  "529": "Coins & Paper Money > Coins: US > Commemorative > Mixed Lots",
  "40158": "Coins & Paper Money > Coins: US > Dollars > Sacagawea/Native American",
  "40159": "Coins & Paper Money > Coins: US > Dollars > Presidential",
  "40160": "Coins & Paper Money > Coins: US > Dollars > Susan B. Anthony",
  "41111": "Coins & Paper Money > Coins: US > Dollars > American Silver Eagle",
  "164743": "Coins & Paper Money > Coins: US > Quarters > 50 States & Territories",
  "39455": "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  "40161": "Coins & Paper Money > Coins: US > Gold Coins > $20 Double Eagle",
  "40162": "Coins & Paper Money > Coins: US > Gold Coins > $10 Eagle",
  "40163": "Coins & Paper Money > Coins: US > Gold Coins > $5 Half Eagle",
  "40164": "Coins & Paper Money > Coins: US > Gold Coins > $2.50 Quarter Eagle",
  "40165": "Coins & Paper Money > Coins: US > Gold Coins > $1 Gold",
  "40166": "Coins & Paper Money > Coins: US > Gold Coins > American Gold Eagle",
  "40167": "Coins & Paper Money > Coins: US > Gold Coins > American Gold Buffalo",
  // 261064/261068/261069/261070/261071 removed 2026-09-01: confirmed LIVE
  // LEAVES in Toys & Hobbies (Action Figures family) / Collectibles
  // (Signs & Plaques), not Bullion.
  "261072": "Coins & Paper Money > Bullion > Platinum > Bars & Rounds",
  "261073": "Coins & Paper Money > Bullion > Palladium",
  "261074": "Coins & Paper Money > Bullion > Silver",
  "261075": "Coins & Paper Money > Bullion > Gold",
  "261076": "Coins & Paper Money > Bullion",
  "166679": "Coins & Paper Money > Bullion > Other",
  // 166680/166681 removed 2026-09-01: confirmed live leaves, but Paper
  // Money: World > Cambodia/Hong Kong, not Copper Bullion.
  // 45243 and 40196-40200 were removed 2026-08-24: confirmed absent from the
  // live ebay_taxonomy_cache (Finding B, CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md).
  // eBay restructured World Coins into country-specific era/denomination leaves.
  // Replacements below are confirmed live leaves as of the 2026-08-23 sync.
  "536": "Coins & Paper Money > Coins: Canada > Other Canadian Coins",
  "173692": "Coins & Paper Money > Coins: World > North & Central America > Mexico > Mixed Lots",
  "538": "Coins & Paper Money > Coins: World > Europe > UK (Great Britain) > Other UK Coins",
  "535": "Coins & Paper Money > Coins: World > Australia & Oceania > Australia > Other Australian Coins",
  "173694": "Coins & Paper Money > Coins: World > Europe > Germany > Mixed Lots",
  "257": "Coins & Paper Money > Coins: World > Other Coins of the World",
  "3411": "Coins & Paper Money > Paper Money: US",
  "45244": "Coins & Paper Money > Paper Money: World",
  "19167": "Coins & Paper Money > Exonumia > Tokens",
  "19168": "Coins & Paper Money > Exonumia > Medals",
  "19169": "Coins & Paper Money > Exonumia > Elongated Coins",

  // ── Toys & Collectible Figures ───────────────────────────────────────────
  "19203": "Collectibles > Stuffed Animals & Plushies > Beanie Babies",
  "19209": "Collectibles > Stuffed Animals & Plushies",
  "19013": "Toys & Hobbies > Stuffed Animals",
  "246": "Toys & Hobbies > Action Figures & Accessories > Action Figures",
  "2562": "Toys & Hobbies > Diecast & Toy Vehicles",
  "222": "Toys & Hobbies > Dolls & Bears > Dolls",
  "238": "Toys & Hobbies > Dolls & Bears > Bears",
  "220": "Toys & Hobbies > Dolls & Bears",
  // 182 removed 2026-09-01: confirmed LIVE LEAF, but Computers/Tablets &
  // Networking > Software > Other Computer Software, not LEGO.
  "19016": "Toys & Hobbies > Games > Board Games",
  "233": "Toys & Hobbies > Puzzles",

  // ── Trading Cards ────────────────────────────────────────────────────────
  "261328": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Basketball Cards",
  "183454": "Toys & Hobbies > Collectible Card Games > Pokémon > Cards",
  "2536": "Toys & Hobbies > Collectible Card Games",
  "64482": "Sports Mem, Cards & Fan Shop > Sports Trading Cards",
  "213": "Sports Mem, Cards & Fan Shop > Sports Trading Cards > Baseball Cards",

  // ── Jewelry & Watches ───────────────────────────────────────────────────
  "10986": "Jewelry & Watches > Fine Jewelry > Necklaces & Pendants",
  "14324": "Jewelry & Watches > Fine Jewelry > Rings",
  "10985": "Jewelry & Watches > Fine Jewelry > Bracelets",
  "10987": "Jewelry & Watches > Fine Jewelry > Earrings",
  "11233": "Jewelry & Watches",
  "14327": "Jewelry & Watches > Watches, Parts & Accessories",
  "31387": "Jewelry & Watches > Fashion Jewelry",
  "110605": "Jewelry & Watches > Fine Jewelry > Jewelry Sets",

  // ── Electronics ──────────────────────────────────────────────────────────
  "9355": "Cell Phones & Smartphones",
  "15032": "Cell Phones & Accessories",
  "139971": "Video Games & Consoles",
  "1249": "Video Games & Consoles > Video Games",
  "293": "Consumer Electronics",
  "58058": "Consumer Electronics > Cameras & Photo",
  "112529": "Consumer Electronics > Audio > Headphones",
  "3676": "Consumer Electronics > TV, Video & Home Audio",

  // ── Clothing & Fashion ───────────────────────────────────────────────────
  "11450": "Clothing, Shoes & Accessories",
  // 15709 removed 2026-09-01: confirmed LIVE LEAF, but Clothing, Shoes &
  // Accessories > Men > Men's Shoes > Athletic Shoes, not T-Shirts.
  "15724": "Clothing, Shoes & Accessories > Women's Clothing",
  "93427": "Clothing, Shoes & Accessories > Men's Shoes",

  // ── Books ────────────────────────────────────────────────────────────────
  "267": "Books & Magazines > Books",
  "29223": "Books & Magazines > Books > Fiction & Literature",
  "171228": "Books & Magazines > Textbooks, Education",

  // ── Tools & Home ─────────────────────────────────────────────────────────
  "631": "Tools & Workshop Equipment",
  "20713": "Home & Garden",
  "11700": "Home & Garden > Furniture",
  "14308": "Home & Garden > Kitchen, Dining & Bar",

  // ── Art & Collectibles ───────────────────────────────────────────────────
  "550": "Art",
  "1": "Collectibles",
  "237": "Collectibles > Decorative Collectibles",
  "870": "Collectibles > Militaria",
  "45": "Collectibles > Animation Art & Characters",
  // 40 removed 2026-09-01: confirmed LIVE LEAF, but Collectibles >
  // Advertising > Gas & Oil > Other Gas & Oil Collectibles, not Autographs.
  // "99" removed 2026-08-24: not a real eBay leaf category (confirmed absent
  // from live ebay_taxonomy_cache) and was mislabeled here as "Vintage Sports
  // Memorabilia" -- it is actually the "Everything Else" rollup ID. This was
  // the root cause of the 1893 Columbian Half Dollar routing to category 99
  // (see CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md Finding, screenshots).
  "261": "Collectibles > Holiday & Seasonal > Christmas",
  "14339": "Collectibles > Banks, Registers & Vending > Still Banks",
};
// ── END LEGACY MAP ──────────────────────────────────────────────────────────

// ── eBay App Token (lazy, cached per-module-invocation) ──────────────────────
let _ebayTokenCache: { token: string; base: string } | null = null;

async function getEbayAppToken(): Promise<
  {
    token: string;
    base: string;
  } | null
> {
  // Guard: Deno only (not available in Node.js test environments)
  if (typeof Deno === "undefined") return null;

  if (_ebayTokenCache) return _ebayTokenCache;
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  if (!clientId || !clientSecret) return null;
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  try {
    const resp = await fetch(`${base}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json.access_token) return null;
    _ebayTokenCache = { token: json.access_token, base };
    return _ebayTokenCache;
  } catch {
    return null;
  }
}

/**
 * Leaf status of a single eBay categorySubtreeNode, or null when the response
 * carries neither signal.
 *
 * Exported for tests. Returning null rather than defaulting to a boolean is the
 * point: `ebay_taxonomy_cache.is_leaf` is NOT NULL DEFAULT true, so any caller
 * that guesses here writes a claim nothing downstream re-verifies.
 */
export function deriveLeafStatus(node: unknown): boolean | null {
  if (!node || typeof node !== "object") return null;
  const n = node as {
    leafCategoryTreeNode?: unknown;
    childCategoryTreeNodes?: unknown;
  };
  if (n.leafCategoryTreeNode === true) return true;
  if (Array.isArray(n.childCategoryTreeNodes)) {
    return n.childCategoryTreeNodes.length === 0 ? null : false;
  }
  return null;
}

/**
 * Live eBay getCategorySubtree fallback: walks up parentCategoryTreeNodeHref to
 * reconstruct the full breadcrumb. Result is written to ebay_taxonomy_cache so
 * subsequent lookups hit the DB instead of calling the API again.
 */
async function fetchLiveBreadcrumb(
  cid: string,
  svc: any,
): Promise<string | null> {
  const ebay = await getEbayAppToken();
  if (!ebay) return null;

  const parts: string[] = [];
  let currentId = cid;

  // Captured from the depth-0 node, which is `cid` itself. Needed because the
  // cache row we write below must state `cid`'s real leaf status rather than
  // assume it — see the note on the upsert.
  let selfIsLeaf: boolean | null = null;
  let selfParentId: string | null = null;

  for (let depth = 0; depth < 8; depth++) {
    let resp: Response;
    try {
      resp = await fetch(
        `${ebay.base}/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${
          encodeURIComponent(
            currentId,
          )
        }`,
        { headers: { Authorization: `Bearer ${ebay.token}` } },
      );
    } catch {
      break;
    }
    if (resp.status === 404) {
      if (depth === 0) return null;
      break;
    }
    if (!resp.ok) break;
    let json: any;
    try {
      json = await resp.json();
    } catch {
      break;
    }
    const node = json?.categorySubtreeNode;
    if (!node?.category) break;

    // Depth 0 is `cid` itself, the only node whose leaf status we may record.
    if (depth === 0) selfIsLeaf = deriveLeafStatus(node);

    parts.unshift(node.category.categoryName as string);
    const parentHref: string | undefined = node.parentCategoryTreeNodeHref;
    if (!parentHref) break;
    const match = parentHref.match(/category_id=(\d+)/);
    if (!match) break;
    const parentId = match[1];
    if (depth === 0) selfParentId = parentId;
    if (parentId === currentId) break;
    currentId = parentId;
  }

  if (parts.length === 0) return null;
  const breadcrumb = parts.join(" > ");

  // Cache the result so future calls are instant.
  //
  // is_leaf must reflect what eBay reported for `cid`, never an assumption. This
  // previously hardcoded `is_leaf: true`, which meant any branch category routed
  // through this helper was permanently recorded as a listable leaf. Five coin
  // branch categories -- 11116 Coins & Paper Money, 11945 Large Cents, 11951
  // Nickels, 11956 Dimes, 11968 Half Dollars -- were found mislabelled that way
  // on 2026-08-14, and they were immortal: sync-ebay-taxonomy only upserts IDs
  // present in eBay's current leaf set, so it never touched or corrected them.
  // Downstream, publish-helpers reads this table on the documented assumption
  // that every row is an active leaf, so a mislabelled branch can be selected as
  // a listing target and rejected by eBay, which surfaces as a publishing bug
  // rather than a cache problem.
  //
  // The column is NOT NULL DEFAULT true, so omitting the field would reintroduce
  // exactly the wrong claim. When leaf status cannot be established we skip the
  // write entirely: the breadcrumb is still returned to the caller, we simply do
  // not persist a row we cannot characterise. Losing a cache hit is cheaper than
  // laundering a guess into a fact that nothing later corrects.
  if (svc && selfIsLeaf !== null) {
    try {
      await svc.from("ebay_taxonomy_cache").upsert(
        {
          category_id: cid,
          category_name: parts[parts.length - 1],
          breadcrumb,
          parent_category_id: selfParentId,
          is_leaf: selfIsLeaf,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "category_id" },
      );
    } catch (_) {
      /* cache write failure is non-fatal */
    }
  } else if (svc) {
    console.warn(
      `[suggestedCategories] leaf status unknown for category ${cid}; breadcrumb returned but not cached`,
    );
  }
  return breadcrumb;
}

/**
 * Extracts the last segment (leaf name) from a breadcrumb string.
 * "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)" → "Morgan (1878-1921)"
 */
function leafName(breadcrumb: string): string {
  const parts = breadcrumb.split(" > ");
  return parts[parts.length - 1] || breadcrumb;
}

/** Which of lookupBreadcrumb's 4 resolution tiers actually supplied a breadcrumb. */
export type BreadcrumbTier = 1 | 2 | 3 | 4;

export interface BreadcrumbLookupResult {
  breadcrumb: string;
  tier: BreadcrumbTier;
}

/**
 * Resolve breadcrumb for a category ID.
 *
 * Resolution order:
 *  1. ebay_taxonomy_cache  — written by weekly sync-ebay-taxonomy cron
 *  2. category_mappings    — legacy per-item-type records from category-lookup
 *  3. Live eBay API        — getCategorySubtree walk; result is auto-cached
 *  4. Legacy bootstrap map — only until the first sync has run (deprecated)
 *
 * Returns the tier alongside the breadcrumb (2026-09-01) so callers can tell
 * a fresh, high-confidence Tier-1/2/3 result apart from a Tier-4 emergency-
 * bootstrap guess before deciding whether to trust it for anything beyond
 * display — e.g. analyze-item's auto-persist skips writing a Tier-4-sourced
 * label into category_mappings, so a possibly-wrong emergency fallback value
 * can never become self-perpetuating in the very table this function reads
 * from at Tier 2.
 */
async function lookupBreadcrumb(cid: string, svc: any): Promise<BreadcrumbLookupResult | null> {
  // Tier 1: taxonomy cache (primary source after first sync)
  if (svc) {
    try {
      const { data: row } = await svc
        .from("ebay_taxonomy_cache")
        .select("breadcrumb")
        .eq("category_id", cid)
        .maybeSingle();
      if (row?.breadcrumb) return { breadcrumb: row.breadcrumb as string, tier: 1 };
    } catch (_) {
      /* ignore */
    }

    // Tier 2: legacy category_mappings
    try {
      const { data: row } = await svc
        .from("category_mappings")
        .select("breadcrumb, category_name")
        .eq("ebay_category_id", cid)
        .maybeSingle();
      if (row?.breadcrumb) return { breadcrumb: row.breadcrumb as string, tier: 2 };
      if (row?.category_name) return { breadcrumb: row.category_name as string, tier: 2 };
    } catch (_) {
      /* ignore */
    }
  }

  // Tier 3: live eBay API (also seeds DB for next time)
  const live = await fetchLiveBreadcrumb(cid, svc);
  if (live) return { breadcrumb: live, tier: 3 };

  // Tier 4: legacy bootstrap map (only fires before the first sync has ever run)
  const bootstrapped = _LEGACY_BOOTSTRAP_BREADCRUMBS[cid];
  return bootstrapped ? { breadcrumb: bootstrapped, tier: 4 } : null;
}

export async function buildSuggestedCategories(listing: any, svc: any) {
  const normalizeId = (id: any) => (id ? String(id).trim() : "");
  const seen = new Set<string>();
  const finalSuggestions: any[] = [];

  // 1. AI-provided primary category
  if (listing.ebayCategoryId) {
    const cid = normalizeId(listing.ebayCategoryId);
    seen.add(cid);
    const resolved = await lookupBreadcrumb(cid, svc);
    finalSuggestions.push({
      categoryId: cid,
      categoryName: resolved ? leafName(resolved.breadcrumb) : null,
      breadcrumb: resolved?.breadcrumb ?? null,
      reason: "Primary category from AI",
      fromLegacyBootstrap: resolved?.tier === 4,
    });
  }

  // 2. AI-provided alternative categories
  if (Array.isArray(listing.alternativeCategoryIds)) {
    for (const altId of listing.alternativeCategoryIds) {
      const cid = normalizeId(altId);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const resolved = await lookupBreadcrumb(cid, svc);
      finalSuggestions.push({
        categoryId: cid,
        categoryName: resolved ? leafName(resolved.breadcrumb) : null,
        breadcrumb: resolved?.breadcrumb ?? null,
        reason: "Alternative from AI",
        fromLegacyBootstrap: resolved?.tier === 4,
      });
      if (finalSuggestions.length >= 3) break;
    }
  }

  // 3. Any categories already on listing.suggestedCategories (legacy / pass-through)
  if (Array.isArray(listing.suggestedCategories)) {
    for (const s of listing.suggestedCategories) {
      const cid = normalizeId(s?.categoryId);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      // Prefer live DB lookup, but accept any breadcrumb upstream already resolved
      const resolved = await lookupBreadcrumb(cid, svc);
      const breadcrumb = resolved?.breadcrumb ?? s.breadcrumb ?? null;
      finalSuggestions.push({
        categoryId: cid,
        categoryName: resolved ? leafName(resolved.breadcrumb) : (s.categoryName ?? null),
        breadcrumb,
        reason: s.reason ?? "AI suggestion",
        // A value already on the listing (the s.breadcrumb fallback) didn't
        // come from a fresh Tier-4 lookup just now, so it's not flagged —
        // only a resolved.tier === 4 result from THIS lookup counts.
        fromLegacyBootstrap: resolved?.tier === 4,
      });
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Backfill: ensure every suggestion has at least something to display
  for (let i = 0; i < finalSuggestions.length; i++) {
    const s = finalSuggestions[i];
    if (!s.breadcrumb && !s.categoryName) {
      s.categoryName = `Category #${s.categoryId}`;
    }
    if (!s.breadcrumb) {
      s.breadcrumb = s.categoryName;
    }
  }

  return finalSuggestions.slice(0, 3);
}

export default buildSuggestedCategories;
