import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  getMediaVideoBaseCandidates,
  getResourceIdFromLocation,
  isRetryableCreateEndpointStatus,
  isRetryableStatusCode,
  normalizeVideoStatus,
  probeTokenEnvironment,
} from "./video.ts";
import { IDENTITY_API_PROD, IDENTITY_API_SANDBOX } from "./constants.ts";

// Unit test coverage for REFACTOR_PLAN.md's Testing section ask:
// "identity-probe logic" (probeTokenEnvironment) plus the surrounding pure
// helpers video.ts's endpoint-fallback and video-status logic depend on.
// The plan's other ask -- a sandbox integration test exercising the real
// upload_video/get_video_status flow against a live eBay sandbox account --
// is explicitly OUT OF SCOPE here (no sandbox credentials available in this
// environment); see this PR's description.

Deno.test("getMediaVideoBaseCandidates: production returns 4 candidates, apim gateway variants first", () => {
  const candidates = getMediaVideoBaseCandidates("production");
  assertEquals(candidates, [
    "https://apim.ebay.com/commerce/media/v1_beta/video",
    "https://apim.ebay.com/commerce/media/v1/video",
    "https://api.ebay.com/commerce/media/v1_beta/video",
    "https://api.ebay.com/commerce/media/v1/video",
  ]);
});

Deno.test("getMediaVideoBaseCandidates: any non-production value maps to the sandbox host set", () => {
  const candidates = getMediaVideoBaseCandidates("sandbox");
  assertEquals(candidates, [
    "https://apim.sandbox.ebay.com/commerce/media/v1_beta/video",
    "https://apim.sandbox.ebay.com/commerce/media/v1/video",
    "https://api.sandbox.ebay.com/commerce/media/v1_beta/video",
    "https://api.sandbox.ebay.com/commerce/media/v1/video",
  ]);
});

Deno.test("isRetryableCreateEndpointStatus: 404/405/400 are retryable (wrong-path signals)", () => {
  assertEquals(isRetryableCreateEndpointStatus(404), true);
  assertEquals(isRetryableCreateEndpointStatus(405), true);
  assertEquals(isRetryableCreateEndpointStatus(400), true);
});

Deno.test("isRetryableCreateEndpointStatus: 401/403 are NOT retryable (real auth rejection, not a wrong path)", () => {
  assertEquals(isRetryableCreateEndpointStatus(401), false);
  assertEquals(isRetryableCreateEndpointStatus(403), false);
});

Deno.test("isRetryableCreateEndpointStatus: 200/500 are not retryable-as-a-wrong-path", () => {
  assertEquals(isRetryableCreateEndpointStatus(200), false);
  assertEquals(isRetryableCreateEndpointStatus(500), false);
});

Deno.test("isRetryableStatusCode: 429/500/502/503/504 are transient and retryable", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assertEquals(isRetryableStatusCode(status), true, `expected ${status} to be retryable`);
  }
});

Deno.test("isRetryableStatusCode: 400/401/403/404 are NOT transient-retryable", () => {
  for (const status of [400, 401, 403, 404]) {
    assertEquals(isRetryableStatusCode(status), false, `expected ${status} to not be retryable`);
  }
});

Deno.test("normalizeVideoStatus: maps eBay's raw statuses to the app's normalized set", () => {
  assertEquals(normalizeVideoStatus("LIVE"), "LIVE");
  assertEquals(normalizeVideoStatus("BLOCKED"), "FAILED");
  assertEquals(normalizeVideoStatus("PROCESSING_FAILED"), "FAILED");
  assertEquals(normalizeVideoStatus("PENDING_UPLOAD"), "PENDING");
  assertEquals(normalizeVideoStatus("PROCESSING"), "PROCESSING");
  assertEquals(normalizeVideoStatus("PENDING"), "PENDING");
});

Deno.test("normalizeVideoStatus: is case-insensitive on the raw input", () => {
  assertEquals(normalizeVideoStatus("live"), "LIVE");
  assertEquals(normalizeVideoStatus("blocked"), "FAILED");
});

Deno.test("normalizeVideoStatus: an unrecognized raw status passes through uppercased rather than being silently coerced", () => {
  assertEquals(normalizeVideoStatus("SOME_NEW_EBAY_STATUS"), "SOME_NEW_EBAY_STATUS");
});

