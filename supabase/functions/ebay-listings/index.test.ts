import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { fetchKnownSkusForUser, fetchWatchDataForListings } from "./index.ts";

// Regression coverage: user_active_listings.category_id was NULL for every
// row in production (560/560) because the Inventory API's bulk offer-LIST
// endpoint (GET /sell/inventory/v1/offer, used in ebay-listings' main path)
// frequently omits `categoryId` on offers created via Seller Hub/bulk/legacy
// flows -- a real eBay API quirk, not guaranteed on that endpoint's response
// schema. fetchWatchDataForListings' GetItem call (already made for every
// listing to fetch WatchCount/QuestionCount/Description) was extended to also
// read <PrimaryCategory><CategoryID> as a zero-extra-call fallback source.
// eBay nests category info under PrimaryCategory, not a bare top-level
// CategoryID tag -- these tests pin that nested shape.

function withMockedFetch<T>(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch =
    ((url: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(url), init))) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("fetchWatchDataForListings: requests the whole PrimaryCategory node, not a dotted child path", async () => {
  // Regression for 2026-09-25: OutputSelector only recognizes whole node
  // names -- "PrimaryCategory.CategoryID" was silently ignored by eBay
  // (Ack:Success, but no PrimaryCategory node in the response at all), so
  // this fallback has likely never actually returned a category since it
  // shipped. Same bug/fix as _helpers/ebayGetItemCategory.ts.
  let requestBody = "";
  await withMockedFetch(
    (_url, init) => {
      requestBody = String(init?.body);
      return new Response("<GetItemResponse><Ack>Success</Ack><Item></Item></GetItemResponse>", { status: 200 });
    },
    async () => {
      await fetchWatchDataForListings(["1"], "https://api.ebay.com/ws/api.dll", "fake-token");
    },
  );
  assertEquals(
    requestBody.includes(
      "<OutputSelector>ItemID,WatchCount,QuestionCount,Description,PrimaryCategory</OutputSelector>",
    ),
    true,
  );
  assertEquals(requestBody.includes("PrimaryCategory.CategoryID"), false);
});

Deno.test("fetchWatchDataForListings: extracts categoryId nested under PrimaryCategory", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse>
  <Ack>Success</Ack>
  <Item>
    <ItemID>110123456789</ItemID>
    <WatchCount>4</WatchCount>
    <QuestionCount>1</QuestionCount>
    <PrimaryCategory>
      <CategoryID>261328</CategoryID>
      <CategoryName>Coins &amp; Paper Money</CategoryName>
    </PrimaryCategory>
  </Item>
</GetItemResponse>`;

  await withMockedFetch(
    () => new Response(xml, { status: 200 }),
    async () => {
      const result = await fetchWatchDataForListings(
        ["110123456789"],
        "https://api.ebay.com/ws/api.dll",
        "fake-token",
      );
      assertEquals(result["110123456789"].categoryId, "261328");
      assertEquals(result["110123456789"].watchCount, 4);
      assertEquals(result["110123456789"].questionCount, 1);
    },
  );
});

Deno.test("fetchWatchDataForListings: categoryId is undefined (not empty string) when PrimaryCategory is absent", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse>
  <Ack>Success</Ack>
  <Item>
    <ItemID>110987654321</ItemID>
    <WatchCount>0</WatchCount>
    <QuestionCount>0</QuestionCount>
  </Item>
</GetItemResponse>`;

  await withMockedFetch(
    () => new Response(xml, { status: 200 }),
    async () => {
      const result = await fetchWatchDataForListings(
        ["110987654321"],
        "https://api.ebay.com/ws/api.dll",
        "fake-token",
      );
      assertEquals(result["110987654321"].categoryId, undefined);
    },
  );
});

