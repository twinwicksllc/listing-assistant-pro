/**
 * Cloudflare Worker — eBay API Proxy
 *
 * Routes eBay API calls from Supabase Edge Functions (us-east-2) through
 * Cloudflare's network, bypassing the DNS/routing issue with api.ebay.com
 * from that region.
 *
 * Supported targets:
 *   api.ebay.com         → /api/*
 *   api.sandbox.ebay.com → /sandbox/*
 *   apiz.ebay.com        → /apiz/*
 *   apiz.sandbox.ebay.com → /apiz-sandbox/*
 *
 * Security: Requests MUST include the header:
 *   X-Proxy-Secret: <PROXY_SECRET env var>
 * Set this as a Cloudflare Worker secret (wrangler secret put PROXY_SECRET).
 *
 * Usage from Supabase Edge Function:
 *   Replace:  https://api.ebay.com/identity/v1/oauth2/token
 *   With:     https://<your-worker>.workers.dev/api/identity/v1/oauth2/token
 *
 * Deploy:
 *   wrangler deploy
 */

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, X-Proxy-Secret, X-EBAY-C-MARKETPLACE-ID, X-EBAY-C-ENDUSERCTX",
        },
      });
    }

    // Validate proxy secret to prevent unauthorized use
    const proxySecret = env.PROXY_SECRET;
    if (proxySecret) {
      const incoming = request.headers.get("X-Proxy-Secret");
      if (!incoming || incoming !== proxySecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const url = new URL(request.url);
    const pathname = url.pathname; // e.g. /api/identity/v1/oauth2/token

    // Route to correct eBay host based on path prefix
    let ebayHost;
    let ebayPath;

    if (pathname.startsWith("/apiz-sandbox/")) {
      ebayHost = "https://apiz.sandbox.ebay.com";
      ebayPath = pathname.slice("/apiz-sandbox".length);
    } else if (pathname.startsWith("/apiz/")) {
      ebayHost = "https://apiz.ebay.com";
      ebayPath = pathname.slice("/apiz".length);
    } else if (pathname.startsWith("/sandbox/")) {
      ebayHost = "https://api.sandbox.ebay.com";
      ebayPath = pathname.slice("/sandbox".length);
    } else if (pathname.startsWith("/api/")) {
      ebayHost = "https://api.ebay.com";
      ebayPath = pathname.slice("/api".length);
    } else {
      return new Response(
        JSON.stringify({
          error: "Invalid path. Use /api/*, /sandbox/*, /apiz/*, or /apiz-sandbox/*",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build target URL (preserve query string)
    const targetUrl = `${ebayHost}${ebayPath}${url.search}`;

    // Clone headers, strip proxy-specific ones, forward the rest
    const headers = new Headers(request.headers);
    headers.delete("X-Proxy-Secret");
    headers.delete("Host");
    // Cloudflare sets its own host header

    // Forward the request to eBay
    try {
      const ebayResponse = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : undefined,
        redirect: "follow",
      });

      // Stream response back
      const responseHeaders = new Headers(ebayResponse.headers);
      // Add CORS header so Supabase can read the response
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      // Strip content-encoding so body isn't double-decoded
      responseHeaders.delete("content-encoding");

      return new Response(ebayResponse.body, {
        status: ebayResponse.status,
        statusText: ebayResponse.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Proxy fetch failed", detail: String(err) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};