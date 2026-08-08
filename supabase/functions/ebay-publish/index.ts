import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { captureException, initSentry } from "../_helpers/sentry.ts";

// Import extracted modules
import { handleExchangeCode, handleGetAuthUrl, handleGetStoredToken, handleRefreshToken } from "./auth.ts";
import { handleGetVideoStatus, handleUploadVideo } from "./video.ts";
import { corsHeaders } from "./constants.ts";
import { handleBulkCreateDraft, handleGetPolicies } from "./publish.ts";
import { handleCreateDraft } from "./publish-create-draft.ts";

serve(async (req) => {
  initSentry();

  console.log(
    "*** EBAY-PUBLISH FUNCTION STARTED (v24 - Dynamic category aspects from eBay Taxonomy API, hardcoded rules as fallback) ***",
  );

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declare action outside try so the catch block can reference it in error logs.
  let action: string | undefined;

  try {
    console.log(`ebay-publish request: method=${req.method}, url=${req.url}`);

    const requestBody = await req.json();
    let payload: Record<string, unknown>;
    ({ action, ...payload } = requestBody);

    console.log(
      `ebay-publish action: ${action}, payload keys: ${Object.keys(payload).join(", ")}`,
    );
    if (action === "create_draft") {
      console.log(`create_draft payload:`, {
        hasSku: !!payload.sku,
        hasTitle: !!payload.title,
        hasDescription: !!payload.description,
        listingPrice: payload.listingPrice,
        hasUserToken: !!payload.userToken,
        hasPackageWeightAndSize: !!payload.packageWeightAndSize,
        packageWeightAndSizeValue: JSON.stringify(payload.packageWeightAndSize ?? null),
      });
    }

    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";

    // Environment diagnostic log — emitted on every invocation to aid debugging.
    // Masks secrets: shows only first 8 chars of clientId, booleans for secrets.
    console.log("ebay-publish invoked:", {
      action,
      ebayEnv,
      hasClientId: !!clientId,
      clientIdPrefix: clientId ? clientId.substring(0, 8) + "..." : "MISSING",
      hasClientSecret: !!clientSecret,
      hasSupabaseUrl: !!Deno.env.get("SUPABASE_URL"),
      hasServiceKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    });

    // NOTE: clientId/clientSecret are only required for actions that call eBay OAuth endpoints
    // (exchange_code, refresh_token, get_auth_url, create_draft, bulk_create_draft).
    // get_stored_token and get_policies only need Supabase credentials, so we defer
    // this check to avoid blocking those actions when eBay app credentials are misconfigured.
    const requiresEbayCredentials = !["get_stored_token", "get_policies", "upload_video", "get_video_status"]
      .includes(action ?? "");
    if (requiresEbayCredentials && (!clientId || !clientSecret)) {
      throw new Error("eBay API credentials not configured");
    }

    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
    const authBase = ebayEnv === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
    const tokenUrl = ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

    // --- ACTION: Get OAuth consent URL ---
    if (action === "get_auth_url") {
      return await handleGetAuthUrl({ req, payload, clientId, authBase });
    }

    // --- ACTION: Exchange auth code for user token ---
    if (action === "exchange_code") {
      return await handleExchangeCode({ req, payload, clientId, clientSecret, ebayEnv, tokenUrl });
    }

    // --- ACTION: Silently refresh eBay access token using stored refresh token ---
    if (action === "refresh_token") {
      return await handleRefreshToken({ req, payload, clientId, clientSecret, tokenUrl });
    }

    // --- ACTION: Get stored eBay token for a user (with proactive refresh) ---
    if (action === "get_stored_token") {
      return await handleGetStoredToken({ req, payload, clientId, clientSecret, tokenUrl });
    }

    // --- ACTION: Upload video to eBay Video API ---
    if (action === "upload_video") {
      return await handleUploadVideo({ payload, apiBase, ebayEnv });
    }

    // --- ACTION: Get eBay video processing status ---
    if (action === "get_video_status") {
      return await handleGetVideoStatus({ payload, apiBase, ebayEnv });
    }

    // --- ACTION: Publish a single draft to eBay ---
    if (action === "create_draft") {
      return await handleCreateDraft({ req, payload, apiBase, ebayEnv, clientId, clientSecret });
    }

    // --- ACTION: Bulk publish multiple drafts (server-side loop) ---
    if (action === "bulk_create_draft") {
      return await handleBulkCreateDraft({ req, payload });
    }

    // --- ACTION: Fetch eBay business policies for a user token ---
    if (action === "get_policies") {
      return await handleGetPolicies({ req, payload, apiBase });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    // Include action in error log so we can identify which handler threw
    // (action may be undefined if JSON parsing itself failed)
    const actionLabel = action ?? "unknown";
    console.error(
      `ebay-publish error [action=${actionLabel}]:`,
      errorMsg,
      e instanceof Error ? e.stack : "",
    );
    captureException(e, { function: "ebay-publish", action: actionLabel });

    // Only treat as a 400 client error for explicit configuration/input problems.
    // eBay API error strings (e.g. "Failed to create inventory item: 400 - {...}")
    // must NOT match here — they should be 500s so the client knows it's a server-side
    // eBay API failure, not a missing-parameter problem on the client side.
    const isClientError = errorMsg.includes("not configured") ||
      errorMsg.includes("not provided") ||
      errorMsg.includes("No authorization code") ||
      errorMsg.includes("No userId provided") ||
      errorMsg.includes("No drafts provided") ||
      errorMsg.includes("No eBay user token provided");

    return new Response(
      JSON.stringify({ error: errorMsg, action: actionLabel }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