Deno.test("fetchWatchDataForListings: existing watchCount/questionCount/description extraction is unaffected by the categoryId addition", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse>
  <Ack>Success</Ack>
  <Item>
    <ItemID>110555555555</ItemID>
    <WatchCount>12</WatchCount>
    <QuestionCount>3</QuestionCount>
    <Description>A lovely widget.</Description>
    <PrimaryCategory>
      <CategoryID>9355</CategoryID>
    </PrimaryCategory>
  </Item>
</GetItemResponse>`;

  await withMockedFetch(
    () => new Response(xml, { status: 200 }),
    async () => {
      const result = await fetchWatchDataForListings(
        ["110555555555"],
        "https://api.ebay.com/ws/api.dll",
        "fake-token",
      );
      assertEquals(result["110555555555"].watchCount, 12);
      assertEquals(result["110555555555"].questionCount, 3);
      assertEquals(result["110555555555"].description, "A lovely widget.");
      assertEquals(result["110555555555"].categoryId, "9355");
    },
  );
});

// Regression coverage for the account-wide bulk-offer-list failure
// (2026-09-25): a single hyphenated SKU (errorId 25707) fails
// GET /sell/inventory/v1/offer for the whole account. fetchKnownSkusForUser
// sources the per-SKU enumeration's SKU list from drafts.ebay_sku (this
// app's own record of every SKU it has generated for a published draft),
// so per-SKU lookups don't depend on the broken bulk call at all.

Deno.test("fetchKnownSkusForUser: returns each published draft's SKU", async () => {
  await withMockedFetch(
    (url) => {
      // publish_status filter and non-null ebay_sku filter must both be present.
      const parsed = new URL(url);
      assertEquals(parsed.searchParams.get("publish_status"), "eq.published");
      assertEquals(parsed.searchParams.get("ebay_sku"), "not.is.null");
      return new Response(
        JSON.stringify([{ ebay_sku: "LA00001" }, { ebay_sku: "LA00002" }]),
        { status: 200 },
      );
    },
    async () => {
      const skus = await fetchKnownSkusForUser("https://x.supabase.co", "svc-key", "user-1");
      assertEquals(skus, ["LA00001", "LA00002"]);
    },
  );
});

Deno.test("fetchKnownSkusForUser: returns an empty list (not a throw) on a failed query", async () => {
  await withMockedFetch(
    () => new Response("server error", { status: 500 }),
    async () => {
      const skus = await fetchKnownSkusForUser("https://x.supabase.co", "svc-key", "user-1");
      assertEquals(skus, []);
    },
  );
});

Deno.test("fetchKnownSkusForUser: returns an empty list on an unparseable response", async () => {
  await withMockedFetch(
    () => new Response("not json", { status: 200 }),
    async () => {
      const skus = await fetchKnownSkusForUser("https://x.supabase.co", "svc-key", "user-1");
      assertEquals(skus, []);
    },
  );
});

Deno.test("fetchKnownSkusForUser: pages past PostgREST's 1,000-row cap instead of silently truncating", async () => {
  // Regression for the Copilot review on PR #631: a select() with no
  // pagination stops at 1,000 rows -- a user with more published drafts
  // than that would lose SKUs past the cap without paging.
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ ebay_sku: `LA${i}` }));
  const page2 = [{ ebay_sku: "LA1000" }, { ebay_sku: "LA1001" }];
  let calls = 0;
  await withMockedFetch(
    (url) => {
      const parsed = new URL(url);
      assertEquals(parsed.searchParams.get("limit"), "1000");
      const offset = parsed.searchParams.get("offset");
      calls++;
      if (offset === "0") return new Response(JSON.stringify(page1), { status: 200 });
      if (offset === "1000") return new Response(JSON.stringify(page2), { status: 200 });
      throw new Error(`unexpected offset: ${offset}`);
    },
    async () => {
      const skus = await fetchKnownSkusForUser("https://x.supabase.co", "svc-key", "user-1");
      assertEquals(skus.length, 1002);
      assertEquals(skus[0], "LA0");
      assertEquals(skus[1001], "LA1001");
      assertEquals(calls, 2);
    },
  );
});
