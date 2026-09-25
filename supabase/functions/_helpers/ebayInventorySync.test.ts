import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { backfillMissingCategoryIds, syncListingsIntoCache } from "./ebayInventorySync.ts";
import { fetchPrimaryCategoryIds, parsePrimaryCategoryId, tradingApiUrlFor } from "./ebayGetItemCategory.ts";

// Regression coverage for user_active_listings.category_id staying NULL on
// every row (0/570 in production, 2026-09-24). ebay-listings takes its
// Trading API fallback whenever the Inventory API rejects the account, and
// that path returns no category -- and the sync upsert then wrote
// category_id: null over any value already stored.

const listing = (listingId: string, categoryId?: string) => ({
  listingId,
  title: `t${listingId}`,
  price: 1,
  categoryId,
});

// Minimal fake of the one select chain backfillMissingCategoryIds uses.
function fakeCacheLookup(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: async () => result,
        }),
      }),
    }),
  };
}

Deno.test("backfillMissingCategoryIds: looks up only listings missing a category and not already cached", async () => {
  const supabase = fakeCacheLookup({ data: [{ ebay_listing_id: "2" }], error: null });
  let requested: string[] = [];
  const out = await backfillMissingCategoryIds(
    supabase,
    "u1",
    [listing("1", "111"), listing("2"), listing("3")],
    async (ids) => {
      requested = ids;
      return { "3": "333" };
    },
  );
  assertEquals(requested, ["3"]);
  assertEquals(out.map((l) => l.categoryId), ["111", undefined, "333"]);
});

Deno.test("backfillMissingCategoryIds: makes no GetItem calls when every listing already has a category", async () => {
  let called = false;
  const out = await backfillMissingCategoryIds(
    fakeCacheLookup({ data: [], error: null }),
    "u1",
    [listing("1", "111")],
    async () => {
      called = true;
      return {};
    },
  );
  assertEquals(called, false);
  assertEquals(out[0].categoryId, "111");
});

Deno.test("backfillMissingCategoryIds: a failed cache lookup skips the backfill rather than re-fetching every listing", async () => {
  let called = false;
  const input = [listing("1"), listing("2")];
  const out = await backfillMissingCategoryIds(
    fakeCacheLookup({ data: null, error: { message: "boom" } }),
    "u1",
    input,
    async () => {
      called = true;
      return {};
    },
  );
  assertEquals(called, false);
  assertEquals(out, input);
});

// Fake capturing every upsert batch, plus the prune chain that follows it.
function fakeSyncSupabase() {
  const upserts: Record<string, unknown>[][] = [];
  const supabase = {
    from: () => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        upserts.push(rows);
        return { error: null };
      },
      delete: () => ({
        eq: () => ({
          lt: () => ({
            select: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
  return { supabase, upserts };
}

Deno.test("syncListingsIntoCache: rows without a category omit category_id instead of writing null", async () => {
  const { supabase, upserts } = fakeSyncSupabase();
  const res = await syncListingsIntoCache(supabase, "u1", "2026-09-24T00:00:00Z", [
    listing("1", "111"),
    listing("2"),
  ]);
  assertEquals(res.listingCount, 2);
  // Separate batches: a mixed batch would get a union column list from
  // supabase-js and send null for the row that omitted category_id.
  assertEquals(upserts.length, 2);
  assertEquals(upserts[0].map((r) => r.category_id), ["111"]);
  assertEquals(upserts[1].length, 1);
  assertEquals("category_id" in upserts[1][0], false);
});

Deno.test("syncListingsIntoCache: a single batch when every listing has a category", async () => {
  const { supabase, upserts } = fakeSyncSupabase();
  await syncListingsIntoCache(supabase, "u1", "2026-09-24T00:00:00Z", [listing("1", "111"), listing("2", "222")]);
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].map((r) => r.category_id), ["111", "222"]);
});

Deno.test("parsePrimaryCategoryId: reads the CategoryID nested under PrimaryCategory", () => {
  const xml = `<GetItemResponse><Item><ItemID>1</ItemID>
    <PrimaryCategory><CategoryID>39489</CategoryID></PrimaryCategory></Item></GetItemResponse>`;
  assertEquals(parsePrimaryCategoryId(xml), "39489");
});

Deno.test("parsePrimaryCategoryId: undefined when PrimaryCategory is absent", () => {
  assertEquals(parsePrimaryCategoryId("<GetItemResponse><Ack>Failure</Ack></GetItemResponse>"), undefined);
});

Deno.test("fetchPrimaryCategoryIds: omits items whose call failed or had no category", async () => {
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body);
    if (body.includes("<ItemID>bad</ItemID>")) return new Response("err", { status: 500 });
    if (body.includes("<ItemID>none</ItemID>")) return new Response("<Item></Item>", { status: 200 });
    return new Response("<PrimaryCategory><CategoryID>118379</CategoryID></PrimaryCategory>", { status: 200 });
  }) as unknown as typeof fetch;
  const out = await fetchPrimaryCategoryIds(["ok", "bad", "none"], "https://example.com", "tok", fetchFn);
  assertEquals(out, { ok: "118379" });
});

Deno.test("tradingApiUrlFor: picks sandbox vs production from the token URL", () => {
  assertEquals(
    tradingApiUrlFor("https://api.sandbox.ebay.com/identity/v1/oauth2/token"),
    "https://api.sandbox.ebay.com/ws/api.dll",
  );
  assertEquals(tradingApiUrlFor("https://api.ebay.com/identity/v1/oauth2/token"), "https://api.ebay.com/ws/api.dll");
});
