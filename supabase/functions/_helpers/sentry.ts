// Real Sentry error tracking for Deno Edge Functions, via a hand-rolled
// fetch-based envelope reporter rather than importing the Sentry SDK.
//
// RBR-0032: a prior attempt imported the Sentry Deno SDK from a CDN, which
// caused deployment-time timeout/reliability issues (see the git history of
// this file), so error tracking has been a no-op stub ever since. Rather than
// retry a CDN or npm: SDK import, this sends events directly to Sentry's
// ingest API using nothing but `fetch()` -- no external dependency, no
// bundling risk, same interface (`initSentry`, `captureException`,
// `withSentryScope`) so none of this file's three callers (analyze-item,
// ebay-pricing, ebay-publish) needed to change.
//
// Sentry's envelope protocol: https://develop.sentry.dev/sdk/envelopes/
// DSN format: https://<public_key>@<host>/<project_id>

let initialized = false;
let dsnCache: string | undefined;

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId || !url.host) return null;
    return { publicKey, host: url.host, projectId };
  } catch {
    return null;
  }
}

// Best-effort background dispatch. EdgeRuntime.waitUntil (Supabase's Deno
// Edge Runtime global) keeps the isolate alive long enough for this fetch to
// complete after the handler's own response has already been sent -- without
// it, a fire-and-forget fetch issued right before the handler returns can be
// cut off mid-flight. Falls back to a bare unawaited call if that global
// isn't present (e.g. running this file under plain `deno test`).
function runInBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work);
  } else {
    work.catch(() => {});
  }
}

async function sendEnvelope(
  dsn: string,
  eventPayload: Record<string, unknown>,
): Promise<void> {
  const parsed = parseDsn(dsn);
  if (!parsed) {
    console.warn("[Error Tracking] SENTRY_DSN is set but could not be parsed");
    return;
  }

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const sentAt = new Date().toISOString();
  const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn });
  const itemHeader = JSON.stringify({ type: "event" });
  const itemPayload = JSON.stringify({
    event_id: eventId,
    timestamp: sentAt,
    platform: "other",
    ...eventPayload,
  });
  const body = `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`;

  try {
    const resp = await fetch(`https://${parsed.host}/api/${parsed.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth":
          `Sentry sentry_version=7, sentry_client=deno-fetch-reporter/1.0, sentry_key=${parsed.publicKey}`,
      },
      body,
    });
    if (!resp.ok) {
      console.warn(`[Error Tracking] Sentry ingest returned ${resp.status}`);
    }
  } catch (e) {
    console.warn("[Error Tracking] Failed to send event to Sentry:", e);
  }
}

/**
 * Initialize Sentry error tracking. Caches the DSN for captureException to
 * use -- does not make any network call itself.
 *
 * @example
 * initSentry();
 */
export function initSentry() {
  if (initialized) return;

  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) {
    initialized = true;
    console.debug(
      "[Error Tracking] SENTRY_DSN not configured - error tracking disabled.",
    );
    return;
  }

  dsnCache = dsn;
  initialized = true;
  console.debug("[Error Tracking] Sentry reporting enabled");
}

/**
 * Capture an error for tracking. Always logs to console (unchanged from
 * before); additionally sends the event to Sentry in the background if
 * SENTRY_DSN is configured. Synchronous by design -- matches every existing
 * caller's fire-and-forget usage (`captureException(e, context)`, not
 * awaited) -- the actual network call is dispatched via runInBackground.
 *
 * @param error - The error to capture
 * @param context - Additional context about the error
 *
 * @example
 * captureException(err, { function: "analyze-item", userId });
 */
export function captureException(
  error: Error | unknown,
  context?: Record<string, any>,
) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";

  console.error(`[Error] ${errorMsg}`, {
    ...(context && { context }),
    ...(errorStack && { stack: errorStack.split("\n").slice(0, 3) }),
  });

  if (!dsnCache) return;

  const frames = (errorStack ?? "")
    .split("\n")
    .slice(1) // first line is the message, not a frame
    .map((line) => ({ function: line.trim() }))
    .filter((f) => f.function.length > 0);

  runInBackground(
    sendEnvelope(dsnCache, {
      level: "error",
      logger: "edge-function",
      environment: Deno.env.get("EBAY_ENVIRONMENT") || "production",
      exception: {
        values: [{
          type: error instanceof Error ? error.name : "Error",
          value: errorMsg,
          ...(frames.length > 0 ? { stacktrace: { frames: frames.reverse() } } : {}),
        }],
      },
      extra: context ?? {},
    }),
  );
}

/**
 * Wrap a function with error scope tracking. Errors thrown inside `fn` are
 * captured (via captureException) before being re-thrown, so callers don't
 * need a separate try/catch just to report.
 *
 * @param name - Name of the operation
 * @param fn - Async function to execute
 * @returns Result of the function
 *
 * @example
 * const result = await withSentryScope("identify_category", async () => {
 *   return await identifyCategory(item);
 * });
 */
export async function withSentryScope<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    console.debug(`[Scope] Starting: ${name}`);
    const result = await fn();
    console.debug(`[Scope] Completed: ${name}`);
    return result;
  } catch (e) {
    console.error(`[Scope] Failed: ${name}`, e);
    captureException(e, { scope: name });
    throw e;
  }
}
