import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  describeCronAuthEnv,
  requireCronSecret,
  requireServiceRole,
  requireUser,
  requireUserOrServiceRole,
} from "./authGuard.ts";

const FAKE_SERVICE_KEY = "fake-service-role-key";
const FAKE_CRON_SECRET = "fake-cron-shared-secret";
const deps = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceKey: FAKE_SERVICE_KEY,
  verifyJwt: async (jwt: string) => jwt === "valid-user-jwt" ? "user-123" : null,
};

const cronDeps = { ...deps, cronSecret: FAKE_CRON_SECRET };

function reqWithAuth(bearer?: string) {
  const headers = new Headers();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://example.com/fn", { headers });
}

Deno.test("requireUser: rejects missing Authorization header", async () => {
  assertEquals((await requireUser(reqWithAuth(), deps)).ok, false);
});

Deno.test("requireUser: rejects the service-role key (not a user)", async () => {
  assertEquals((await requireUser(reqWithAuth(FAKE_SERVICE_KEY), deps)).ok, false);
});

Deno.test("requireUser: accepts a valid user JWT", async () => {
  const result = await requireUser(reqWithAuth("valid-user-jwt"), deps);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.userId, "user-123");
});

Deno.test("requireUserOrServiceRole: accepts the exact service-role key", async () => {
  const result = await requireUserOrServiceRole(reqWithAuth(FAKE_SERVICE_KEY), deps);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.isServiceRole, true);
});

Deno.test("requireUserOrServiceRole: accepts a valid user JWT", async () => {
  const result = await requireUserOrServiceRole(reqWithAuth("valid-user-jwt"), deps);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.isServiceRole, false);
});

Deno.test("requireUserOrServiceRole: rejects garbage/anon tokens", async () => {
  assertEquals(
    (await requireUserOrServiceRole(reqWithAuth("anon-key-or-garbage"), deps)).ok,
    false,
  );
});

Deno.test("requireServiceRole: rejects a valid user JWT", async () => {
  assertEquals((await requireServiceRole(reqWithAuth("valid-user-jwt"), deps)).ok, false);
});

Deno.test("requireServiceRole: accepts the exact service-role key only", async () => {
  assertEquals((await requireServiceRole(reqWithAuth(FAKE_SERVICE_KEY), deps)).ok, true);
});

Deno.test("requireServiceRole: rejects when no Authorization header present", async () => {
  assertEquals((await requireServiceRole(reqWithAuth(), deps)).ok, false);
});

// --- requireCronSecret ------------------------------------------------------
// Guards pg_cron-invoked endpoints. Accepts a dedicated shared secret the
// operator sets on both sides, and still accepts the service-role key so
// existing internal callers keep working. See RBR-0025.

Deno.test("requireCronSecret: accepts the cron shared secret", async () => {
  const result = await requireCronSecret(reqWithAuth(FAKE_CRON_SECRET), cronDeps);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.isServiceRole, true);
});

Deno.test("requireCronSecret: still accepts the service-role key", async () => {
  const result = await requireCronSecret(reqWithAuth(FAKE_SERVICE_KEY), cronDeps);
  assertEquals(result.ok, true);
});

Deno.test("requireCronSecret: rejects a valid user JWT", async () => {
  assertEquals(
    (await requireCronSecret(reqWithAuth("valid-user-jwt"), cronDeps)).ok,
    false,
  );
});

Deno.test("requireCronSecret: rejects a missing Authorization header", async () => {
  assertEquals((await requireCronSecret(reqWithAuth(), cronDeps)).ok, false);
});

Deno.test("requireCronSecret: rejects garbage tokens", async () => {
  assertEquals(
    (await requireCronSecret(reqWithAuth("anon-key-or-garbage"), cronDeps)).ok,
    false,
  );
});

// An unset CRON_SECRET must not degrade into accepting the empty string, which
// is what an unconfigured deployment would send if a Vault lookup returned NULL.
Deno.test("requireCronSecret: rejects empty token when cron secret unset", async () => {
  const noCron = { ...deps, cronSecret: "" };
  assertEquals((await requireCronSecret(reqWithAuth(""), noCron)).ok, false);
});

Deno.test("requireCronSecret: rejects a near-miss secret differing in length", async () => {
  assertEquals(
    (await requireCronSecret(reqWithAuth(FAKE_CRON_SECRET + "x"), cronDeps)).ok,
    false,
  );
});

// --- describeCronAuthEnv ----------------------------------------------------
// Logged on a 401 so the operator can see the runtime's own view. It must expose
// lengths and booleans only -- never any part of a secret.

Deno.test("describeCronAuthEnv: reports configuration without leaking secrets", () => {
  const summary = describeCronAuthEnv(reqWithAuth("some-presented-token"), cronDeps);
  const serialised = JSON.stringify(summary);
  assertEquals(serialised.includes(FAKE_CRON_SECRET), false);
  assertEquals(serialised.includes(FAKE_SERVICE_KEY), false);
  assertEquals(serialised.includes("some-presented-token"), false);
  assertEquals(summary.cronSecretConfigured, true);
  assertEquals(summary.cronSecretLength, FAKE_CRON_SECRET.length);
  assertEquals(summary.presentedTokenLength, "some-presented-token".length);
});

Deno.test("describeCronAuthEnv: flags an unconfigured cron secret", () => {
  const summary = describeCronAuthEnv(reqWithAuth("t"), { ...deps, cronSecret: "" });
  assertEquals(summary.cronSecretConfigured, false);
  assertEquals(summary.cronSecretLength, 0);
});

Deno.test("describeCronAuthEnv: surfaces a length match, the usual near-miss clue", () => {
  const sameLength = "x".repeat(FAKE_CRON_SECRET.length);
  const summary = describeCronAuthEnv(reqWithAuth(sameLength), cronDeps);
  assertEquals(summary.lengthMatchesCronSecret, true);
});
