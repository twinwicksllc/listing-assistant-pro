/**
 * Maps eBay category IDs to human-readable breadcrumb strings.
 *
 * The 10 "template categories" below (marked ★) are the ones our seller
 * actively lists in. Their required/preferred aspects are enforced in
 * ebay-publish via CATEGORY_ASPECT_RULES. All other categories fall through
 * to the generic aspect-normalization path, so the app works for any eBay
 * category the AI picks — it just won't apply category-specific validation.
 */
export const EBAY_CATEGORY_BREADCRUMBS: Record<string, string> = {
  // eBay June 2026 mandate parent category IDs (all descendants require conditionDescriptors)
  "253": "Coins & Paper Money > Coins: US", // US Coins parent
  "256": "Coins & Paper Money > Coins: World", // World Coins parent
  "3377": "Coins & Paper Money > Coins: Canada", // Canadian Coins parent
  "4733": "Coins & Paper Money > Coins: Ancient", // Ancient Coins parent
  "18466": "Coins & Paper Money > Coins: Medieval", // Medieval Coins parent

  // ★ Template categories — fully validated in ebay-publish
  "178906": "Coins & Paper Money > Bullion > Gold > Bars & Rounds", // ★ Gold Bars/Rounds
  "39489": "Coins & Paper Money > Bullion > Silver > Bars & Rounds", // ★ Silver Bars/Rounds
  "3361": "Coins & Paper Money > Bullion > Silver > Other", // ★ Other Silver Bullion
  "532": "Coins & Paper Money > Coins: Ancient", // ★ Ancient Coins
  "173685": "Coins & Paper Money > Coins: Medieval", // ★ Medieval Coins
  "11981": "Coins & Paper Money > Coins: US > Dollars > Eisenhower (1971-78)", // ★ Eisenhower
  "39464": "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)", // ★ Morgan Dollar
  "11980": "Coins & Paper Money > Coins: US > Dollars > Peace (1921-35)", // ★ Peace Dollar
  "11971":
    "Coins & Paper Money > Coins: US > Half Dollars > Barber (1892-1915)", // ★ Barber Half
  "41099":
    "Coins & Paper Money > Coins: US > Half Dollars > Liberty Walking (1916-47)", // ★ Liberty Walking Half
  "11973":
    "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)", // ★ Franklin Half (primary AI/ASPECT_RULES ID)
  "41102":
    "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)", // ★ Kennedy Half (primary AI/ASPECT_RULES ID)
  "39455":
    "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)", // ★ Wheat Penny (primary AI/ASPECT_RULES ID)
  "41084":
    "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)", // ★ Indian Head Cent (primary AI/ASPECT_RULES ID)

  // ★ Proof Sets & Mint Sets — leaf categories
  "41109": "Coins & Paper Money > Coins: US > Proof Sets", // ★ US Coin Proof Sets
  "526": "Coins & Paper Money > Coins: US > Mint Sets", // ★ US Coin Mint Sets

  // --- US Coins (general + other series) ---
  // 11116/40150/40152 corrected 2026-09-01: 11116 is the domain ROOT (non-leaf),
  // not a Lincoln Memorial leaf; 40150/40152 have been silently reassigned by
  // eBay to Action Figures / Go-Karts (Recreational) respectively, and are the
  // most dangerous class of stale entry here — a live leaf in the wrong domain
  // is confirmed "valid" by this map with no verification call ever firing.
  // 40151/40153/40158/40159/40160/41111 are simply dead (absent from the live
  // tree); replaced with their live equivalents rather than deleted outright,
  // matching the same corrections already applied in domainPrompts.ts.
  "31373":
    "Coins & Paper Money > Coins: US > Small Cents > Lincoln Memorial (1959-2008)",
  "11118": "Coins & Paper Money > Coins: US > Half Dollars",
  "40149":
    "Coins & Paper Money > Coins: US > Quarters > Washington (1932-1998)",
  "39458": "Coins & Paper Money > Coins: US > Dimes > Roosevelt (1946-Now)",
  "41090": "Coins & Paper Money > Coins: US > Dimes > Mercury (1916-1945)",
  "41087": "Coins & Paper Money > Coins: US > Nickels > Jefferson (1938-Now)",
  "139806": "Coins & Paper Money > Coins: US > Nickels > Buffalo (1913-1938)",
  "40154":
    "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)",
  "40155":
    "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",
  "40156":
    "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",
  "40157":
    "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",
  "11983":
    "Coins & Paper Money > Coins: US > Dollars > Native American (2000-Now)",
  "159713":
    "Coins & Paper Money > Coins: US > Dollars > Presidential (2007-Now)",
  "11982":
    "Coins & Paper Money > Coins: US > Dollars > Susan B Anthony (1979-81,99)",
  "164743":
    "Coins & Paper Money > Coins: US > Quarters > 50 States & Territories",
  // US Quarters — early & classic type leaves (verified against live eBay browse nodes 2026-07)
  "11962": "Coins & Paper Money > Coins: US > Quarters",
  "173587":
    "Coins & Paper Money > Coins: US > Quarters > Draped Bust (1796-1807)",
  "11963":
    "Coins & Paper Money > Coins: US > Quarters > Capped Bust (1815-1838)",
  "11964":
    "Coins & Paper Money > Coins: US > Quarters > Seated Liberty (1838-1891)",
  "11965": "Coins & Paper Money > Coins: US > Quarters > Barber (1892-1916)",
  "11966":
    "Coins & Paper Money > Coins: US > Quarters > Standing Liberty (1916-1930)",
  "39461":
    "Coins & Paper Money > Coins: US > Quarters > Washington (1932-1998)",

  // --- US Gold Coins ---
  // 40161/40162/40163/40166/40167 corrected 2026-09-01: all five were dead
  // (absent from the live tree). 40166/40167 (American Gold Eagle/Buffalo)
  // have no distinct live leaf and are not re-added — they already route to
  // the generic bullion-gold-coin leaf 177652 below, same as domainPrompts.ts.
  "39472":
    "Coins & Paper Money > Coins: US > Gold (Pre-1933) > $20, Double Eagle",
  "39471": "Coins & Paper Money > Coins: US > Gold (Pre-1933) > $10, Eagle",
  "39470": "Coins & Paper Money > Coins: US > Gold (Pre-1933) > $5, Half Eagle",
  "40164": "Coins & Paper Money > Coins: US > Gold Coins > $2.50 Quarter Eagle",
  "40165": "Coins & Paper Money > Coins: US > Gold Coins > $1 Gold",

  // --- Bullion (other) ---
  "3360": "Coins & Paper Money > Bullion > Gold > Other", // For grain bars, flakes, nuggets
  "177652": "Coins & Paper Money > Bullion > Gold > Coins", // Gold bullion coins (AI prompt ID)
  "177653": "Coins & Paper Money > Bullion > Silver > Coins", // Silver bullion coins (AI prompt ID)
  // 261064/261068/261069/261070/261071 removed 2026-09-01: all five are live
  // leaves, but in the WRONG domain (Signs & Plaques and four Action Figures
  // variants under Toys & Hobbies) — the most dangerous class of stale entry,
  // since they'd confirm as "valid" with no live check ever firing. 261072
  // onward are confirmed non-leaf/absent parent markers, same as 261074-076
  // below, and are left as-is per the same precedent leafCategoryGuard.ts sets.
  "261072": "Coins & Paper Money > Bullion > Platinum > Bars & Rounds",
  "261073": "Coins & Paper Money > Bullion > Palladium",
  "261074": "Coins & Paper Money > Bullion > Silver",
  "261075": "Coins & Paper Money > Bullion > Gold",
  "261076": "Coins & Paper Money > Bullion",

  // --- Bullion > Other (copper, misc) ---
  "166679": "Coins & Paper Money > Bullion > Other",
  // 166680/166681 corrected 2026-09-01: were mislabeled as Copper Bullion
  // (166679 above already correctly holds that); these two IDs are actually
  // Paper Money: World > Asia > Cambodia / Hong Kong.
  "166680": "Coins & Paper Money > Paper Money: World > Asia > Cambodia",
  "166681": "Coins & Paper Money > Paper Money: World > Asia > Hong Kong",

  // --- World Coins ---
  // 45243/40196-40201 corrected 2026-09-01 (Finding B, already fixed in
  // domainPrompts.ts and leafCategoryGuard.ts): all six were dead, replaced
  // with their documented live equivalents.
  "257": "Coins & Paper Money > Coins: World > Other Coins of the World",
  "536": "Coins & Paper Money > Coins: Canada > Other Canadian Coins",
  "173631":
    "Coins & Paper Money > Coins: World > North & Central America > Mexico > Mexico (1905-Now)",
  "3406":
    "Coins & Paper Money > Coins: World > Europe > UK (Great Britain) > Crown",
  "535":
    "Coins & Paper Money > Coins: World > Australia & Oceania > Australia > Other Australian Coins",
  "7955":
    "Coins & Paper Money > Coins: World > Europe > Germany > West & Unified (1949-Now)",
  "539": "Coins & Paper Money > Coins: World > Europe > France",
  "40202": "Coins & Paper Money > Coins: World > Other",
  "11063": "Coins & Paper Money > Coins: World > Asia",

  // --- Paper Money ---
  "3411": "Coins & Paper Money > Paper Money: US",
  "45244": "Coins & Paper Money > Paper Money: World",

  // --- Exonumia / Tokens ---
  "19167": "Coins & Paper Money > Exonumia > Tokens",
  "19168": "Coins & Paper Money > Exonumia > Medals",
  "19169": "Coins & Paper Money > Exonumia > Elongated Coins",

  // --- General Collectibles ---
  "1": "Collectibles",
  "237": "Collectibles > Decorative Collectibles",
  "870": "Collectibles > Militaria",
  "11450": "Clothing, Shoes & Accessories",
  "293": "Consumer Electronics",
  "11233": "Jewelry & Watches",
  "550": "Art",

  // ─── Trading Cards ───────────────────────────────────────────────────────
  // 183454 corrected 2026-09-01: previously labeled "Pokémon > Individual
  // Cards" — the live taxonomy has no per-game leaf at all (game/franchise
  // is an item aspect, not a category); this is the one generic leaf for
  // any collectible card game.
  "183454": "Toys & Hobbies > Collectible Card Games > CCG Individual Cards",
  "2536":
    "Toys & Hobbies > Collectible Card Games > Magic: The Gathering > Individual Cards",
  "61793":
    "Toys & Hobbies > Collectible Card Games > Yu-Gi-Oh > Individual Cards",
  "45643": "Toys & Hobbies > Collectible Card Games > Other CCG Items",
  "213": "Sports Trading Cards > Mixed Sports Card Lots",
  "214": "Sports Trading Cards > Graded Cards",
  // 261328-261332 corrected 2026-09-01: previously labeled sport-specific
  // (Baseball/Football/Basketball/Hockey/Soccer Cards) — same reasoning as
  // 183454 above, the live taxonomy captures sport as an item aspect, not
  // a category; these five IDs are actually generic format leaves (already
  // flagged as a known, deliberately-unfixed issue in
  // ebay-category-map-freshness.test.ts's own comments until now).
  "261328": "Sports Trading Cards > Trading Card Singles",
  "261329": "Sports Trading Cards > Trading Card Lots",
  "261330": "Sports Trading Cards > Trading Card Sets",
  "261331": "Sports Trading Cards > Sealed Trading Card Packs",
  "261332": "Sports Trading Cards > Sealed Trading Card Boxes",
  "98716": "Sports Trading Cards > Graded Cards > BGS",

  // ─── Jewelry & Watches ───────────────────────────────────────────────────
  "67742": "Jewelry & Watches > Fine Jewelry > Rings",
  "10978": "Jewelry & Watches > Fashion Jewelry > Rings",
  "164316": "Jewelry & Watches > Fine Jewelry > Necklaces & Pendants",
  "137835": "Jewelry & Watches > Fashion Jewelry > Necklaces & Pendants",
  "10979": "Jewelry & Watches > Fine Jewelry > Bracelets",
  "10980": "Jewelry & Watches > Fashion Jewelry > Bracelets",
  "10968": "Jewelry & Watches > Fine Jewelry > Earrings",
  "56168": "Jewelry & Watches > Fashion Jewelry > Earrings",
  "9531": "Jewelry & Watches > Fine Jewelry > Brooches & Pins",
  "98764":
    "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches > Men's",
  "31387":
    "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches > Women's",
  "14324": "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches",
  "3937": "Jewelry & Watches > Watches, Parts & Accessories > Pocket Watches",
  "48579": "Jewelry & Watches > Vintage & Antique Jewelry",

  // ─── Electronics ─────────────────────────────────────────────────────────
  "9355": "Cell Phones & Accessories > Cell Phones & Smartphones",
  "9394": "Cell Phones & Accessories > Other Cell Phone Accessories",
  "177": "Computers/Tablets & Networking > Laptops & Netbooks",
  "171485": "Computers/Tablets & Networking > iPads, Tablets & eBook Readers",
  "179": "Computers/Tablets & Networking > Desktop Computers",
  "80053": "Computers/Tablets & Networking > Monitors",
  "11071": "Consumer Electronics > TV, Video & Home Audio > TVs",
  "25321": "Consumer Electronics > TV, Video & Home Audio > Projectors",
  "31388": "Cameras & Photo > Digital Cameras",
  "3329": "Cameras & Photo > Lenses & Filters",
  "112529": "Consumer Electronics > Portable Audio & Headphones > Headphones",
  "14969":
    "Consumer Electronics > Portable Audio & Headphones > Portable Speakers & Docks",
  "178893": "Consumer Electronics > Smart Watches",
  "139971": "Video Games & Consoles > Video Game Consoles > Xbox One",
  "309966": "Video Games & Consoles > Video Game Consoles > PlayStation 5",
  "117042": "Video Games & Consoles > Video Game Consoles > Nintendo Switch",
  "139973": "Video Games & Consoles > Video Games",

  // ─── Clothing, Shoes & Accessories ───────────────────────────────────────
  "57988":
    "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Coats & Jackets",
  "57989":
    "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Pants",
  "57990":
    "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Suits",
  "57991":
    "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Shirts",
  "63861":
    "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Dresses",
  "63862":
    "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Tops",
  "63863":
    "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Coats & Jackets",
  "11554":
    "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Skirts",
  "15687":
    "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Clothing > T-Shirts",
  "63852":
    "Clothing, Shoes & Accessories > Vintage > Women's Vintage Accessories > Handbags",
  "52365":
    "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Hats & Caps",
  "45238":
    "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Scarves",
  "2993":
    "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Belts",
  "1059": "Clothing, Shoes & Accessories > Men's Clothing > Shirts",
  "185100": "Clothing, Shoes & Accessories > Women's Clothing > Dresses",

  // ─── Books (mapped so wrong-category bugs are visible in breadcrumb display) ─
  "261186": "Books & Magazines > Books",
  "268": "Books & Magazines",
};

