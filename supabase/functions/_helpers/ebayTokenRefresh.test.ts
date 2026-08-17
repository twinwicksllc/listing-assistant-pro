import { assertEquals, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshEbayAccessToken } from "./ebayTokenRefresh.ts";

const FAKE_CONFIG = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  tokenUrl: "https://example.com/oauth2/token",
};

function fakeSupabase(onUpdate?: (table: string, patch: any) => void) {
  return {
    from: (table: string) => ({
      update: (patch: any) => ({
        eq: async (_col: string, _val: string) => {
          onUpdate?.(table, patch);
          return { error: null };
        },
      }),
    }),
  };
}

Deno.test("refreshEbayAccessToken: success returns the new token and persists it", async () => {
  let persistedTable: string | undefined;
  let persistedPatch: Record<string, unknown> | undefined;
  const supabase = fakeSupabase((table, patch) => {
    persistedTable = table;
    persistedPatch = patch;
  });

  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 7200,
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const result = await refreshEbayAccessToken(
    supabase,
    "user-123",
    "old-refresh-token",
    { ...FAKE_CONFIG, fetchFn },
  );

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.accessToken, "new-access-token");
    // Roughly 2 hours out (7200s), within a few seconds of test execution time.
    const expiresInMs = new Date(result.expiresAt).getTime() - Date.now();
    assertEquals(expiresInMs > 7100 * 1000 && expiresInMs <= 7200 * 1000, true);
  }
  assertEquals(persistedTable, "profiles");
  assertEquals(persistedPatch?.ebay_access_token, "new-access-token");
  assertEquals(persistedPatch?.ebay_refresh_token, "new-refresh-token");
});

Deno.test("refreshEbayAccessToken: non-OK response is a normal failure, not a throw", async () => {
  const fetchFn = (async () => new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch;

  const result = await refreshEbayAccessToken(
    fakeSupabase(),
    "user-123",
    "expired-refresh-token",
    { ...FAKE_CONFIG, fetchFn },
  );

  assertEquals(result.ok, false);
  if (!result.ok) assertMatch(result.error, /Token refresh failed \(400\)/);
});

Deno.test("refreshEbayAccessToken: OK response with no access_token is a failure", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ expires_in: 7200 }), {
      status: 200,
    })) as unknown as typeof fetch;

  const result = await refreshEbayAccessToken(
    fakeSupabase(),
    "user-123",
    "some-refresh-token",
    { ...FAKE_CONFIG, fetchFn },
  );

  assertEquals(result.ok, false);
  if (!result.ok) assertMatch(result.error, /no access token/);
});
