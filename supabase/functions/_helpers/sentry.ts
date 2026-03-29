// Sentry error tracking for Deno edge functions
// Initialize in each function with: import { initSentry, captureException } from "../_helpers/sentry.ts"

import * as Sentry from "https://npm.tinylibs.com/@sentry/deno@^1.0.0";

let initialized = false;

export function initSentry() {
  if (initialized) return;

  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) {
    console.warn(
      "[Sentry] SENTRY_DSN not set - error tracking disabled. Set it to enable production monitoring.",
    );
    return;
  }

  Sentry.init({
    dsn,
    environment: Deno.env.get("ENVIRONMENT") || "production",
    tracesSampleRate: 0.1, // 10% of transactions to avoid quota overages
    beforeSend(event) {
      // Filter out non-error events in production
      if (event.level !== "error" && Deno.env.get("ENVIRONMENT") === "production") {
        return null;
      }
      return event;
    },
  });

  initialized = true;
}

export function captureException(error: Error | unknown, context?: Record<string, any>) {
  if (!Deno.env.get("SENTRY_DSN")) return; // Silent if not configured

  if (error instanceof Error) {
    Sentry.captureException(error, {
      contexts: {
        custom: context,
      },
    });
  } else {
    Sentry.captureException(new Error(String(error)), {
      contexts: {
        custom: context,
      },
    });
  }
}

export async function withSentryScope<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!Deno.env.get("SENTRY_DSN")) {
    return fn(); // Skip if Sentry not configured
  }

  return Sentry.startSpan(
    {
      op: "function",
      name,
    },
    fn,
  );
}
