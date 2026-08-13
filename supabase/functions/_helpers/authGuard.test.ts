import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  requireServiceRole,
  requireUser,
  requireUserOrServiceRole,
} from "./authGuard.ts";

const FAKE_SERVICE_KEY = "fake-service-role-key";
const deps = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceKey: FAKE_SERVICE_KEY,
  verifyJwt: async (jwt: string) =>
    jwt === "valid-user-jwt" ? "user-123" : null,
};

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
