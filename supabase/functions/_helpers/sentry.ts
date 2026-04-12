// Sentry error tracking for Deno edge functions
// Initialize in each function with: import { initSentry, captureException } from "../_helpers/sentry.ts"
//
// NOTE: The Sentry import was causing CDN timeout issues during deployment.
// This has been temporarily disabled. To enable Sentry:
// 1. Set up Sentry on your infrastructure
// 2. Create a proxy endpoint or use a reliable CDN
// 3. Import from the proxy instead

let initialized = false;

/**
 * Initialize Sentry error tracking
 * Currently a no-op due to CDN reliability issues
 * 
 * @example
 * initSentry();
 */
export function initSentry() {
  if (initialized) return;
  
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) {
    console.debug(
      "[Error Tracking] SENTRY_DSN not configured - error tracking disabled.",
    );
    return;
  }

  console.debug(
    "[Error Tracking] SENTRY_DSN configured but Sentry client not available",
  );
  initialized = true;
}

/**
 * Capture an error for tracking
 * Currently logs to console - can be upgraded to send to external service
 * 
 * @param error - The error to capture
 * @param context - Additional context about the error
 * 
 * @example
 * captureException(err, { function: "analyze-item", userId });
 */
export function captureException(error: Error | unknown, context?: Record<string, any>) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";
  
  console.error(
    `[Error] ${errorMsg}`,
    {
      ...(context && { context }),
      ...(errorStack && { stack: errorStack.split("\n").slice(0, 3) }),
    },
  );
}

/**
 * Wrap a function with error scope tracking
 * Currently a no-op - can be upgraded to send traces to external service
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
    throw e;
  }
}
