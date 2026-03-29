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

  // ★ Template categories — fully validated in ebay-publish
  "178906": "Coins & Paper Money > Bullion > Gold > Bars & Rounds",            // ★ Gold Bars/Rounds
  "39489":  "Coins & Paper Money > Bullion > Silver > Bars & Rounds",          // ★ Silver Bars/Rounds
  "3361":   "Coins & Paper Money > Bullion > Silver > Other",                  // ★ Other Silver Bullion
  "532":    "Coins & Paper Money > Coins: Ancient",                             // ★ Ancient Coins
  "173685": "Coins & Paper Money > Coins: Medieval",                           // ★ Medieval Coins
  "11981":  "Coins & Paper Money > Coins: US > Dollars > Eisenhower (1971-78)",// ★ Eisenhower
  "39464":  "Coins & Paper Money > Coins: US > Dollars > Morgan (1878-1921)",  // ★ Morgan Dollar
  "11980":  "Coins & Paper Money > Coins: US > Dollars > Peace (1921-35)",     // ★ Peace Dollar
  "11971":  "Coins & Paper Money > Coins: US > Half Dollars > Barber (1892-1915)", // ★ Barber Half
  "41099":  "Coins & Paper Money > Coins: US > Half Dollars > Liberty Walking (1916-47)", // ★ Liberty Walking Half
  "11973":  "Coins & Paper Money > Coins: US > Half Dollars > Franklin (1948-1963)",      // ★ Franklin Half (primary AI/ASPECT_RULES ID)
  "41102":  "Coins & Paper Money > Coins: US > Half Dollars > Kennedy (1964-Now)",        // ★ Kennedy Half (primary AI/ASPECT_RULES ID)
  "39455":  "Coins & Paper Money > Coins: US > Pennies > Lincoln Wheat (1909-1958)",      // ★ Wheat Penny (primary AI/ASPECT_RULES ID)
  "41084":  "Coins & Paper Money > Coins: US > Pennies > Indian Head (1859-1909)",        // ★ Indian Head Cent (primary AI/ASPECT_RULES ID)

  // ★ Proof Sets & Mint Sets — leaf categories
  "41109":  "Coins & Paper Money > Coins: US > Proof Sets",                 // ★ US Coin Proof Sets
  "526":    "Coins & Paper Money > Coins: US > Mint Sets",                   // ★ US Coin Mint Sets

  // --- US Coins (general + other series) ---
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

  // --- US Gold Coins ---
  "40161":  "Coins & Paper Money > Coins: US > Gold Coins > $20 Double Eagle",
  "40162":  "Coins & Paper Money > Coins: US > Gold Coins > $10 Eagle",
  "40163":  "Coins & Paper Money > Coins: US > Gold Coins > $5 Half Eagle",
  "40164":  "Coins & Paper Money > Coins: US > Gold Coins > $2.50 Quarter Eagle",
  "40165":  "Coins & Paper Money > Coins: US > Gold Coins > $1 Gold",
  "40166":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Eagle",
  "40167":  "Coins & Paper Money > Coins: US > Gold Coins > American Gold Buffalo",

  // --- Bullion (other) ---
  "3360": "Coins & Paper Money > Bullion > Gold > Other",  // For grain bars, flakes, nuggets
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

  // --- Bullion > Other (copper, misc) ---
  "166679": "Coins & Paper Money > Bullion > Other",
  "166680": "Coins & Paper Money > Bullion > Other > Copper > Bars & Rounds",
  "166681": "Coins & Paper Money > Bullion > Other > Copper > Coins",

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

  // ─── Trading Cards ───────────────────────────────────────────────────────
  "183454": "Toys & Hobbies > Collectible Card Games > Pokémon > Individual Cards",
  "2536":   "Toys & Hobbies > Collectible Card Games > Magic: The Gathering > Individual Cards",
  "61793":  "Toys & Hobbies > Collectible Card Games > Yu-Gi-Oh > Individual Cards",
  "45643":  "Toys & Hobbies > Collectible Card Games > Other CCG Items",
  "213":    "Sports Trading Cards > Mixed Sports Card Lots",
  "214":    "Sports Trading Cards > Graded Cards",
  "261328": "Sports Trading Cards > Baseball Cards",
  "261329": "Sports Trading Cards > Football Cards",
  "261330": "Sports Trading Cards > Basketball Cards",
  "261331": "Sports Trading Cards > Hockey Cards",
  "261332": "Sports Trading Cards > Soccer Cards",
  "98716":  "Sports Trading Cards > Graded Cards > BGS",

  // ─── Jewelry & Watches ───────────────────────────────────────────────────
  "67742":  "Jewelry & Watches > Fine Jewelry > Rings",
  "10978":  "Jewelry & Watches > Fashion Jewelry > Rings",
  "164316": "Jewelry & Watches > Fine Jewelry > Necklaces & Pendants",
  "137835": "Jewelry & Watches > Fashion Jewelry > Necklaces & Pendants",
  "10979":  "Jewelry & Watches > Fine Jewelry > Bracelets",
  "10980":  "Jewelry & Watches > Fashion Jewelry > Bracelets",
  "10968":  "Jewelry & Watches > Fine Jewelry > Earrings",
  "56168":  "Jewelry & Watches > Fashion Jewelry > Earrings",
  "9531":   "Jewelry & Watches > Fine Jewelry > Brooches & Pins",
  "98764":  "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches > Men's",
  "31387":  "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches > Women's",
  "14324":  "Jewelry & Watches > Watches, Parts & Accessories > Wristwatches",
  "3937":   "Jewelry & Watches > Watches, Parts & Accessories > Pocket Watches",
  "48579":  "Jewelry & Watches > Vintage & Antique Jewelry",

  // ─── Electronics ─────────────────────────────────────────────────────────
  "9355":   "Cell Phones & Accessories > Cell Phones & Smartphones",
  "9394":   "Cell Phones & Accessories > Other Cell Phone Accessories",
  "177":    "Computers/Tablets & Networking > Laptops & Netbooks",
  "171485": "Computers/Tablets & Networking > iPads, Tablets & eBook Readers",
  "179":    "Computers/Tablets & Networking > Desktop Computers",
  "80053":  "Computers/Tablets & Networking > Monitors",
  "11071":  "Consumer Electronics > TV, Video & Home Audio > TVs",
  "25321":  "Consumer Electronics > TV, Video & Home Audio > Projectors",
  "31388":  "Cameras & Photo > Digital Cameras",
  "3329":   "Cameras & Photo > Lenses & Filters",
  "112529": "Consumer Electronics > Portable Audio & Headphones > Headphones",
  "14969":  "Consumer Electronics > Portable Audio & Headphones > Portable Speakers & Docks",
  "178893": "Consumer Electronics > Smart Watches",
  "139971": "Video Games & Consoles > Video Game Consoles > Xbox One",
  "309966": "Video Games & Consoles > Video Game Consoles > PlayStation 5",
  "117042": "Video Games & Consoles > Video Game Consoles > Nintendo Switch",
  "139973": "Video Games & Consoles > Video Games",

  // ─── Clothing, Shoes & Accessories ───────────────────────────────────────
  "57988":  "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Coats & Jackets",
  "57989":  "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Pants",
  "57990":  "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Suits",
  "57991":  "Clothing, Shoes & Accessories > Vintage > Men's Vintage Clothing > Shirts",
  "63861":  "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Dresses",
  "63862":  "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Tops",
  "63863":  "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Coats & Jackets",
  "11554":  "Clothing, Shoes & Accessories > Vintage > Women's Vintage Clothing > Skirts",
  "15687":  "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Clothing > T-Shirts",
  "63852":  "Clothing, Shoes & Accessories > Vintage > Women's Vintage Accessories > Handbags",
  "52365":  "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Hats & Caps",
  "45238":  "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Scarves",
  "2993":   "Clothing, Shoes & Accessories > Vintage > Unisex Vintage Accessories > Belts",
  "1059":   "Clothing, Shoes & Accessories > Men's Clothing > Shirts",
  "185100": "Clothing, Shoes & Accessories > Women's Clothing > Dresses",
};

/**
 * The 10 template categories our seller uses, with their correct eBay IDs.
 * Used by the UI to highlight known categories.
 */
export const TEMPLATE_CATEGORY_IDS = new Set([
  "178906", // Gold Bars & Rounds
  "39489",  // Silver Bars & Rounds
  "3361",   // Other Silver Bullion
  "532",    // Ancient Coins
  "173685", // Medieval Coins
  "11981",  // Eisenhower Dollars
  "39464",  // Morgan Dollars
  "11980",  // Peace Dollars
  "11971",  // Barber Half Dollars
  "41099",  // Liberty Walking Half Dollars
  "41109",  // US Coin Proof Sets
  "526",    // US Coin Mint Sets
]);

/**
 * Returns the breadcrumb string for a given eBay category ID.
 * Falls back to "Category #<id>" if the ID is not in the map.
 */
export function getEbayCategoryBreadcrumb(categoryId: string | undefined): string {
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