import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createConditionPolicyCache } from "./conditionPolicyCache.ts";

Deno.test("condition policy cache reuses in-flight and resolved policies per seller/category", async () => {
  const loaded: string[] = [];
  const getPolicy = createConditionPolicyCache(async (categoryId, sellerUserId) => {
    loaded.push(`${sellerUserId}/${categoryId}`);
    return { categoryId, sellerUserId };
  });

  const first = getPolicy("261994", "seller-a");
  const duplicate = getPolicy("261994", "seller-a");
  assertEquals(first, duplicate);
  assertEquals(await first, { categoryId: "261994", sellerUserId: "seller-a" });
  assertEquals(await getPolicy("261994", "seller-a"), await first);
  await getPolicy("261994", "seller-b");
  await getPolicy("3377", "seller-a");
  assertEquals(loaded, ["seller-a/261994", "seller-b/261994", "seller-a/3377"]);
});
