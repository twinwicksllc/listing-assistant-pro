import { createPublicKey, createVerify } from "node:crypto";
import { fetchWithTimeout } from "./fetchWithTimeout.ts";

// Tables holding data sourced from eBay for a user. Deliberately excludes
// user-authored content (drafts, listing_cogs, reprice_rules, market_watches)
// and the ListrAssistr account itself -- a deletion notice is about the eBay
// identity, not the whole account.
export const EBAY_DATA_TABLES = [
  "user_active_listings",
  "competitor_prices",
  "listing_financials",
  "listing_edits_log",
  "optimization_history",
] as const;

// Cleared in two steps. The tokens go first so the sync workers (which select
// users on ebay_refresh_token IS NOT NULL) stop writing eBay rows for this user
// before those rows are deleted. ebay_username goes last: it is how a retry
// finds the user again if anything in between fails.
const EBAY_TOKEN_CLEAR = {
  ebay_access_token: null,
  ebay_refresh_token: null,
  ebay_token_expires_at: null,
};
const EBAY_IDENTITY_CLEAR = {
  ebay_username: null,
  ebay_account_type: null,
};

const EBAY_API_BASE = "https://api.ebay.com";
export const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000;
export const FAILED_KEY_TTL_MS = 60 * 1000;
export const APP_TOKEN_SAFETY_MS = 60 * 1000;
const EBAY_REQUEST_TIMEOUT_MS = 8_000;

export async function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(challengeCode + verificationToken + endpoint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ParsedSignature {
  kid: string;
  signature: string;
  digest: string;
}

export function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(atob(header));
    if (typeof parsed?.kid !== "string" || typeof parsed?.signature !== "string") return null;
    return { kid: parsed.kid, signature: parsed.signature, digest: String(parsed.digest ?? "SHA1") };
  } catch {
    return null;
  }
}

export interface EbayPublicKey {
  key: string;
  digest?: string;
}

