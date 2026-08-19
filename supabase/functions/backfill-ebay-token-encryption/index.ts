import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";
import { encryptToken, isEncryptedToken } from "../_helpers/tokenCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * One-off backfill for RBR-0020: re-encrypts any `profiles.ebay_access_token`/
 * `ebay_refresh_token` still in legacy plaintext (rows written before the
 * encrypt-on-write change shipped). Not scheduled -- invoke manually once via
 * curl with CRON_SECRET after that change has deployed. Idempotent: rows
 * already in `v1:` format are skipped, so re-running it is harmless.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[BACKFILL-EBAY-TOKEN-ENCRYPTION] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let scanned = 0;
  let alreadyEncrypted = 0;
  let backfilled = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  try {
    const { data: profiles, error } = await svc
      .from("profiles")
      .select("id, ebay_access_token, ebay_refresh_token")
      .or("ebay_access_token.not.is.null,ebay_refresh_token.not.is.null");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const profile of profiles ?? []) {
      scanned++;
      const patch: Record<string, string> = {};

      if (profile.ebay_access_token && !isEncryptedToken(profile.ebay_access_token)) {
        patch.ebay_access_token = await encryptToken(profile.ebay_access_token);
      }
      if (profile.ebay_refresh_token && !isEncryptedToken(profile.ebay_refresh_token)) {
        patch.ebay_refresh_token = await encryptToken(profile.ebay_refresh_token);
      }

      if (Object.keys(patch).length === 0) {
        alreadyEncrypted++;
        continue;
      }

      const { error: updateError } = await svc
        .from("profiles")
        .update(patch)
        .eq("id", profile.id);

      if (updateError) {
        errors.push({ userId: profile.id, error: updateError.message });
      } else {
        backfilled++;
      }
    }

    console.log(
      "[BACKFILL-EBAY-TOKEN-ENCRYPTION] done:",
      JSON.stringify({ scanned, alreadyEncrypted, backfilled, errors: errors.length }),
    );

    return new Response(
      JSON.stringify({ scanned, alreadyEncrypted, backfilled, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[BACKFILL-EBAY-TOKEN-ENCRYPTION] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
