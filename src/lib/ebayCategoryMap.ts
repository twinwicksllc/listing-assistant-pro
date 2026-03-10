/**
 * Maps eBay category IDs to human-readable breadcrumb strings.
 * Covers the most common categories for coins, bullion, and collectibles
 * used by the Teckstart AI analysis engine.
 */
export const EBAY_CATEGORY_BREADCRUMBS: Record<string, string> = {
  // --- US Coins ---
  "253":    "Coins & Paper Money > Coins: US",
  "11116":  "Coins & Paper Money > Coins: US > Pennies > Lincoln Memorial (1959-2008)",
  "39481":  "Coins & Paper Money > Coins: US > Half Dollars > Walking Liberty (1916-1947)",
  "11118":  "Coins & Paper Money > Coins: US > Half Dollars",
  "39482":  "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)",
  "39483":  "Coins & Paper Money > Coins: US > Dollars > Peace (1921-1935)",
  "39484":  "Coins & Paper Money > Coins: US > Dollars > Eisenhower (1971-1978)",
  "41111":  "Coins & Paper Money > Coins: US > Dollars > American Silver Eagle",
  "164743": "Coins & Paper Money > Coins: US > Quarters > 50 States & Territories",
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
  "40161":  "Coins & Paper Money > Coins: US > Gold Coins > $20 Double Eagle",
  "40162":  "Coins & Paper Money > Coins: US > Gold Coins > $10 Eagle",
  "40163":  "Coins & Paper Money > Coins: US > Gold Coins > $5 Half Eagle",
  "40164":  "Coins & Paper Money > Coins: US > Gold Coins > $2.5 Quarter Eagle",
  "40165":  "Coins & Paper Money > Coins: US > Gold Coins > $1 Gold",
  "40166":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Eagle",
  "40167":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Buffalo",

  // --- Bullion ---
  "261069": "Coins & Paper Money > Bullion > Silver Bullion > Bars & Rounds",
  "261064": "Coins & Paper Money > Bullion > Gold Bullion > Coins",
  "261071": "Coins & Paper Money > Bullion > Gold Bullion > Bars & Rounds",
  "261068": "Coins & Paper Money > Bullion > Silver Bullion > Coins",
  "261070": "Coins & Paper Money > Bullion > Platinum Bullion > Coins",
  "261072": "Coins & Paper Money > Bullion > Platinum Bullion > Bars & Rounds",
  "261073": "Coins & Paper Money > Bullion > Palladium Bullion",

  // --- World Coins ---
  "45243":  "Coins & Paper Money > Coins: World",
  "40196":  "Coins & Paper Money > Coins: World > Canada",
  "40197":  "Coins & Paper Money > Coins: World > Mexico",
  "40198":  "Coins & Paper Money > Coins: World > Great Britain",
  "40199":  "Coins & Paper Money > Coins: World > Australia",
  "40200":  "Coins & Paper Money > Coins: World > Germany",

  // --- Paper Money ---
  "3411":   "Coins & Paper Money > Paper Money: US",
  "45244":  "Coins & Paper Money > Paper Money: World",

  // --- Exonumia / Tokens ---
  "19167":  "Coins & Paper Money > Exonumia > Tokens",
  "19168":  "Coins & Paper Money > Exonumia > Medals",
  "19169":  "Coins & Paper Money > Exonumia > Elongated Coins",

  // --- General Collectibles ---
  "1":      "Collectibles",
  "237":    "Collectibles > Decorative Collectibles",
  "870":    "Collectibles > Militaria",
  "11450":  "Clothing, Shoes & Accessories",
  "293":    "Consumer Electronics",
  "11233":  "Jewelry & Watches",
  "550":    "Art",
};

/**
 * Returns the breadcrumb string for a given eBay category ID.
 * Falls back to "Category #<id>" if the ID is not in the map.
 */
export function getEbayCategoryBreadcrumb(categoryId: string | undefined): string {
  if (!categoryId) return "";
  return EBAY_CATEGORY_BREADCRUMBS[categoryId] ?? `Category #${categoryId}`;
}
