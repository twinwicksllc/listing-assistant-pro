/**
 * Fetch with timeout support.
 * Deno's fetch doesn't have a built-in timeout, so we use AbortController.
 *
 * @param url The URL to fetch
 * @param options Fetch options (method, headers, body, etc.)
 * @param timeout Timeout in milliseconds (default: 30000)
 * @returns Promise<Response>
 * @throws Error if the request times out or fails
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