Deno.test("normalizeVideoStatus: null/undefined/empty default to PENDING", () => {
  assertEquals(normalizeVideoStatus(null), "PENDING");
  assertEquals(normalizeVideoStatus(undefined), "PENDING");
  assertEquals(normalizeVideoStatus(""), "PENDING");
});

Deno.test("getResourceIdFromLocation: extracts the trailing path segment as the resource id", () => {
  assertEquals(
    getResourceIdFromLocation("https://api.ebay.com/commerce/media/v1/video/abc123"),
    "abc123",
  );
});

Deno.test("getResourceIdFromLocation: strips a trailing slash before extracting", () => {
  assertEquals(
    getResourceIdFromLocation("https://api.ebay.com/commerce/media/v1/video/abc123/"),
    "abc123",
  );
});

Deno.test("getResourceIdFromLocation: decodes a URL-encoded resource id", () => {
  assertEquals(
    getResourceIdFromLocation("https://api.ebay.com/commerce/media/v1/video/abc%20123"),
    "abc 123",
  );
});

Deno.test("getResourceIdFromLocation: null location returns null rather than throwing", () => {
  assertEquals(getResourceIdFromLocation(null), null);
});

// ── probeTokenEnvironment: monkey-patches globalThis.fetch, same pattern as
// ebay-quota-monitor.test.ts's withMockedFetch / ebayTokenRefresh.test.ts's
// Deno.env.get patch -- restored in a `finally` so a failure never leaks
// into a later test. fetchWithTimeout (used internally) delegates to the
// global `fetch`, so patching it here is sufficient without needing to
// intercept fetchWithTimeout directly.

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

Deno.test("probeTokenEnvironment: a token accepted by the production Identity API is detected as 'production'", async () => {
  const calledUrls: string[] = [];
  const result = await withMockedFetch(
    (url) => {
      calledUrls.push(url);
      if (url === IDENTITY_API_PROD) return new Response("{}", { status: 200 });
      return new Response("", { status: 401 });
    },
    () => probeTokenEnvironment("fake-token"),
  );
  assertEquals(result, "production");
  // Production is probed first and returns ok -- sandbox should never be tried.
  assertEquals(calledUrls, [IDENTITY_API_PROD]);
});

Deno.test("probeTokenEnvironment: forwards the supplied token as a Bearer Authorization header (Copilot review, PR #597 -- the mock previously ignored RequestInit entirely, so this would still pass even if the header were wrong or missing)", async () => {
  const capturedAuthHeaders: (string | null)[] = [];
  const result = await withMockedFetch(
    (url, init) => {
      const headers = new Headers(init?.headers);
      capturedAuthHeaders.push(headers.get("Authorization"));
      if (url === IDENTITY_API_PROD) return new Response("{}", { status: 200 });
      return new Response("", { status: 401 });
    },
    () => probeTokenEnvironment("my-real-user-token"),
  );
  assertEquals(result, "production");
  assertEquals(capturedAuthHeaders, ["Bearer my-real-user-token"]);
});

Deno.test("probeTokenEnvironment: a token rejected by production but accepted by sandbox is detected as 'sandbox'", async () => {
  const calledUrls: string[] = [];
  const result = await withMockedFetch(
    (url) => {
      calledUrls.push(url);
      if (url === IDENTITY_API_SANDBOX) return new Response("{}", { status: 200 });
      return new Response("", { status: 401 });
    },
    () => probeTokenEnvironment("fake-token"),
  );
  assertEquals(result, "sandbox");
  assertEquals(calledUrls, [IDENTITY_API_PROD, IDENTITY_API_SANDBOX]);
});

Deno.test("probeTokenEnvironment: a token rejected by both environments is 'unknown', not a throw", async () => {
  const result = await withMockedFetch(
    () => new Response("", { status: 401 }),
    () => probeTokenEnvironment("fake-token"),
  );
  assertEquals(result, "unknown");
});

Deno.test("probeTokenEnvironment: a network error on both probes degrades to 'unknown' rather than propagating (probe is non-critical)", async () => {
  const result = await withMockedFetch(
    () => {
      throw new Error("network unreachable");
    },
    () => probeTokenEnvironment("fake-token"),
  );
  assertEquals(result, "unknown");
});
