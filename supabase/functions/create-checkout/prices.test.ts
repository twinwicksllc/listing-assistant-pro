import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { LIVE_FALLBACK_PRICES, selectValidPrices } from "./prices.ts";

Deno.test("selectValidPrices: explicit STRIPE_PRICE_IDS wins over key mode", () => {
  const result = selectValidPrices({
    STRIPE_PRICE_IDS: "price_abc123, price_def456",
    STRIPE_SECRET_KEY: "sk_live_whatever",
  });
  assertEquals(result, ["price_abc123", "price_def456"]);
});

Deno.test("selectValidPrices: unset + live-mode key falls back to LIVE_FALLBACK_PRICES", () => {
  assertEquals(
    selectValidPrices({ STRIPE_SECRET_KEY: "sk_live_4bX0d1SiTh" }),
    LIVE_FALLBACK_PRICES,
  );
});

Deno.test("selectValidPrices: unset + live-mode restricted key falls back to LIVE_FALLBACK_PRICES", () => {
  assertEquals(
    selectValidPrices({ STRIPE_SECRET_KEY: "rk_live_4bX0d1SiTh" }),
    LIVE_FALLBACK_PRICES,
  );
});

Deno.test("selectValidPrices: unset + test-mode key throws a configuration error", () => {
  assertThrows(
    () => selectValidPrices({ STRIPE_SECRET_KEY: "sk_test_4bX0d1SiTh" }),
    Error,
    "STRIPE_PRICE_IDS must be configured",
  );
});

Deno.test("selectValidPrices: unset + test-mode restricted key throws a configuration error", () => {
  assertThrows(
    () => selectValidPrices({ STRIPE_SECRET_KEY: "rk_test_4bX0d1SiTh" }),
    Error,
    "STRIPE_PRICE_IDS must be configured",
  );
});

Deno.test("selectValidPrices: unset + missing key throws", () => {
  assertThrows(
    () => selectValidPrices({}),
    Error,
    "Unable to determine a Stripe price list",
  );
});

Deno.test("selectValidPrices: malformed price ID in STRIPE_PRICE_IDS throws", () => {
  assertThrows(
    () => selectValidPrices({ STRIPE_PRICE_IDS: "price_abc123, not-a-price" }),
    Error,
    "malformed price ID",
  );
});

Deno.test("selectValidPrices: STRIPE_PRICE_IDS of only whitespace/commas throws", () => {
  assertThrows(
    () => selectValidPrices({ STRIPE_PRICE_IDS: " , , " }),
    Error,
    "contains no price IDs",
  );
});
