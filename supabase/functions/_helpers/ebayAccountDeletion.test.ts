import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  clearPublicKeyCache,
  computeChallengeResponse,
  deleteEbayDataForUser,
  EBAY_DATA_TABLES,
  getEbayPublicKey,
  parseSignatureHeader,
  verifyNotificationSignature,
} from "./ebayAccountDeletion.ts";

Deno.test("computeChallengeResponse: sha256(challengeCode + token + endpoint) as hex", async () => {
  // Reference value computed independently: sha256("abc" + "tok" + "https://x.test/hook")
  const expected = await (async () => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abctokhttps://x.test/hook"));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  })();
  assertEquals(await computeChallengeResponse("abc", "tok", "https://x.test/hook"), expected);
  assertEquals(expected.length, 64);
});

Deno.test("computeChallengeResponse: argument order matters", async () => {
  const a = await computeChallengeResponse("abc", "tok", "https://x.test/hook");
  const b = await computeChallengeResponse("tok", "abc", "https://x.test/hook");
  assertEquals(a === b, false);
});

function signedNotification(digest: "SHA1" | "SHA256" = "SHA256") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: {} });
  const signature = createSign(digest.toLowerCase()).update(body).sign(privateKey, "base64");
  const header = btoa(JSON.stringify({ alg: "ecdsa", kid: "kid-1", signature, digest }));
  const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
  // eBay returns the key body without PEM armor.
  const bareKey = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return { body, header, bareKey, pem };
}

Deno.test("verifyNotificationSignature: accepts a genuine signature (bare and PEM keys, SHA256 and SHA1)", () => {
  for (const digest of ["SHA256", "SHA1"] as const) {
    const n = signedNotification(digest);
    const parsed = parseSignatureHeader(n.header)!;
    assertEquals(verifyNotificationSignature(n.body, parsed, { key: n.bareKey }), true);
    assertEquals(verifyNotificationSignature(n.body, parsed, { key: n.pem }), true);
  }
});

Deno.test("verifyNotificationSignature: accepts the key exactly as eBay sends it (armor, no newlines)", () => {
  const n = signedNotification();
  const parsed = parseSignatureHeader(n.header)!;
  const ebayStyleKey = `-----BEGIN PUBLIC KEY-----${n.bareKey}-----END PUBLIC KEY-----`;
  assertEquals(verifyNotificationSignature(n.body, parsed, { key: ebayStyleKey }), true);
});

Deno.test("verifyNotificationSignature: accepts a pretty-printed body signed in its compact form", () => {
  const n = signedNotification();
  const parsed = parseSignatureHeader(n.header)!;
  const pretty = JSON.stringify(JSON.parse(n.body), null, 2);
  assertEquals(pretty === n.body, false);
  assertEquals(verifyNotificationSignature(pretty, parsed, { key: n.bareKey }), true);
});

Deno.test("verifyNotificationSignature: rejects a tampered body", () => {
  const n = signedNotification();
  const parsed = parseSignatureHeader(n.header)!;
  assertEquals(verifyNotificationSignature(n.body.replace("ACCOUNT", "ACCOUNT_X"), parsed, { key: n.bareKey }), false);
});

Deno.test("verifyNotificationSignature: rejects a signature from a different key", () => {
  const n = signedNotification();
  const other = signedNotification();
  const parsed = parseSignatureHeader(n.header)!;
  assertEquals(verifyNotificationSignature(n.body, parsed, { key: other.bareKey }), false);
});

Deno.test("verifyNotificationSignature: rejects garbage key and unknown digest instead of throwing", () => {
  const n = signedNotification();
  const parsed = parseSignatureHeader(n.header)!;
  assertEquals(verifyNotificationSignature(n.body, parsed, { key: "not-a-key" }), false);
  assertEquals(verifyNotificationSignature(n.body, { ...parsed, digest: "MD5" }, { key: n.bareKey }), false);
});

Deno.test("parseSignatureHeader: rejects missing, non-base64, non-JSON, and incomplete headers", () => {
  assertEquals(parseSignatureHeader(null), null);
  assertEquals(parseSignatureHeader("!!!not base64!!!"), null);
  assertEquals(parseSignatureHeader(btoa("not json")), null);
  assertEquals(parseSignatureHeader(btoa(JSON.stringify({ kid: "k" }))), null);
  assertEquals(parseSignatureHeader(btoa(JSON.stringify({ kid: "k", signature: "s" })))?.digest, "SHA1");
});

