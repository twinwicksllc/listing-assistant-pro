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
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  }
}
