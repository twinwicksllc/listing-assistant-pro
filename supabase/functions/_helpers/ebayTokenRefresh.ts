import { encryptToken } from "./tokenCrypto.ts";

// Must match EBAY_OAUTH_SCOPES in ../ebay-publish/constants.ts. Duplicated
// rather than imported because Edge Functions in this repo don't import
// across function-specific directories -- shared logic lives in _helpers/.
const EBAY_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
];

const REFRESH_TIMEOUT_MS = 15000;

export type EbayTokenRefreshResult =
  | { ok: true; accessToken: string; expiresAt: string }
  | { ok: false; error: string };

export type EbayTokenRefreshConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  fetchFn?: typeof fetch;
};

/**
 * Refresh an eBay access token from a stored refresh token and persist the
 * result to profiles. Never throws -- callers treat a failed refresh as a
 * normal skip-this-user case, not an exception.
 *
 * `refreshToken` must already be plaintext -- this function encrypts before
 * persisting (RBR-0020) but does not decrypt on the way in; the caller is
 * responsible for decrypting whatever it read from profiles first.
 *
 * Extracted from ebay-publish/auth.ts's handleRefreshToken, minus the
 * Request/Response wrapping and the assertCallerOwnsUser check -- both are
 * concerns specific to being invoked by an authenticated frontend request,
 * which a cron caller doesn't have.
 */
export async function refreshEbayAccessToken(
  supabase: { from: (table: string) => any },
  userId: string,
  refreshToken: string,
  config: EbayTokenRefreshConfig,
): Promise<EbayTokenRefreshResult> {
  const doFetch = config.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  let refreshResp: Response;
  try {
    const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
    refreshResp = await doFetch(config.tokenUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_OAUTH_SCOPES.join(" "),
      }).toString(),
    });
  } catch (err) {
    return {
      ok: false,
      error: `eBay token refresh request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!refreshResp.ok) {
    const text = await refreshResp.text();
    console.error(
      "refreshEbayAccessToken: eBay refresh failed:",
      refreshResp.status,
      text,
    );
    return {
      ok: false,
      error: `Token refresh failed (${refreshResp.status})`,
    };
  }

  const tokenData = await refreshResp.json();
  if (!tokenData.access_token) {
    return {
      ok: false,
      error: "eBay returned no access token during refresh.",
    };
  }

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  ).toISOString();
  const updatePatch: Record<string, string> = {
    ebay_access_token: await encryptToken(tokenData.access_token),
    ebay_token_expires_at: expiresAt,
  };
  if (tokenData.refresh_token) {
    updatePatch.ebay_refresh_token = await encryptToken(tokenData.refresh_token);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(updatePatch)
    .eq("id", userId);
  if (updateError) {
    console.warn(
      "refreshEbayAccessToken: failed to persist refreshed token:",
      updateError.message,
    );
  }

  return { ok: true, accessToken: tokenData.access_token, expiresAt };
}