// eBay returns the key with the BEGIN/END armor but no newlines (its own SDK
// re-inserts them before parsing), so strip any armor and rebuild the PEM.
function toPem(key: string): string {
  const body = key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PUBLIC KEY-----`;
}

const DIGESTS: Record<string, string> = { SHA1: "sha1", SHA256: "sha256" };

export function verifyNotificationSignature(
  rawBody: string,
  parsed: ParsedSignature,
  publicKey: EbayPublicKey,
): boolean {
  const algorithm = DIGESTS[(publicKey.digest ?? parsed.digest).toUpperCase()];
  if (!algorithm) return false;

  // eBay's SDK verifies JSON.stringify(parsedBody), not the raw bytes. The two
  // are identical for compact JSON; try the re-serialized form too so a
  // whitespace difference can't reject a genuine notice.
  const candidates = [rawBody];
  try {
    const reserialized = JSON.stringify(JSON.parse(rawBody));
    if (reserialized !== rawBody) candidates.push(reserialized);
  } catch {
    // Not JSON: only the raw form is worth trying.
  }

  try {
    const key = createPublicKey(toPem(publicKey.key));
    return candidates.some((payload) =>
      createVerify(algorithm).update(payload).verify(key, parsed.signature, "base64")
    );
  } catch {
    return false;
  }
}

// Default transport: bounded wall-clock ceiling covering the body as well as the
// headers, so a stalled eBay call becomes a prompt 503 instead of riding to the
// gateway kill. Tests inject their own fetchFn.
const timedFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(input as string | URL, init ?? {}, EBAY_REQUEST_TIMEOUT_MS, "ebay-account-deletion");

const tokenCache: { token: string; expiresAt: number }[] = [];

export function clearAppTokenCache(): void {
  tokenCache.length = 0;
}

// The app token is reused until shortly before it expires. Without this, every
// public-key cache miss on this unauthenticated endpoint costs a token request
// too, against a quota shared with the Browse API.
export async function fetchEbayAppToken(
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch = timedFetch,
  now: () => number = Date.now,
): Promise<string> {
  const cached = tokenCache[0];
  if (cached && cached.expiresAt > now()) return cached.token;

  const res = await fetchFn(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  if (!res.ok) throw new Error(`app token request failed (${res.status})`);
  const data = await res.json();
  if (typeof data?.access_token !== "string") throw new Error("app token response had no access_token");

  const lifetimeMs = (Number(data.expires_in) || 0) * 1000;
  if (lifetimeMs > APP_TOKEN_SAFETY_MS) {
    tokenCache[0] = { token: data.access_token, expiresAt: now() + lifetimeMs - APP_TOKEN_SAFETY_MS };
  }
  return data.access_token;
}

const keyCache = new Map<string, { value: EbayPublicKey; expiresAt: number }>();
const failedKeyCache = new Map<string, { error: string; expiresAt: number }>();
const FAILED_KEY_CACHE_MAX = 500;

export function clearPublicKeyCache(): void {
  keyCache.clear();
  failedKeyCache.clear();
}

// Cached because eBay's guide warns that fetching per notification can
// exhaust the app's API call limit, which is shared with the Browse quota.
// Failed lookups are cached briefly too: this endpoint is unauthenticated, so
// without that an attacker sending a fresh made-up kid on every request would
// turn each one into an outbound eBay call. The failed cache is size-bounded
// so random kids cannot grow it without limit.
export async function getEbayPublicKey(
  kid: string,
  deps: {
    getAppToken: () => Promise<string>;
    fetchFn?: typeof fetch;
    now?: () => number;
  },
): Promise<EbayPublicKey> {
  const now = (deps.now ?? Date.now)();
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > now) return cached.value;
  const failed = failedKeyCache.get(kid);
  if (failed && failed.expiresAt > now) throw new Error(failed.error);

  try {
    const res = await (deps.fetchFn ?? timedFetch)(
      `${EBAY_API_BASE}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
      {
        headers: {
          Authorization: `Bearer ${await deps.getAppToken()}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) throw new Error(`public key lookup failed (${res.status})`);
    const data = await res.json();
    if (typeof data?.key !== "string") throw new Error("public key response had no key");

    const value: EbayPublicKey = { key: data.key, digest: typeof data.digest === "string" ? data.digest : undefined };
    keyCache.set(kid, { value, expiresAt: now + PUBLIC_KEY_TTL_MS });
    return value;
  } catch (err) {
    if (failedKeyCache.size >= FAILED_KEY_CACHE_MAX) failedKeyCache.clear();
    failedKeyCache.set(kid, {
      error: err instanceof Error ? err.message : String(err),
      expiresAt: now + FAILED_KEY_TTL_MS,
    });
    throw err;
  }
}

// Throws on any failure so the caller can refuse to acknowledge the
// notification and let eBay resend it.
export async function deleteEbayDataForUser(
  // deno-lint-ignore no-explicit-any -- matches the loose typing used for the supabase-js client across this codebase.
  supabase: any,
  ids: { userId?: unknown; username?: unknown },
): Promise<{ profilesMatched: number }> {
  const identifiers = [ids.userId, ids.username].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (identifiers.length === 0) return { profilesMatched: 0 };

  // profiles.ebay_username stores the Identity API's userId when present,
  // falling back to username (see ebay-publish/auth.ts), so match either.
  const { data: profiles, error: lookupErr } = await supabase
    .from("profiles")
    .select("id")
    .in("ebay_username", identifiers);
  if (lookupErr) throw new Error(`profile lookup failed: ${lookupErr.message}`);

  const userIds = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  if (userIds.length === 0) return { profilesMatched: 0 };

  // 1. Revoke access first so the sync workers stop selecting these users and
  //    cannot re-insert eBay rows while the deletes below are running.
  const { error: tokenErr } = await supabase.from("profiles").update(EBAY_TOKEN_CLEAR).in("id", userIds);
  if (tokenErr) throw new Error(`token clear failed: ${tokenErr.message}`);

  // 2. Delete the eBay-derived rows.
  for (const table of EBAY_DATA_TABLES) {
    const { error } = await supabase.from(table).delete().in("user_id", userIds);
    if (error) throw new Error(`delete from ${table} failed: ${error.message}`);
  }

  // 3. Clear the identifier last. It is how a retry finds this user again, so
  //    a failure at step 1 or 2 leaves it in place and eBay's resend repeats
  //    the whole sequence.
  const { error: clearErr } = await supabase.from("profiles").update(EBAY_IDENTITY_CLEAR).in("id", userIds);
  if (clearErr) throw new Error(`profile clear failed: ${clearErr.message}`);

  return { profilesMatched: userIds.length };
}
