import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { _resetKeyCacheForTests, decryptToken, encryptToken, isEncryptedToken } from "./tokenCrypto.ts";

const TEST_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="; // 32 zero-adjacent bytes, base64
const originalEnvGet = Deno.env.get;

// Resets the module-level key cache before every test so each test's env var
// value is actually re-read, instead of a prior test's successfully-cached
// key silently making later "missing/invalid key" tests pass for free.
function withKey<T>(value: string | undefined, fn: () => Promise<T> | T) {
  _resetKeyCacheForTests();
  const restore = () => {
    Deno.env.get = originalEnvGet;
  };
  Deno.env.get =
    ((name: string) => name === "EBAY_TOKEN_ENCRYPTION_KEY" ? value : originalEnvGet(name)) as typeof Deno.env.get;
  return Promise.resolve(fn()).finally(restore);
}

Deno.test("encryptToken -> decryptToken round-trips the original plaintext", async () => {
  await withKey(TEST_KEY, async () => {
    const encrypted = await encryptToken("v^1.1#i=1#p=3#f=0#r=0#t=H4sIAAA");
    assertEquals(encrypted.startsWith("v1:"), true);
    assertEquals(await decryptToken(encrypted), "v^1.1#i=1#p=3#f=0#r=0#t=H4sIAAA");
  });
});

Deno.test("encryptToken produces a different ciphertext each time (random IV)", async () => {
  await withKey(TEST_KEY, async () => {
    const a = await encryptToken("same-plaintext");
    const b = await encryptToken("same-plaintext");
    assertEquals(a === b, false);
  });
});

Deno.test("decryptToken passes null/undefined through unchanged", async () => {
  await withKey(TEST_KEY, async () => {
    assertEquals(await decryptToken(null), null);
    assertEquals(await decryptToken(undefined), null);
  });
});

Deno.test("decryptToken treats a value with no v1: marker as legacy plaintext", async () => {
  await withKey(TEST_KEY, async () => {
    assertEquals(await decryptToken("v^1.1#i=1#raw-legacy-token"), "v^1.1#i=1#raw-legacy-token");
  });
});

Deno.test("decryptToken rejects a tampered ciphertext", async () => {
  await withKey(TEST_KEY, async () => {
    const encrypted = await encryptToken("secret-value");
    const tampered = encrypted.slice(0, -4) + "abcd";
    await assertRejects(() => decryptToken(tampered));
  });
});

Deno.test("encryptToken throws when EBAY_TOKEN_ENCRYPTION_KEY is not configured", async () => {
  await withKey(undefined, async () => {
    await assertRejects(() => encryptToken("value"), Error, "not configured");
  });
});

Deno.test("encryptToken throws when the key does not decode to 32 bytes", async () => {
  await withKey("dG9vLXNob3J0", async () => {
    await assertRejects(() => encryptToken("value"), Error, "32 bytes");
  });
});

Deno.test("isEncryptedToken distinguishes encrypted values from plaintext", async () => {
  await withKey(TEST_KEY, async () => {
    const encrypted = await encryptToken("value");
    assertEquals(isEncryptedToken(encrypted), true);
    assertEquals(isEncryptedToken("plain-legacy-token"), false);
    assertEquals(isEncryptedToken(null), false);
    assertEquals(isEncryptedToken(undefined), false);
  });
});
