import { assertEquals, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildAuthUrl, isTokenExpiredOrExpiringSoon } from "./auth.ts";
import { EBAY_OAUTH_SCOPES, REFRESH_BUFFER_MS } from "./constants.ts";

// Unit test coverage for REFACTOR_PLAN.md's Testing section ask: "scope list
// generation" (buildAuthUrl) and the token-refresh threshold logic
// (isTokenExpiredOrExpiringSoon) that handleGetStoredToken relies on to
// decide whether to proactively refresh. Both were extracted from inline
// logic in auth.ts specifically to make this coverage possible without
// mocking a live eBay OAuth endpoint or a Supabase client.

Deno.test("buildAuthUrl: joins the real EBAY_OAUTH_SCOPES into one space-delimited, URL-encoded scope param", () => {
  const url = buildAuthUrl(
    "https://auth.ebay.com",
    "my-client-id",
    "my-runame",
  );
  const parsed = new URL(url);
  assertEquals(parsed.origin, "https://auth.ebay.com");
  assertEquals(parsed.pathname, "/oauth2/authorize");
  assertEquals(parsed.searchParams.get("client_id"), "my-client-id");
  assertEquals(parsed.searchParams.get("redirect_uri"), "my-runame");
  assertEquals(parsed.searchParams.get("response_type"), "code");
  // Decoded scope param must be the real scopes, space-joined -- a
  // regression that dropped a scope or changed the join character would
  // silently narrow what the consent screen actually grants.
  assertEquals(parsed.searchParams.get("scope"), EBAY_OAUTH_SCOPES.join(" "));
});

Deno.test("buildAuthUrl: URL-encodes a redirect_uri containing reserved characters", () => {
  const url = buildAuthUrl(
    "https://auth.ebay.com",
    "client",
    "https://app.example.com/callback?x=1&y=2",
  );
  // Raw '&'/'?' from the redirect_uri must not be interpretable as
  // additional query params of the auth URL itself.
  const parsed = new URL(url);
  assertEquals(
    parsed.searchParams.get("redirect_uri"),
    "https://app.example.com/callback?x=1&y=2",
  );
  assertEquals(parsed.searchParams.size, 4);
});

Deno.test("buildAuthUrl: accepts a custom scope list (regression guard against a future signature change silently defaulting to the wrong scopes)", () => {
  const url = buildAuthUrl(
    "https://auth.ebay.com",
    "client",
    "runame",
    ["scope-a", "scope-b"],
  );
  const parsed = new URL(url);
  assertEquals(parsed.searchParams.get("scope"), "scope-a scope-b");
});

Deno.test("buildAuthUrl: the scope param round-trips through decodeURIComponent to the exact original string", () => {
  const url = buildAuthUrl("https://auth.ebay.com", "client", "runame");
  assertMatch(url, /scope=/);
  const rawScopeParam = url.split("scope=")[1];
  assertEquals(decodeURIComponent(rawScopeParam), EBAY_OAUTH_SCOPES.join(" "));
});

Deno.test("isTokenExpiredOrExpiringSoon: null/undefined expiry is treated as expired (forces a refresh attempt rather than trusting an unknown-age token)", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  assertEquals(isTokenExpiredOrExpiringSoon(null, now), true);
  assertEquals(isTokenExpiredOrExpiringSoon(undefined, now), true);
  assertEquals(isTokenExpiredOrExpiringSoon("", now), true);
});

Deno.test("isTokenExpiredOrExpiringSoon: an expiry well in the future is NOT expiring soon", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1h out
  assertEquals(isTokenExpiredOrExpiringSoon(expiresAt, now), false);
});

Deno.test("isTokenExpiredOrExpiringSoon: an expiry already in the past IS expiring soon", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const expiresAt = new Date(now.getTime() - 60 * 1000).toISOString(); // 1m ago
  assertEquals(isTokenExpiredOrExpiringSoon(expiresAt, now), true);
});

Deno.test("isTokenExpiredOrExpiringSoon: boundary -- exactly at REFRESH_BUFFER_MS is NOT yet expiring (strict less-than)", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const expiresAt = new Date(now.getTime() + REFRESH_BUFFER_MS).toISOString();
  assertEquals(isTokenExpiredOrExpiringSoon(expiresAt, now), false);
});

Deno.test("isTokenExpiredOrExpiringSoon: boundary -- one millisecond inside REFRESH_BUFFER_MS IS expiring soon", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const expiresAt = new Date(now.getTime() + REFRESH_BUFFER_MS - 1).toISOString();
  assertEquals(isTokenExpiredOrExpiringSoon(expiresAt, now), true);
});
