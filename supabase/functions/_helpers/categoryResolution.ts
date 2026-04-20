import type { Domain } from "./pipelineContracts.ts";

const COINS_PAPER_MONEY_IDS = new Set([
  // Bullion
  "178906",
  "39489",
  "177652",
  "177653",
  "166679",
  "3361",
  "3360",
  "261064",
  "261068",
  "261069",
  "261070",
  "261071",
  "261072",
  "261073",
  "261074",
  "261075",
  "261076",
  "166680",
  "166681",
  // US Coins
  "253",
  "39464",
  "11980",
  "11981",
  "41102",
  "11973",
  "41099",
  "11971",
  "39455",
  "41084",
  "41109",
  "526",
  "11116",
  "11118",
  "40149",
  "40150",
  "40151",
  "40152",
  "40153",
  "40154",
  "40155",
  "40156",
  "40157",
  "40158",
  "40159",
  "40160",
  "41111",
  "164743",
  // US Gold Coins
  "40161",
  "40162",
  "40163",
  "40164",
  "40165",
  "40166",
  "40167",
  // World Coins
  "45243",
  "40196",
  "40197",
  "40198",
  "40199",
  "40200",
  "40201",
  "40202",
  "11063",
  // Paper Money
  "3411",
  "45244",
  // Ancient / Medieval
  "532",
  "173685",
  // Exonumia
  "19167",
  "19168",
  "19169",
]);

const KNOWN_WRONG_DOMAIN_FOR_COINS = new Set([
  "261186", // Books & Magazines > Books
  "268", // Books & Magazines (parent)
  "9355",
  "112529",
  "177",
  "179", // Electronics
  "11450", // Clothing
  "550", // Art
  "1", // Collectibles (too broad)
]);

const KNOWN_PARENT_CATEGORIES = new Set([
  "253",
  "11118",
  "11233",
  "261076",
  "261074",
  "261075",
  "293",
  "1",
  "550",
  "631",
  "20713",
  "11450",
  "64482",
  "220",
]);

export function isCoinDomainCategory(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  breadcrumb: string | null | undefined,
): boolean {
  if (!categoryId) return false;

  const categoryText = `${categoryName || ""} ${breadcrumb || ""}`
    .toLowerCase();

  if (
    /(coins?\b|paper money|bullion|exonumia|ancient|medieval|numis)/i.test(
      categoryText,
    )
  ) {
    return true;
  }

  return ["45243", "532", "173685"].includes(categoryId);
}

export function isCategoryCompatibleWithDomain(
  domain: Domain | string | null | undefined,
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  breadcrumb: string | null | undefined,
): boolean {
  if (!domain || !categoryId) return true;

  switch (domain) {
    case "coins_bullion":
      return isCoinDomainCategory(categoryId, categoryName, breadcrumb);
    default:
      return true;
  }
}

export function isKnownParentCategory(categoryId: string | null | undefined): boolean {
  if (!categoryId) return false;
  return KNOWN_PARENT_CATEGORIES.has(categoryId);
}

export function isCoinDomainMismatch(
  domain: Domain | string | null | undefined,
  categoryId: string | null | undefined,
  postLookupBreadcrumb: string | null | undefined,
): boolean {
  if (domain !== "coins_bullion" || !categoryId) return false;

  return !COINS_PAPER_MONEY_IDS.has(categoryId) &&
    (KNOWN_WRONG_DOMAIN_FOR_COINS.has(categoryId) ||
      (postLookupBreadcrumb || "").toLowerCase().includes("coins"));
}

export function shouldForceWorldCoinsFallback(
  domain: Domain | string | null | undefined,
  categoryId: string | null | undefined,
): boolean {
  if (domain !== "coins_bullion" || !categoryId) return false;

  if (["261186", "268"].includes(categoryId)) return true;

  const looksCoinLikeRange = /^(3[0-9]|4[0-9]|1[0-9]|2[0-9]|45243|532|173685)/
    .test(categoryId);

  return !looksCoinLikeRange && parseInt(categoryId, 10) > 200000;
}
