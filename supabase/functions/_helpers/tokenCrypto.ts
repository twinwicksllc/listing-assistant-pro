/**
 * AES-256-GCM encryption for eBay OAuth tokens at rest (RBR-0020).
 *
 * `profiles.ebay_access_token`/`ebay_refresh_token` are plaintext TEXT columns
 * in a Postgres project shared with an unrelated CRM product under a single
 * shared admin account -- any SQL Editor browse, export, or dump of `profiles`
 * previously wrote live eBay credentials to disk in the clear. This encrypts
 * the token values themselves before they ever reach the database, using Web
 * Crypto (`crypto.subtle`) rather than a Postgres-native pgsodium/pgcrypto
 * approach: every legitimate consumer of the plaintext is Edge Function
 * TypeScript code calling eBay's API, so the plaintext must materialize in the
 * Deno runtime regardless of where encryption happens -- doing it here avoids
 * introducing a new Postgres extension and Vault-backed key management this
 * codebase has no precedent for. The key itself lives in the
 * EBAY_TOKEN_ENCRYPTION_KEY Edge Function secret, the same operator-managed
 * pattern already used for CRON_SECRET/SENTRY_DSN.
 *
 * This protects against plaintext exposure via DB-level access (SQL Editor,
 * exports, a compromised read-only connection) -- it does not protect against
 * a fully compromised admin account that also has Edge Function secret
 * access, since the decryption key lives in that same admin-controlled secret
 * store.
 *
 * Stored format: `v1:<base64 iv>:<base64 ciphertext+tag>`. decryptToken is
 * tolerant of values that don't match this format -- returned unchanged as
 * legacy plaintext -- so encrypting writes can ship before existing plaintext
 * rows are backfilled, with no cutover race.
 */

const VERSION_PREFIX = "v1:";
const IV_BYTES = 12;

let cachedKey: Promise<CryptoKey> | null = null;
let warnedLegacyPlaintext = false;

function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("EBAY_TOKEN_ENCRYPTION_KEY");
  if (!raw) {
    throw new Error(
      "EBAY_TOKEN_ENCRYPTION_KEY is not configured -- refusing to write an eBay token unencrypted. " +
        "Generate one with `openssl rand -base64 32` and set it as an Edge Function secret.",
    );
  }
  cachedKey = (async () => {
    let keyBytes: Uint8Array;
    try {
      keyBytes = base64ToBytes(raw);
    } catch {
      cachedKey = null;
      throw new Error(
        "EBAY_TOKEN_ENCRYPTION_KEY is not valid base64.",
      );
    }
    if (keyBytes.length !== 32) {
      cachedKey = null;
      throw new Error(
        `EBAY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (AES-256), got ${keyBytes.length}.`,
      );
    }
    return crypto.subtle.importKey(
      "raw",
      keyBytes as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return cachedKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encrypts a plaintext token. Throws if EBAY_TOKEN_ENCRYPTION_KEY is missing/invalid. */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return `${VERSION_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypts a token previously produced by encryptToken. `null`/`undefined`
 * pass through as `null`. A value without the `v1:` marker is treated as
 * legacy plaintext (pre-encryption row) and returned unchanged -- this is
 * what makes the migration safe to backfill after deploying, not before.
 */
export async function decryptToken(
  value: string | null | undefined,
): Promise<string | null> {
  if (value == null) return null;
  if (!value.startsWith(VERSION_PREFIX)) {
    if (!warnedLegacyPlaintext) {
      warnedLegacyPlaintext = true;
      console.warn(
        "tokenCrypto: decrypted a value with no v1: marker -- treating as legacy plaintext. " +
          "If this persists after the backfill has run, investigate.",
      );
    }
    return value;
  }
  const rest = value.slice(VERSION_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) {
    throw new Error("tokenCrypto: malformed encrypted value (missing separator).");
  }
  const key = await getKey();
  const iv = base64ToBytes(rest.slice(0, sep));
  const ciphertext = base64ToBytes(rest.slice(sep + 1));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

/** True if the value is already in encrypted (`v1:`) format. Used by the backfill to skip already-migrated rows. */
export function isEncryptedToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(VERSION_PREFIX);
}

/**
 * Clears the module-level imported-key cache. Test-only -- production code
 * relies on the cache persisting for the life of a warm isolate so the key
 * isn't re-imported on every call.
 */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
  warnedLegacyPlaintext = false;
}
