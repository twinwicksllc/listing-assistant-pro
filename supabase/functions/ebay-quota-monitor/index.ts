import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";
import { captureException, initSentry } from "../_helpers/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "twinwicksllc@gmail.com";

// Follow-on to PR #580 (Phase 1.2b's search fan-out cap), which fixed the
// self-inflicted call-volume spike behind a real production 429 pattern.
// eBay's Browse API has a real, hard 5,000-calls/day limit per client_id.
// A live getRateLimits check on this account's real keyset (2026-09-17)
// showed buy.browse at 73.8% used (3,690/5,000) BEFORE this monitor existed
// -- confirming the risk was real, not theoretical. Reset timing: every
// resource checked, buy.browse included, reset at the same wall-clock
// timestamp (midnight Pacific) -- a shared calendar-style reset for this
// account, NOT the "rolling 24h window from first call" a web-search lookup
// initially (and incorrectly) reported. Always trust each poll's own
// `reset` field over any assumption about the reset schedule's shape.
// #580 reduced the RATE of waste; this makes the REMAINING budget visible,
// via two complementary signals rather than one:
//   1. The hourly poll below (authoritative -- eBay's own real numbers).
//   2. ebay_browse_call_log's same-day running count (early-warning
//      heuristic between polls, incremented at each Browse API call site --
//      see competitorSearch.ts/market-watch-refresh/keyword-research).
// These two can drift: the same-day counter's query window is always
// "today in UTC" (todayStart below, setUTCHours(0,0,0,0)) regardless of
// when eBay's own quota actually resets for this account (observed as
// midnight Pacific = 07:00/08:00 UTC depending on DST) -- so a call made
// between midnight UTC and eBay's real reset can be attributed to the
// wrong "day" relative to eBay's own window. This is an accepted, disclosed
// heuristic-vs-ground-truth mismatch, not a bug: the counter is early-
// warning only, and the hourly poll (which reads eBay's own `reset` field
// directly) re-anchors ground truth each time it runs regardless of this
// drift. (Copilot review, PR #581, flagged the original wording here as
// misleading -- it previously implied a deploy-triggered reset, which
// this table has no mechanism for.)
const WARN_THRESHOLD_RATIO = 0.9;
const BROWSE_RESOURCE_NAME = "buy.browse";

// ebay_browse_call_log is append-only and only ever read via a same-day
// (gte todayStart) query -- every row older than "today" is dead weight
// from the moment it's written. Flagged by Copilot review on PR #581 as a
// real, non-blocking gap; now folded into this cron (already running
// hourly, already has the right auth) rather than standing up a whole new
// function/migration/RBR-0028 entry for a one-line delete. Retention keeps
// a few days (not just "today") so a recent spike can still be
// investigated after the fact -- nothing reads past the same-day window
// today, so this is headroom, not a requirement.
const RETENTION_DAYS = 3;

interface EbayRateLimitRate {
  limit: number;
  remaining: number;
  reset: string;
  timeWindow?: number;
}

interface EbayRateLimitResource {
  name: string;
  rates: EbayRateLimitRate[];
}

interface EbayRateLimitContext {
  apiContext: string;
  apiName?: string;
  resources: EbayRateLimitResource[];
}

async function getEbayAppToken(ebayEnv: string): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to get eBay OAuth token: ${resp.status} — ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.access_token as string;
}

// eBay's docs have been inconsistent about whether this endpoint lives at
// v1 or v1_beta -- scripts/check-ebay-rate-limit.ps1 (the manual companion
// tool) already anticipated this with a try-v1-then-v1_beta fallback, but
// this deployed function did not, and on 2026-09-18 v1 started 404ing here
// while the manual script's v1_beta fallback still worked. That gap left
// this monitor silently 500ing on every hourly tick (confirmed via
// net._http_response: `{"error":"getRateLimits failed: 404 — "}"` on every
// run for at least 6+ hours) while the real quota was fully exhausted
// (8,200/5,000 used, confirmed via the manual script) with zero alert ever
// sent -- exactly the failure this monitor exists to catch. v1 is tried
// first (still the documented primary path) and v1_beta only on a 404,
// matching the script's own reasoning: a 404 means "wrong path, try the
// other one," while any other non-OK status is a real error (auth/scope/
// rate-limit-on-the-rate-limit-endpoint itself) that retrying at a
// different path won't fix.
const RATE_LIMIT_PATHS = ["v1", "v1_beta"] as const;

/**
 * Fetches eBay's getRateLimits response, trying each of RATE_LIMIT_PATHS in
 * order and falling back to the next only on a 404. Exported so the
 * fallback/fail-fast decision has direct test coverage against a mocked
 * `fetch`, without depending on which path eBay actually serves today.
 */
