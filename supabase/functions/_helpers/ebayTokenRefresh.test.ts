import { assertEquals, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshEbayAccessToken } from "./ebayTokenRefresh.ts";
import { _resetKeyCacheForTests, decryptToken, isEncryptedToken } from "./tokenCrypto.ts";

const FAKE_CONFIG = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  tokenUrl: "https://example.com/oauth2/token",
};

// refreshEbayAccessToken persists the new tokens via tokenCrypto's
// encryptToken(), which requires EBAY_TOKEN_ENCRYPTION_KEY -- same
// monkey-patch pattern as tokenCrypto.test.ts's withKey(), needed here so
// this test doesn't silently depend on an ambient env var being set outside
// the test itself (which is exactly why it never ran in CI until now).
const TEST_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="; // 32 zero-adjacent bytes, base64
const originalEnvGet = Deno.env.get;

function withEncryptionKey<T>(fn: () => Promise<T> | T) {
  _resetKeyCacheForTests();
  const restore = () => {
    Deno.env.get = originalEnvGet;
  };
  Deno.env.get =
    ((name: string) => name === "EBAY_TOKEN_ENCRYPTION_KEY" ? TEST_KEY : originalEnvGet(name)) as typeof Deno.env.get;
  return Promise.resolve(fn()).finally(restore);
}

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
  await withEncryptionKey(async () => {
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
    // Persisted values are encrypted at rest (v1: prefix, tokenCrypto.ts) --
    // this test previously asserted the plaintext directly, which only
    // "passed" because EBAY_TOKEN_ENCRYPTION_KEY was never actually set when
    // this file ran (it was never wired into CI), so encryptToken threw
    // before persistence and the success path was never really exercised.
    const accessToken = persistedPatch?.ebay_access_token as string;
    const refreshToken = persistedPatch?.ebay_refresh_token as string;
    assertEquals(isEncryptedToken(accessToken), true);
    assertEquals(isEncryptedToken(refreshToken), true);
    assertEquals(await decryptToken(accessToken), "new-access-token");
    assertEquals(await decryptToken(refreshToken), "new-refresh-token");
  });
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
