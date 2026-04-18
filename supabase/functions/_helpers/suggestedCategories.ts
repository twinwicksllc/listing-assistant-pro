/**
 * Broad eBay category breadcrumb map — covers coins, collectibles, toys, electronics, etc.
 * Used server-side to provide breadcrumb names when building suggestedCategories.
 * When a category ID is NOT in this map, we fall back to the DB category_mappings table.
 */
const EBAY_CATEGORY_BREADCRUMBS: Record<string, string> = {
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
  "40150": "Coins & Paper Money > Coins: US > Dimes > Roosevelt (1946-Now)",
  "40151": "Coins & Paper Money > Coins: US > Dimes > Mercury (1916-1945)",
  "40152": "Coins & Paper Money > Coins: US > Nickels > Jefferson (1938-Now)",
  "40153": "Coins & Paper Money > Coins: US > Nickels > Buffalo (1913-1938)",
  "40154": "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)",
  "40155": "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  "40156": "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",
  "40157": "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",
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
  "261064": "Coins & Paper Money > Bullion > Gold > Coins",
  "261068": "Coins & Paper Money > Bullion > Silver > Coins",
  "261069": "Coins & Paper Money > Bullion > Silver > Bars & Rounds",
  "261070": "Coins & Paper Money > Bullion > Platinum > Coins",
  "261071": "Coins & Paper Money > Bullion > Gold > Bars & Rounds",
  "261072": "Coins & Paper Money > Bullion > Platinum > Bars & Rounds",
  "261073": "Coins & Paper Money > Bullion > Palladium",
  "261074": "Coins & Paper Money > Bullion > Silver",
  "261075": "Coins & Paper Money > Bullion > Gold",
  "261076": "Coins & Paper Money > Bullion",
  "166679": "Coins & Paper Money > Bullion > Other",
  "166680": "Coins & Paper Money > Bullion > Other > Copper > Bars & Rounds",
  "166681": "Coins & Paper Money > Bullion > Other > Copper > Coins",
  "45243": "Coins & Paper Money > Coins: World",
  "40196": "Coins & Paper Money > Coins: World > Canada",
  "40197": "Coins & Paper Money > Coins: World > Mexico",
  "40198": "Coins & Paper Money > Coins: World > Great Britain",
  "40199": "Coins & Paper Money > Coins: World > Australia",
  "40200": "Coins & Paper Money > Coins: World > Germany",
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
  "261068": "Toys & Hobbies > Action Figures & Accessories > Funko",
  "2562": "Toys & Hobbies > Diecast & Toy Vehicles",
  "222": "Toys & Hobbies > Dolls & Bears > Dolls",
  "238": "Toys & Hobbies > Dolls & Bears > Bears",
  "220": "Toys & Hobbies > Dolls & Bears",
  "182": "Toys & Hobbies > Building Toys > LEGO",
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
  "15709": "Clothing, Shoes & Accessories > Men's Clothing > T-Shirts",
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
  "40": "Collectibles > Autographs",
  "99": "Collectibles > Vintage Sports Memorabilia",
  "64482": "Collectibles > Sports Mem, Cards & Fan Shop",
  "261": "Collectibles > Holiday & Seasonal > Christmas",
  "14339": "Collectibles > Banks, Registers & Vending > Still Banks",
};

/**
 * Extracts the last segment (leaf name) from a breadcrumb string.
 * "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)" → "Morgan (1878-1921)"
 */
function leafName(breadcrumb: string): string {
  const parts = breadcrumb.split(" > ");
  return parts[parts.length - 1] || breadcrumb;
}

// Helper: look up breadcrumb for a category ID — DB first, then hardcoded map
async function lookupBreadcrumb(cid: string, svc: any): Promise<string | null> {
  // 1. Try DB (has dynamic breadcrumbs from eBay getCategorySuggestions)
  if (svc) {
    try {
      const { data: row } = await svc
        .from("category_mappings")
        .select("breadcrumb, category_name")
        .eq("ebay_category_id", cid)
        .maybeSingle();
      if (row?.breadcrumb) return row.breadcrumb;
      if (row?.category_name) return row.category_name;
    } catch (_) { /* ignore */ }
  }
  // 2. Fall back to hardcoded map
  return EBAY_CATEGORY_BREADCRUMBS[cid] || null;
}

export async function buildSuggestedCategories(listing: any, svc: any) {
  const normalizeId = (id: any) => (id ? String(id).trim() : "");
  const seen = new Set<string>();
  const finalSuggestions: any[] = [];

  // Start with AI-provided primary category (ebayCategoryId)
  if (listing.ebayCategoryId) {
    const cid = normalizeId(listing.ebayCategoryId);
    seen.add(cid);
    const breadcrumb = await lookupBreadcrumb(cid, svc);
    finalSuggestions.push({
      categoryId: cid,
      categoryName: breadcrumb ? leafName(breadcrumb) : null,
      breadcrumb: breadcrumb,
      reason: "Primary category from AI",
    });
  }

  // Add AI-provided alternative categories
  if (Array.isArray(listing.alternativeCategoryIds)) {
    for (const altId of listing.alternativeCategoryIds) {
      const cid = normalizeId(altId);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const breadcrumb = await lookupBreadcrumb(cid, svc);
      finalSuggestions.push({
        categoryId: cid,
        categoryName: breadcrumb ? leafName(breadcrumb) : null,
        breadcrumb: breadcrumb,
        reason: "Alternative from AI",
      });
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Add any existing suggestions (legacy support)
  if (Array.isArray(listing.suggestedCategories)) {
    for (const s of listing.suggestedCategories) {
      const cid = normalizeId(s?.categoryId);
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const breadcrumb = await lookupBreadcrumb(cid, svc) || s.breadcrumb ||
        null;
      finalSuggestions.push({
        categoryId: cid,
        categoryName: breadcrumb ? leafName(breadcrumb) : (s.categoryName || null),
        breadcrumb: breadcrumb,
        reason: s.reason || "AI suggestion",
      });
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Backfill: ensure every suggestion has at least a breadcrumb or categoryName
  for (let i = 0; i < finalSuggestions.length; i++) {
    if (!finalSuggestions[i].breadcrumb && !finalSuggestions[i].categoryName) {
      finalSuggestions[i].categoryName = `Category #${finalSuggestions[i].categoryId}`;
    }
    // If we still don't have a breadcrumb but have a categoryName, make it the breadcrumb
    if (!finalSuggestions[i].breadcrumb) {
      finalSuggestions[i].breadcrumb = finalSuggestions[i].categoryName;
    }
  }

  return finalSuggestions.slice(0, 3);
}

export default buildSuggestedCategories;