export async function fetchEbayRateLimits(
  token: string,
  ebayEnv: string,
): Promise<EbayRateLimitContext[]> {
  const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const attempts: string[] = [];

  for (const version of RATE_LIMIT_PATHS) {
    const url = `${apiBase}/developer/analytics/${version}/rate_limit/`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (resp.ok) {
      const data = await resp.json();
      return data?.rateLimits ?? [];
    }

    const body = await resp.text();
    attempts.push(`${version}: ${resp.status} — ${body.slice(0, 200)}`);
    if (resp.status !== 404) {
      // A non-404 failure (auth, scope, upstream error) won't be fixed by
      // trying the other version -- fail now instead of masking it behind
      // a second, doomed-to-fail-the-same-way attempt.
      break;
    }
  }

  // Distinguish "tried every fallback path and all 404'd" from "failed fast
  // on the first non-404 without trying v1_beta at all" -- saying "all
  // paths" for the latter would mislead an operator into thinking v1_beta
  // was attempted when it was deliberately skipped (Copilot review).
  const summary = attempts.length === RATE_LIMIT_PATHS.length
    ? `all paths failed — ${attempts.join(" | ")}`
    : `failed fast on a non-404 (no fallback attempted) — ${attempts.join(" | ")}`;
  throw new Error(`getRateLimits failed: ${summary}`);
}

/**
 * Finds the buy.browse resource's rate entry inside eBay's nested
 * rateLimits -> resources -> rates response shape. Exported so the parsing
 * logic (which nesting level actually holds what) has direct test coverage
 * without needing a live HTTP call.
 *
 * Matches the EXACT resource name (case-insensitive), not a substring --
 * a live getRateLimits response for this account also includes
 * `buy.browse.item.bulk` as a separate resource with its own quota, and a
 * substring match on "browse" could pick that one up first depending on
 * response ordering, persisting/alerting on the wrong quota entirely
 * (Copilot review, PR #581).
 */
export function findBrowseRate(
  rateLimits: EbayRateLimitContext[],
): { resource: EbayRateLimitResource; rate: EbayRateLimitRate } | null {
  const target = BROWSE_RESOURCE_NAME.toLowerCase();
  for (const ctx of rateLimits) {
    for (const resource of ctx.resources ?? []) {
      if (resource.name?.toLowerCase() === target) {
        const rate = resource.rates?.[0];
        if (rate) return { resource, rate };
      }
    }
  }
  return null;
}

/**
 * Decides whether either signal (eBay's own poll, or this app's own
 * same-day counter) has crossed WARN_THRESHOLD_RATIO of the known limit.
 * Pure function so the boundary case (exactly 90%) has direct test
 * coverage without a live poll or DB round trip.
 */
export function shouldWarn(
  limit: number,
  pollRemaining: number,
  sameDayCount: number,
): { warn: boolean; reason: string } {
  if (limit <= 0) return { warn: false, reason: "no known limit" };
  const pollUsedRatio = (limit - pollRemaining) / limit;
  const countRatio = sameDayCount / limit;
  if (pollUsedRatio >= WARN_THRESHOLD_RATIO) {
    return {
      warn: true,
      reason: `eBay's own poll reports ${pollRemaining}/${limit} remaining (${(pollUsedRatio * 100).toFixed(1)}% used)`,
    };
  }
  if (countRatio >= WARN_THRESHOLD_RATIO) {
    return {
      warn: true,
      reason: `same-day counter has logged ${sameDayCount} calls against a ${limit}/day limit (${
        (countRatio * 100).toFixed(1)
      }%)`,
    };
  }
  return { warn: false, reason: "below threshold" };
}

/**
 * Decides whether this invocation should run the (once/day) call-log prune,
 * given the current UTC hour this cron tick landed on. Pure so the "only on
 * the designated hour" guard has direct test coverage without a live clock
 * or DB round trip. This cron runs hourly (`31 * * * *`); running the prune
 * on every tick would be 24 redundant DELETEs/day for no benefit, so it's
 * gated to a single hour.
 */
export function shouldPruneThisTick(utcHour: number): boolean {
  return utcHour === 0;
}

/**
 * Deletes ebay_browse_call_log rows older than RETENTION_DAYS. Exported so
 * the cutoff math, the table/filter targeted, and the error path all have
 * direct test coverage against a fake Supabase client -- the earlier
 * version only had test coverage on shouldPruneThisTick's hour guard, never
 * on this function itself (Copilot review, PR #582).
 */
