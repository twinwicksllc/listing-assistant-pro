import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_helpers/authGuard.ts";
import { refreshEbayAccessToken } from "../_helpers/ebayTokenRefresh.ts";
import { decryptToken } from "../_helpers/tokenCrypto.ts";
import {
  fetchLiveListings,
  isAllowedUser,
  parseBody,
  parseCandidates,
  runCleanup,
  tradingApiUrlFor,
} from "../_helpers/ebayDraftCleanup.ts";

// One-off cleanup of leftover UNPUBLISHED Inventory API offers. Owner-only.
//
// POST { candidates: [{ offerId, sku, listingId? }, ...], dryRun?: boolean }
//   - dryRun defaults to true: every offer is verified against eBay and the
//     response says what WOULD be deleted, but nothing is changed.
//   - Deletion only happens when dryRun is exactly false.
//   - Only offers are deleted -- never inventory items, never published offers.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Complete caller graph: only a person calls this (no cron, no internal
  // function), so end-user auth, not the service-role key.
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.message }, auth.status);
  const userId = auth.userId as string;
  if (!isAllowedUser(userId, Deno.env.get("EBAY_DRAFT_CLEANUP_USER_IDS"))) {
    return json({ error: "Not permitted" }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  // A JSON body of `null` is valid JSON, so it lands here as null -- reject it
  // as a 400 rather than crashing on a field access.
  const body = parseBody(raw);
  if (!body.ok) return json({ error: body.error }, 400);
  const parsed = parseCandidates(body.candidates);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const dryRun = body.dryRun;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  // The caller's own eBay token -- same load/refresh pattern as
  // _helpers/ebayInventorySync.ts.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("ebay_access_token, ebay_refresh_token, ebay_token_expires_at")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) return json({ error: "Could not load eBay connection" }, 500);

  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  let userToken = await decryptToken(profile.ebay_access_token);
  const expiresAt = profile.ebay_token_expires_at ? new Date(profile.ebay_token_expires_at).getTime() : 0;
  // Refresh with a margin so a token cannot expire halfway through a batch.
  if (!userToken || expiresAt - Date.now() < 10 * 60 * 1000) {
    const refreshToken = await decryptToken(profile.ebay_refresh_token);
    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    if (!refreshToken || !clientId || !clientSecret) {
      return json({ error: "eBay token expired. Reconnect eBay in Settings." }, 409);
    }
    const tokenUrl = ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
    const refreshed = await refreshEbayAccessToken(supabase, userId, refreshToken, {
      clientId,
      clientSecret,
      tokenUrl,
    });
    if (!refreshed.ok) return json({ error: "eBay token refresh failed. Reconnect eBay in Settings." }, 409);
    userToken = refreshed.accessToken;
  }

  // Fail closed: without a complete picture of what is live, delete nothing.
  const liveResult = await fetchLiveListings(tradingApiUrlFor(apiBase), userToken);
  if (!liveResult.ok) {
    return json({ error: `Could not read active listings: ${liveResult.error}` }, 502);
  }

  const run = await runCleanup({
    candidates: parsed.candidates,
    apiBase,
    userToken,
    live: liveResult.live,
    dryRun,
  });
  // Count only. No tokens, titles or customer data in logs.
  console.log(`ebay-draft-cleanup: dryRun=${dryRun} summary=${JSON.stringify(run.summary)}`);

  return json({
    dryRun,
    activeListingsSeen: liveResult.live.itemIds.size,
    summary: run.summary,
    needsAuth: run.unauthorized,
    results: run.results,
  });
});
