/**
 * Local breadcrumb map — mirrors the frontend ebayCategoryMap.ts for server-side use.
 * Used to provide breadcrumb names when building suggestedCategories.
 */
const EBAY_CATEGORY_BREADCRUMBS: Record<string, string> = {
  // ★ Template categories
  "178906": "Coins & Paper Money > Bullion > Gold > Bars & Rounds",
  "39489":  "Coins & Paper Money > Bullion > Silver > Bars & Rounds",
  "3361":   "Coins & Paper Money > Bullion > Silver > Other",
  "532":    "Coins & Paper Money > Coins: Ancient",
  "173685": "Coins & Paper Money > Coins: Medieval",
  "11981":  "Coins & Paper Money > Coins: US > Dollars > Eisenhower (1971-78)",
  "39464":  "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)",
  "11980":  "Coins & Paper Money > Coins: US > Dollars > Peace (1921-35)",
  "11971":  "Coins & Paper Money > Coins: US > Half Dollars > Barber (1892-1915)",
  "41099":  "Coins & Paper Money > Coins: US > Half Dollars > Liberty Walking (1916-47)",
  "41109":  "Coins & Paper Money > Coins: US > Proof Sets",
  "526":    "Coins & Paper Money > Coins: US > Mint Sets",
  // US Coins
  "253":    "Coins & Paper Money > Coins: US",
  "11116":  "Coins & Paper Money > Coins: US > Pennies > Lincoln Memorial (1959-2008)",
  "11118":  "Coins & Paper Money > Coins: US > Half Dollars",
  "40149":  "Coins & Paper Money > Coins: US > Quarters > Washington (1932-1998)",
  "40150":  "Coins & Paper Money > Coins: US > Dimes > Roosevelt (1946-Now)",
  "40151":  "Coins & Paper Money > Coins: US > Dimes > Mercury (1916-1945)",
  "40152":  "Coins & Paper Money > Coins: US > Nickels > Jefferson (1938-Now)",
  "40153":  "Coins & Paper Money > Coins: US > Nickels > Buffalo (1913-1938)",
  "40154":  "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)",
  "40155":  "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  "40156":  "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",
  "40157":  "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",
  "40158":  "Coins & Paper Money > Coins: US > Dollars > Sacagawea/Native American",
  "40159":  "Coins & Paper Money > Coins: US > Dollars > Presidential",
  "40160":  "Coins & Paper Money > Coins: US > Dollars > Susan B. Anthony",
  "41111":  "Coins & Paper Money > Coins: US > Dollars > American Silver Eagle",
  "164743": "Coins & Paper Money > Coins: US > Quarters > 50 States & Territories",
  "39455":  "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  // Gold Coins
  "40161":  "Coins & Paper Money > Coins: US > Gold Coins > $20 Double Eagle",
  "40162":  "Coins & Paper Money > Coins: US > Gold Coins > $10 Eagle",
  "40163":  "Coins & Paper Money > Coins: US > Gold Coins > $5 Half Eagle",
  "40164":  "Coins & Paper Money > Coins: US > Gold Coins > $2.50 Quarter Eagle",
  "40165":  "Coins & Paper Money > Coins: US > Gold Coins > $1 Gold",
  "40166":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Eagle",
  "40167":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Buffalo",
  // Bullion
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
  // World Coins
  "45243":  "Coins & Paper Money > Coins: World",
  "40196":  "Coins & Paper Money > Coins: World > Canada",
  "40197":  "Coins & Paper Money > Coins: World > Mexico",
  "40198":  "Coins & Paper Money > Coins: World > Great Britain",
  "40199":  "Coins & Paper Money > Coins: World > Australia",
  "40200":  "Coins & Paper Money > Coins: World > Germany",
  // Paper Money
  "3411":   "Coins & Paper Money > Paper Money: US",
  "45244":  "Coins & Paper Money > Paper Money: World",
  // Exonumia
  "19167":  "Coins & Paper Money > Exonumia > Tokens",
  "19168":  "Coins & Paper Money > Exonumia > Medals",
  "19169":  "Coins & Paper Money > Exonumia > Elongated Coins",
  // General
  "1":      "Collectibles",
  "237":    "Collectibles > Decorative Collectibles",
  "870":    "Collectibles > Militaria",
  "11450":  "Clothing, Shoes & Accessories",
  "293":    "Consumer Electronics",
  "11233":  "Jewelry & Watches",
  "550":    "Art",
};

/**
 * Extracts the last segment (leaf name) from a breadcrumb string.
 * "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)" → "Morgan (1878-1921)"
 */
function leafName(breadcrumb: string): string {
  const parts = breadcrumb.split(" > ");
  return parts[parts.length - 1] || breadcrumb;
}

export async function buildSuggestedCategories(listing: any, svc: any) {
  const normalizeId = (id: any) => (id ? String(id).trim() : "");
  const seen = new Set<string>();
  const finalSuggestions: any[] = [];

  // Start with AI-provided primary category (ebayCategoryId)
  if (listing.ebayCategoryId) {
    const cid = normalizeId(listing.ebayCategoryId);
    seen.add(cid);
    const breadcrumb = EBAY_CATEGORY_BREADCRUMBS[cid] || null;
    finalSuggestions.push({
      categoryId: cid,
      categoryName: breadcrumb ? leafName(breadcrumb) : null,
      breadcrumb: breadcrumb,
      reason: "Primary category from AI",
    });
  }

  // Add AI-provided alternative categories (from Gemini's alternativeCategoryIds)
  if (Array.isArray(listing.alternativeCategoryIds)) {
    for (const altId of listing.alternativeCategoryIds) {
      const cid = normalizeId(altId);
      if (!cid) continue;
      if (!seen.has(cid)) {
        seen.add(cid);
        const breadcrumb = EBAY_CATEGORY_BREADCRUMBS[cid] || null;
        finalSuggestions.push({
          categoryId: cid,
          categoryName: breadcrumb ? leafName(breadcrumb) : null,
          breadcrumb: breadcrumb,
          reason: "Alternative from AI",
        });
      }
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Add any existing suggestions (legacy support)
  if (Array.isArray(listing.suggestedCategories)) {
    for (const s of listing.suggestedCategories) {
      const cid = normalizeId(s?.categoryId);
      if (!cid) continue;
      if (!seen.has(cid)) {
        seen.add(cid);
        const breadcrumb = EBAY_CATEGORY_BREADCRUMBS[cid] || s.breadcrumb || null;
        finalSuggestions.push({
          categoryId: cid,
          categoryName: breadcrumb ? leafName(breadcrumb) : (s.categoryName || null),
          breadcrumb: breadcrumb,
          reason: s.reason || "AI suggestion",
        });
      }
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Backfill missing category names via DB lookup, then local map
  if (svc) {
    for (let i = 0; i < finalSuggestions.length; i++) {
      if (!finalSuggestions[i].breadcrumb) {
        // Try DB first
        try {
          const { data: exact } = await svc
            .from("category_mappings")
            .select("category_name")
            .eq("ebay_category_id", finalSuggestions[i].categoryId)
            .single();
          if (exact && exact.category_name) {
            finalSuggestions[i].breadcrumb = exact.category_name;
            finalSuggestions[i].categoryName = leafName(exact.category_name);
          }
        } catch (e) {
          // ignore lookup failures - keep null
        }
      }
      // If still no name, set a fallback
      if (!finalSuggestions[i].categoryName) {
        finalSuggestions[i].categoryName = `Category #${finalSuggestions[i].categoryId}`;
      }
    }
  }

  // Limit to up to 3
  return finalSuggestions.slice(0, 3);
}

export default buildSuggestedCategories;