Deno.test("getEbayPublicKey: caches per kid within the TTL and refetches after it", async () => {
  clearPublicKeyCache();
  let calls = 0;
  const fetchFn = (() => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ key: "KEYDATA", digest: "SHA256" })));
  }) as typeof fetch;
  let t = 1_000;
  const deps = { getAppToken: () => Promise.resolve("tok"), fetchFn, now: () => t };

  assertEquals((await getEbayPublicKey("kid-a", deps)).key, "KEYDATA");
  await getEbayPublicKey("kid-a", deps);
  assertEquals(calls, 1);

  await getEbayPublicKey("kid-b", deps);
  assertEquals(calls, 2);

  t += 60 * 60 * 1000 + 1;
  await getEbayPublicKey("kid-a", deps);
  assertEquals(calls, 3);
});

Deno.test("getEbayPublicKey: a failed lookup throws and is not cached", async () => {
  clearPublicKeyCache();
  let calls = 0;
  const fetchFn = (() => {
    calls++;
    return Promise.resolve(new Response("nope", { status: 500 }));
  }) as typeof fetch;
  const deps = { getAppToken: () => Promise.resolve("tok"), fetchFn };
  await assertRejects(() => getEbayPublicKey("kid-x", deps));
  await assertRejects(() => getEbayPublicKey("kid-x", deps));
  assertEquals(calls, 2);
});

// Minimal fake of the supabase-js query builder surface the helper uses.
function fakeSupabase(opts: { profiles?: { id: string }[]; failTable?: string; failProfileClear?: boolean } = {}) {
  const log: string[] = [];
  const client = {
    from(table: string) {
      return {
        select: () => ({
          in: (col: string, vals: string[]) => {
            log.push(`select ${table} where ${col} in ${JSON.stringify(vals)}`);
            return Promise.resolve({ data: opts.profiles ?? [], error: null });
          },
        }),
        delete: () => ({
          in: (col: string, vals: string[]) => {
            log.push(`delete ${table} where ${col} in ${JSON.stringify(vals)}`);
            return Promise.resolve({ error: opts.failTable === table ? { message: "boom" } : null });
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          in: (col: string, vals: string[]) => {
            log.push(`update ${table} ${JSON.stringify(patch)} where ${col} in ${JSON.stringify(vals)}`);
            return Promise.resolve({ error: opts.failProfileClear ? { message: "boom" } : null });
          },
        }),
      };
    },
  };
  return { client, log };
}

Deno.test("deleteEbayDataForUser: matches on userId and username, deletes eBay tables, clears profile last", async () => {
  const { client, log } = fakeSupabase({ profiles: [{ id: "u1" }] });
  const result = await deleteEbayDataForUser(client, { userId: "ebayUserA", username: "sellerA" });
  assertEquals(result, { profilesMatched: 1 });
  assertEquals(log[0], 'select profiles where ebay_username in ["ebayUserA","sellerA"]');
  for (const [i, table] of EBAY_DATA_TABLES.entries()) {
    assertEquals(log[i + 1], `delete ${table} where user_id in ["u1"]`);
  }
  const last = log[log.length - 1];
  assertEquals(last.startsWith("update profiles"), true);
  assertEquals(last.includes('"ebay_access_token":null'), true);
  assertEquals(last.includes('"ebay_refresh_token":null'), true);
  assertEquals(last.includes('"ebay_username":null'), true);
});

Deno.test("deleteEbayDataForUser: never deletes user-authored content or the account", () => {
  for (const kept of ["drafts", "listing_cogs", "reprice_rules", "market_watches", "subscriptions", "profiles"]) {
    assertEquals((EBAY_DATA_TABLES as readonly string[]).includes(kept), false);
  }
});

Deno.test("deleteEbayDataForUser: no matching profile is a success and touches nothing", async () => {
  const { client, log } = fakeSupabase({ profiles: [] });
  assertEquals(await deleteEbayDataForUser(client, { userId: "ghost" }), { profilesMatched: 0 });
  assertEquals(log.length, 1);
});

Deno.test("deleteEbayDataForUser: no usable identifiers does not query at all", async () => {
  const { client, log } = fakeSupabase();
  assertEquals(await deleteEbayDataForUser(client, { userId: "", username: undefined }), { profilesMatched: 0 });
  assertEquals(log.length, 0);
});

Deno.test("deleteEbayDataForUser: a failed delete throws and leaves the profile identifier intact for the retry", async () => {
  const { client, log } = fakeSupabase({ profiles: [{ id: "u1" }], failTable: "competitor_prices" });
  await assertRejects(() => deleteEbayDataForUser(client, { userId: "x" }), Error, "competitor_prices");
  assertEquals(log.some((l) => l.startsWith("update profiles")), false);
});

Deno.test("deleteEbayDataForUser: a failed profile clear throws", async () => {
  const { client } = fakeSupabase({ profiles: [{ id: "u1" }], failProfileClear: true });
  await assertRejects(() => deleteEbayDataForUser(client, { userId: "x" }), Error, "profile clear");
});
