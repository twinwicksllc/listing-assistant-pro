// Live-mode fallback preserves today's production behavior exactly when
// STRIPE_PRICE_IDS is unset and the configured Stripe key is live-mode.
export const LIVE_FALLBACK_PRICES = [
  "price_1T8lVU4bX0d1SiThMDayhDj5", // Starter $19/mo
  "price_1T8mZ84bX0d1SiThFgvRubiN", // Pro $49/mo
  "price_1TXYjd4bX0d1SiThDb4YQhjR", // Shop $99/mo
];

const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

export interface CreateCheckoutEnv {
  STRIPE_PRICE_IDS?: string;
  STRIPE_SECRET_KEY?: string;
}

function isLiveModeKey(secretKey: string | undefined): boolean {
  return /^(sk|rk)_live_/.test(secretKey ?? "");
}

function isTestModeKey(secretKey: string | undefined): boolean {
  return /^(sk|rk)_test_/.test(secretKey ?? "");
}

/**
 * Resolves the Stripe price IDs `create-checkout` will accept, given the
 * function's environment. Test-mode and live-mode Price objects are separate
 * namespaces in Stripe, so this must never mix them.
 */
export function selectValidPrices(env: CreateCheckoutEnv): string[] {
  const configured = env.STRIPE_PRICE_IDS;
  if (configured && configured.trim().length > 0) {
    const ids = configured
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const malformed = ids.filter((id) => !PRICE_ID_PATTERN.test(id));
    if (malformed.length > 0) {
      throw new Error(
        `STRIPE_PRICE_IDS contains malformed price ID(s): ${malformed.join(", ")}`,
      );
    }
    if (ids.length === 0) {
      throw new Error("STRIPE_PRICE_IDS is set but contains no price IDs");
    }
    return ids;
  }

  if (isLiveModeKey(env.STRIPE_SECRET_KEY)) {
    return LIVE_FALLBACK_PRICES;
  }

  if (isTestModeKey(env.STRIPE_SECRET_KEY)) {
    throw new Error(
      "STRIPE_PRICE_IDS must be configured when STRIPE_SECRET_KEY is a test-mode key",
    );
  }

  throw new Error(
    "Unable to determine a Stripe price list: STRIPE_PRICE_IDS is unset and STRIPE_SECRET_KEY is missing or not recognized as live/test mode",
  );
}
