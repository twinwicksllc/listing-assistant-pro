import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ----------------------------------------------------------------
// Fetch the eBay Identity API user record with a bounded retry for
// transient failures (5xx / network errors) -- 2026-09-20 log review found
// a single 502 where eBay's Identity API returned a non-OK, non-401/403
// status with no diagnostic body captured in the retention window. There
// was previously *zero* retry here, so any one-off transient 5xx from eBay
// (or a dropped connection) immediately surfaced as a hard failure instead
// of self-healing on a second attempt. Mirrors the retry pattern already
// used for the Browse API in _helpers/competitorSearch.ts: up to 3
// attempts, retry only on 5xx/network error (4xx, including 401/403, is
// never retried -- eBay is telling us something concrete about the
// request/token, not experiencing a transient blip), capped exponential
// backoff (1.5s, 2.25s).
//
// Exported so retry/backoff behavior can be exercised directly against a
// mocked `globalThis.fetch`, without waiting on real timers or standing up
// a live eBay token.
export async function fetchIdentityWithRetry(
  apiBase: string,
  userToken: string,
): Promise<{ resp: Response | null; lastFetchErr: unknown }> {
  let resp: Response | null = null;
  let lastFetchErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(`${apiBase}/commerce/identity/v1/user/`, {
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
      });
      lastFetchErr = null;

      // Only retry on 5xx -- 4xx is a concrete, non-transient answer.
      if (resp.status < 500) break;

      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(
          `ebay-user: Identity API returned ${resp.status} -- retrying in ${delayMs}ms (attempt ${attempt + 1}/3)`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (fetchErr) {
      lastFetchErr = fetchErr;
      resp = null;
      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(
          `ebay-user: Identity API fetch error (attempt ${attempt + 1}/3) -- retrying in ${delayMs}ms: ${
            String(fetchErr)
          }`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  return { resp, lastFetchErr };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // Verify the caller is an authenticated Supabase user before proxying
    // any request to the eBay Identity API.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwtToken = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(jwtToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userToken } = await req.json();

    // Default to production, matching ebay-publish/category-lookup/etc. --
    // this app's eBay integration is production (confirmed 500+ live
    // listings). A silent sandbox default here would feed a real production
    // OAuth token into eBay's sandbox API, which correctly rejects it -- this
    // is the root cause of a 502 seen live 2026-08-17 (eBay returned 404 for
    // a production token queried against api.sandbox.ebay.com).
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

    if (!userToken) {
      return new Response(JSON.stringify({ needsAuth: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user info from eBay Identity API, with a bounded retry on
    // transient (5xx/network) failures -- see fetchIdentityWithRetry above.
    const { resp: userResp, lastFetchErr } = await fetchIdentityWithRetry(apiBase, userToken);

    if (!userResp) {
      console.error("ebay-user: Identity API unreachable after 3 attempts:", String(lastFetchErr));
      return new Response(
        JSON.stringify({
          error: `eBay API unreachable: ${lastFetchErr instanceof Error ? lastFetchErr.message : String(lastFetchErr)}`,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (userResp.status === 401 || userResp.status === 403) {
      return new Response(JSON.stringify({ needsAuth: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userResp.ok) {
      const errText = await userResp.text();
      // Redacted diagnostic to the function log only -- lengths and a
      // strict-equality boolean, never the raw value, per the pattern
      // adopted for CRON_SECRET debugging. Supabase Edge Function secrets
      // can only be overwritten, never revealed, so if this still 404s after
      // the "default to production" fix (2026-08-14), the only way to tell
      // whether EBAY_ENVIRONMENT is unset vs explicitly set to something
      // other than "production" is from inside the running function.
      const rawEbayEnv = Deno.env.get("EBAY_ENVIRONMENT");
      console.error("eBay user info error:", userResp.status, errText, {
        apiBaseUsed: apiBase,
        ebayEnvIsSet: rawEbayEnv !== undefined,
        ebayEnvLength: rawEbayEnv?.length ?? 0,
        ebayEnvIsExactlyProduction: rawEbayEnv === "production",
      });
      return new Response(
        JSON.stringify({
          error: `eBay API error ${userResp.status}: ${errText}`,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let userData: any;
    try {
      const respText = await userResp.text();
      userData = JSON.parse(respText);
    } catch (e) {
      console.warn(`ebay-user: Failed to parse eBay user API response: ${e}`);
      return new Response(
        JSON.stringify({ error: `eBay API parse error: ${e}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const username = userData.username || "";
    const businessName = userData.businessAccount?.name || "";
    const accountType = userData.accountType || "UNKNOWN";
    const userId = userData.userId || "";

    return new Response(
      JSON.stringify({
        username,
        businessName,
        accountType,
        userId,
        needsAuth: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("ebay-user error:", errorMsg);
    console.error("Full error:", e);
    const isProduction = Deno.env.get("ENVIRONMENT") === "production";
    return new Response(
      JSON.stringify({
        error: `Server error: ${errorMsg}`,
        needsAuth: false,
        debug: !isProduction ? String(e) : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
