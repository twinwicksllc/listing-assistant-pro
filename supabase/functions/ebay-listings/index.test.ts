import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { fetchWatchDataForListings } from "./index.ts";

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