export async function pruneOldCallLogRows(
  // deno-lint-ignore no-explicit-any -- matches competitorSearch.ts's
  // logBrowseApiCall, which takes the same loosely-typed supabase-js client
  // for the same reason (avoids fighting the generated client's generics).
  svc: any,
  now: Date = new Date(),
): Promise<{ pruned: boolean; error?: string }> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await svc
    .from("ebay_browse_call_log")
    .delete()
    .lt("created_at", cutoff.toISOString());
  if (error) {
    console.error("[ebay-quota-monitor] Call-log prune failed:", error.message);
    captureException(new Error(`Call-log prune failed: ${error.message}`), {
      function: "ebay-quota-monitor",
    });
    return { pruned: false, error: error.message };
  }
  return { pruned: true };
}

/**
 * Counts today's ebay_browse_call_log rows against the buy.browse pool
 * specifically. Exported so the resource="buy.browse" filter -- the fix
 * for a real regression risk found during the getItems follow-on work's
 * planning (an unfiltered count would let a burst of cheap getItems calls
 * falsely inflate this early-warning heuristic for a pool nowhere near
 * exhausted) -- has direct test coverage against a fake Supabase client,
 * same pattern as pruneOldCallLogRows.
 */
export async function countSameDayBrowseCalls(
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing (pruneOldCallLogRows, etc.).
  svc: any,
  todayStart: Date,
): Promise<{ count: number | null; error: { message: string } | null }> {
  const { count, error } = await svc
    .from("ebay_browse_call_log")
    .select("*", { count: "exact", head: true })
    // Reuses the same constant findBrowseRate/the poll insert derive the
    // resource name from, so a future rename can't make the quota poll and
    // this same-day counter silently disagree (Copilot review, PR #599).
    .eq("resource", BROWSE_RESOURCE_NAME)
    .gte("created_at", todayStart.toISOString());
  return { count: count ?? null, error: error ?? null };
}

async function sendQuotaAlertEmail(params: {
  limit: number;
  pollRemaining: number;
  sameDayCount: number;
  reason: string;
  resetAt: string;
}): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.log("[ebay-quota-monitor] No RESEND_API_KEY configured. Skipping email.");
    return false;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        // rankedceo.com is the only verified Resend sending domain on this
        // account -- see cost-alert-cron/index.ts's RBR-0031 comment for why.
        from: "Sovereign Listing Suite Alerts <alerts@rankedceo.com>",
        to: [ADMIN_EMAIL],
        subject: `⚠️ eBay Browse API quota warning: ${params.reason}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626; margin-bottom: 16px;">⚠️ eBay Browse API quota warning</h2>
            <p style="color: #374151; font-size: 16px;">${params.reason}</p>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Daily limit</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 18px; color: #374151;">${params.limit}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Remaining (eBay's own poll)</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 18px; color: #dc2626;">${params.pollRemaining}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Same-day call count (our counter)</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #374151;">${params.sameDayCount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Quota resets at</td>
                  <td style="padding: 8px 0; text-align: right; color: #374151;">${params.resetAt}</td>
                </tr>
              </table>
            </div>
            <p style="color: #6b7280; font-size: 14px;">Reset timing observed on this account: a shared wall-clock reset (midnight Pacific), not a rolling window from first call. Always check this poll's own reset time above, not an assumption about the reset schedule's shape.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px;">This is an automated alert from Sovereign AI Assistant.</p>
          </div>
        `,
      }),
    });

    if (resp.ok) return true;
    const errBody = await resp.text();
    console.error("[ebay-quota-monitor] Resend API error:", errBody);
    captureException(new Error(`Resend API error: ${errBody}`), { function: "ebay-quota-monitor" });
    return false;
  } catch (err) {
    console.error("[ebay-quota-monitor] Email sending failed:", err);
    captureException(err, { function: "ebay-quota-monitor" });
    return false;
  }
}