/**
 * The 10 template categories our seller uses, with their correct eBay IDs.
 * Used by the UI to highlight known categories.
 */
export const TEMPLATE_CATEGORY_IDS = new Set([
  "178906", // Gold Bars & Rounds
  "39489", // Silver Bars & Rounds
  "3361", // Other Silver Bullion
  "532", // Ancient Coins
  "173685", // Medieval Coins
  "11981", // Eisenhower Dollars
  "39464", // Morgan Dollars
  "11980", // Peace Dollars
  "11971", // Barber Half Dollars
  "41099", // Liberty Walking Half Dollars
  "41109", // US Coin Proof Sets
  "526", // US Coin Mint Sets
]);

/**
 * Returns the breadcrumb string for a given eBay category ID.
 * Falls back to "Category #<id>" if the ID is not in the map.
 */
export function getEbayCategoryBreadcrumb(
  categoryId: string | undefined,
): string {
  if (!categoryId) return "";
  return EBAY_CATEGORY_BREADCRUMBS[categoryId] ?? `Category #${categoryId}`;
}

/**
 * Returns true if this is one of our 10 fully-validated template categories.
 */
export function isTemplateCategory(categoryId: string | undefined): boolean {
  if (!categoryId) return false;
  return TEMPLATE_CATEGORY_IDS.has(categoryId);
}
