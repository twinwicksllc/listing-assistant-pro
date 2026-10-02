import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  computeChallengeResponse,
  deleteEbayDataForUser,
  fetchEbayAppToken,
  getEbayPublicKey,
  parseSignatureHeader,
  verifyNotificationSignature,
} from "../_helpers/ebayAccountDeletion.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// eBay calls this directly with no Supabase JWT (verify_jwt = false). GET
// answers the one-time ownership challenge; POST carries deletion notices and
// is authenticated by the x-ebay-signature header instead.
serve(async (req: Request) => {
  if (req.method === "GET") {
    const challengeCode = new URL(req.url).searchParams.get("challenge_code");
    const verificationToken = Deno.env.get("EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN");
    const endpoint = Deno.env.get("EBAY_ACCOUNT_DELETION_ENDPOINT");
    if (!verificationToken || !endpoint) {
      console.error("[ebay-account-deletion] verification token or endpoint secret not configured");
      return json({ error: "Server misconfiguration" }, 500);
    }
    if (!challengeCode) return json({ error: "challenge_code required" }, 400);
    return json({ challengeResponse: await computeChallengeResponse(challengeCode, verificationToken, endpoint) });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("[ebay-account-deletion] EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
    return json({ error: "Server misconfiguration" }, 500);
  }

  // Signature is checked against the raw bytes eBay sent, before any parsing.
  const rawBody = await req.text();
  const signature = parseSignatureHeader(req.headers.get("x-ebay-signature"));
  if (!signature) return json({ error: "Missing or malformed signature" }, 412);

  let valid: boolean;
  try {
    const publicKey = await getEbayPublicKey(signature.kid, {
      getAppToken: () => fetchEbayAppToken(clientId, clientSecret),
    });
    valid = verifyNotificationSignature(rawBody, signature, publicKey);
  } catch (err) {
    // Not a verdict on the notification: 503 makes eBay resend it.
    console.error("[ebay-account-deletion] could not verify signature:", err instanceof Error ? err.message : err);
    return json({ error: "Unable to verify signature" }, 503);
  }
  if (!valid) {
    console.warn("[ebay-account-deletion] signature verification failed");
    return json({ error: "Signature verification failed" }, 412);
  }

  // deno-lint-ignore no-explicit-any -- payload shape is eBay's, validated field by field below.
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const notificationId = String(payload?.notification?.notificationId ?? "unknown");
  if (payload?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") {
    console.warn(`[ebay-account-deletion] ignoring unexpected topic, notification ${notificationId}`);
    return json({ ok: true });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { profilesMatched } = await deleteEbayDataForUser(supabase, {
      userId: payload?.notification?.data?.userId,
      username: payload?.notification?.data?.username,
    });
    // Identifiers are deliberately not logged -- they are the personal data being deleted.
    console.log(`[ebay-account-deletion] notification ${notificationId}: ${profilesMatched} account(s) cleared`);
    return json({ ok: true });
  } catch (err) {
    console.error(
      `[ebay-account-deletion] notification ${notificationId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return json({ error: "Deletion failed" }, 500);
  }
});
