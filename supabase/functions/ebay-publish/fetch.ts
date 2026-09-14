import { NULL_BODY_STATUSES } from "../_helpers/fetchWithTimeout.ts";

/**
 * Fetch with timeout support.
 * Deno's fetch doesn't have a built-in timeout, so we use AbortController.
 *
 * @param url The URL to fetch
 * @param options Fetch options (method, headers, body, etc.)
 * @param options.timeout Timeout in milliseconds (default: 15000)
 * @returns Promise<Response>
 * @throws Error if the request times out or fails
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const timeout = options.timeout ?? 15000; // 15 second default
  const { timeout: _timeout, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    // Drain the body while the abort signal is still armed. fetch() resolves on
    // response HEADERS, so without this the ceiling above covers only the
    // handshake and a stalled body escapes the timeout entirely (the gap closed
    // in the shared helper by PR #564). Signature kept as-is here: this helper's
    // timeout-in-options shape has 28 call sites, so converting to the shared
    // helper is a separate change.
    if (NULL_BODY_STATUSES.has(response.status)) return response;
    const buffered = await response.arrayBuffer();
    return new Response(buffered, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
