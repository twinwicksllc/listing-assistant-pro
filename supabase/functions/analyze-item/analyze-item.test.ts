import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  isCategoryCompatibleWithDomain,
  isCoinDomainCategory,
  isKnownWrongDomainForAutoParts,
  isKnownWrongDomainForJewelry,
  isKnownWrongDomainForSneakers,
} from "./index.ts";

// Regression coverage for Phase 2.5 of the misclassification-fix plan: the
// jewelry/general branch of isCategoryCompatibleWithDomain had zero checking
// (default: return true) unlike the existing coins_bullion/sneakers/auto_parts
// guardrails. This is the "ring called a book" misclassification's category-
// compatibility safety net.

// ── isKnownWrongDomainForJewelry ──────────────────────────────────────────

Deno.test("isKnownWrongDomainForJewelry: flags known-wrong breadcrumbs", () => {
  assertEquals(isKnownWrongDomainForJewelry("Books", null), true);
  assertEquals(isKnownWrongDomainForJewelry(null, "Books & Magazines"), true);
  assertEquals(isKnownWrongDomainForJewelry("Coins & Paper Money", null), true);
  assertEquals(isKnownWrongDomainForJewelry("Trading Cards", null), true);
  assertEquals(isKnownWrongDomainForJewelry("Action Figures", null), true);
});

Deno.test("isKnownWrongDomainForJewelry: permissive on legitimate/ambiguous jewelry breadcrumbs", () => {
  assertEquals(isKnownWrongDomainForJewelry("Rings", "Fine Jewelry > Rings"), false);
  assertEquals(isKnownWrongDomainForJewelry("Jewelry & Watches", null), false);
  assertEquals(isKnownWrongDomainForJewelry("Collectibles", null), false);
});

Deno.test("isKnownWrongDomainForJewelry: permissive default when both inputs are null/undefined", () => {
  assertEquals(isKnownWrongDomainForJewelry(null, null), false);
  assertEquals(isKnownWrongDomainForJewelry(undefined, undefined), false);
});

// ── isCategoryCompatibleWithDomain ────────────────────────────────────────

Deno.test("isCategoryCompatibleWithDomain: the ring-called-a-book scenario returns false", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("jewelry", "170", "Books", null),
    false,
  );
});

Deno.test("isCategoryCompatibleWithDomain: jewelry domain with a legitimate jewelry category returns true", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("jewelry", "10990", "Rings", "Fine Jewelry > Rings"),
    true,
  );
});

Deno.test("isCategoryCompatibleWithDomain: general domain is unchanged (default: true) for any category", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("general", "170", "Books", null),
    true,
  );
  assertEquals(
    isCategoryCompatibleWithDomain("general", "999999", "Anything At All", "Whatever > Breadcrumb"),
    true,
  );
});

Deno.test("isCategoryCompatibleWithDomain: coins_bullion still delegates to isCoinDomainCategory", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("coins_bullion", "3392", "Coins: World", "Coins & Paper Money > Coins: World"),
    isCoinDomainCategory("3392", "Coins: World", "Coins & Paper Money > Coins: World"),
  );
  assertEquals(
    isCategoryCompatibleWithDomain("coins_bullion", "3392", "Coins: World", "Coins & Paper Money > Coins: World"),
    true,
  );
  assertEquals(
    isCategoryCompatibleWithDomain("coins_bullion", "12345", "Action Figures", "Toys > Action Figures"),
    false,
  );
});

Deno.test("isCategoryCompatibleWithDomain: sneakers still delegates to isKnownWrongDomainForSneakers", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("sneakers", "15709", "Action Figures", null),
    !isKnownWrongDomainForSneakers("Action Figures", null),
  );
  assertEquals(
    isCategoryCompatibleWithDomain("sneakers", "15709", "Action Figures", null),
    false,
  );
  assertEquals(
    isCategoryCompatibleWithDomain("sneakers", "15709", "Athletic Shoes", "Clothing > Shoes > Athletic Shoes"),
    true,
  );
});

Deno.test("isCategoryCompatibleWithDomain: auto_parts still delegates to isKnownWrongDomainForAutoParts", () => {
  assertEquals(
    isCategoryCompatibleWithDomain("auto_parts", "6030", "Electronics", null),
    !isKnownWrongDomainForAutoParts("Electronics", null),
  );
  assertEquals(
    isCategoryCompatibleWithDomain("auto_parts", "6030", "Electronics", null),
    false,
  );
  assertEquals(
    isCategoryCompatibleWithDomain("auto_parts", "6030", "Car & Truck Parts", "eBay Motors > Car & Truck Parts"),
    true,
  );
});