serve(async (req) => {
  initSentry();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[ebay-quota-monitor] auth rejected:",
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

  // Run the prune independently of the eBay poll below, and before it --
  // the poll can fail or short-circuit (token error, getRateLimits error,
  // no buy.browse resource found) well before reaching the poll's own
  // success path, and since shouldPruneThisTick only allows the 00:00 UTC
  // tick, a poll outage at exactly that hour would otherwise skip pruning
  // until the next day with no retry, letting the append-only table grow
  // unboundedly during exactly the kind of outage this is meant to be
  // resilient to (Copilot review, PR #582).
  let pruneResult: { pruned: boolean; error?: string } | null = null;
  if (shouldPruneThisTick(new Date().getUTCHours())) {
    pruneResult = await pruneOldCallLogRows(svc);
  }

  try {
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
    const token = await getEbayAppToken(ebayEnv);
    const rateLimits = await fetchEbayRateLimits(token, ebayEnv);
    const found = findBrowseRate(rateLimits);

    if (!found) {
      console.warn("[ebay-quota-monitor] No buy.browse resource found in getRateLimits response");
      return new Response(
        JSON.stringify({
          warned: false,
          reason: "buy.browse resource not found in response",
          pruned: pruneResult?.pruned ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { resource, rate } = found;
    const callCount = rate.limit - rate.remaining;

    // Same-day dedup: this cron runs once/day, so "already alerted today"
    // in practice means "did today's earlier run (if any) already send an
    // email" -- checked BEFORE this poll's own insert, mirroring
    // cost-alert-cron's check-before-insert ordering. On a query error,
    // fail closed (assume "already alerted") rather than risk a duplicate
    // email storm from a transient DB blip (Copilot review, PR #581) --
    // missing one alert email for a day is a much smaller cost than
    // spamming one every retry.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: priorAlertToday, error: dedupErr } = await svc
      .from("ebay_rate_limit_polls")
      .select("id")
      .eq("alert_sent", true)
      .gte("polled_at", todayStart.toISOString())
      .limit(1);
    if (dedupErr) {
      console.error("[ebay-quota-monitor] Same-day dedup query failed, failing closed:", dedupErr.message);
      captureException(new Error(`Dedup query failed: ${dedupErr.message}`), { function: "ebay-quota-monitor" });
    }
    const alreadyAlertedToday = dedupErr ? true : (priorAlertToday?.length ?? 0) > 0;

    // Same-day running count from this app's own counter, independent of
    // eBay's poll -- see the migration's comment for why this needed its own
    // table rather than reusing usage_tracking (NOT NULL user_id there,
    // this is an app-level count). Extracted to a standalone function (below
    // this handler) so the resource="buy.browse" filter has direct test
    // coverage against a fake Supabase client, matching pruneOldCallLogRows'
    // own precedent (Copilot review, PR #582).
    const { count: sameDayCountRaw, error: countErr } = await countSameDayBrowseCalls(svc, todayStart);
    if (countErr) {
      console.error("[ebay-quota-monitor] Same-day count query failed:", countErr.message);
      captureException(new Error(`Same-day count query failed: ${countErr.message}`), {
        function: "ebay-quota-monitor",
      });
    }
    const sameDayCount = countErr ? null : (sameDayCountRaw ?? 0);

    const verdict = shouldWarn(rate.limit, rate.remaining, sameDayCount ?? 0);
    const shouldSendEmail = verdict.warn && !alreadyAlertedToday;

    console.log(
      `[ebay-quota-monitor] limit=${rate.limit} remaining=${rate.remaining} sameDayCount=${
        sameDayCount ?? "unknown"
      } reset=${rate.reset} warn=${verdict.warn} alreadyAlertedToday=${alreadyAlertedToday}`,
    );

    let emailSent = false;
    if (shouldSendEmail) {
      emailSent = await sendQuotaAlertEmail({
        limit: rate.limit,
        pollRemaining: rate.remaining,
        sameDayCount: sameDayCount ?? 0,
        reason: verdict.reason,
        resetAt: rate.reset,
      });
    } else if (verdict.warn && alreadyAlertedToday) {
      console.log("[ebay-quota-monitor] Already alerted today — recording the poll without a duplicate email");
    }

    // Record `alert_sent` as whether the email actually succeeded, not
    // merely whether one was attempted -- shouldSendEmail alone would mark
    // an unsent alert (missing RESEND_API_KEY, Resend outage, network
    // failure) as sent, permanently suppressing any retry for the rest of
    // the day (Copilot review, PR #581).
    const { error: insertErr } = await svc.from("ebay_rate_limit_polls").insert({
      resource_name: resource.name,
      api_context: BROWSE_RESOURCE_NAME.split(".")[0],
      call_limit: rate.limit,
      call_count: callCount,
      call_remaining: rate.remaining,
      reset_at: rate.reset,
      time_window_seconds: rate.timeWindow ?? null,
      alert_sent: emailSent,
    });
    if (insertErr) {
      // The authoritative poll snapshot is now lost for this run -- this
      // must be visible to an operator, not just a console log nobody
      // watches routinely (Copilot review, PR #581).
      console.error("[ebay-quota-monitor] Failed to persist poll snapshot:", insertErr.message);
      captureException(new Error(`Poll insert failed: ${insertErr.message}`), { function: "ebay-quota-monitor" });
    }

    return new Response(
      JSON.stringify({
        warned: verdict.warn,
        emailSent,
        reason: verdict.reason,
        limit: rate.limit,
        remaining: rate.remaining,
        sameDayCount: sameDayCount ?? null,
        pollPersisted: !insertErr,
        pruned: pruneResult?.pruned ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ebay-quota-monitor] Error:", msg);
    captureException(err, { function: "ebay-quota-monitor" });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
