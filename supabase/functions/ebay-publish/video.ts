import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  CONTENT_LANGUAGE,
  corsHeaders,
  EBAY_MARKETPLACE_ID,
  IDENTITY_API_PROD,
  IDENTITY_API_SANDBOX,
  MAX_VIDEO_DURATION_SEC,
  MIN_VIDEO_DURATION_SEC,
} from "./constants.ts";
import { fetchWithTimeout } from "./fetch.ts";
import { requireUser } from "../_helpers/authGuard.ts";

export interface VideoHandlerContext {
  req: Request;
  payload: Record<string, unknown>;
  apiBase: string;
  ebayEnv?: string;
}

async function requireAuthenticatedSession(req: Request): Promise<Response | null> {
  const auth = await requireUser(req);
  if (auth.ok) return null;
  return new Response(JSON.stringify({ error: auth.message }), {
    status: auth.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getMediaVideoBaseCandidates(ebayEnv: string): string[] {
  const isProduction = ebayEnv === "production";
  const restBase = isProduction ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const mediaGatewayBase = isProduction ? "https://apim.ebay.com" : "https://apim.sandbox.ebay.com";

  // eBay documents Media API resources under the apim v1_beta gateway.
  // Keep observed alternates as fallbacks for account/environment differences.
  return [
    `${mediaGatewayBase}/commerce/media/v1_beta/video`,
    `${mediaGatewayBase}/commerce/media/v1/video`,
    `${restBase}/commerce/media/v1_beta/video`,
    `${restBase}/commerce/media/v1/video`,
  ];
}

function isRetryableCreateEndpointStatus(status: number): boolean {
  return status === 404 || status === 405;
}

function isRetryableStatusCode(status: number): boolean {
  // Transient errors that warrant a retry with backoff
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 429
  );
}

function normalizeVideoStatus(rawStatus: string | null | undefined): string {
  const status = (rawStatus || "").toUpperCase();
  if (status === "LIVE") return "LIVE";
  if (status === "BLOCKED" || status === "PROCESSING_FAILED") return "FAILED";
  if (status === "PENDING_UPLOAD") return "PENDING";
  if (status === "PROCESSING") return "PROCESSING";
  if (status === "PENDING") return "PENDING";
  return status || "PENDING";
}

interface VideoPollingOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Poll video status with exponential backoff retry logic.
 * Useful for waiting until eBay finishes processing a video (status changes from PROCESSING to LIVE or FAILED).
 *
 * @param videoId eBay video ID to poll
 * @param userToken eBay user token with sell.inventory scope (which covers Media API)
 * @param mediaApiBase Base URL for Media API (e.g., https://api.ebay.com/commerce/media/v1)
 * @param options Polling configuration (maxAttempts, initialDelayMs, maxDelayMs)
 * @returns Video status object {videoId, status, statusMessage, attempts, processingTimeMs}
 */
async function pollVideoStatusWithRetry(
  videoId: string,
  userToken: string,
  mediaApiBase: string,
  options: VideoPollingOptions = {},
): Promise<Record<string, unknown>> {
  const maxAttempts = options.maxAttempts ?? 120; // ~60 minutes with default delays
  const initialDelayMs = options.initialDelayMs ?? 2000; // Start with 2 seconds
  const maxDelayMs = options.maxDelayMs ?? 10000; // Cap at 10 seconds

  let lastError: Error | null = null;
  let lastStatus: Record<string, unknown> | null = null;
  const startTimeMs = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetchWithTimeout(`${mediaApiBase}/${videoId}`, {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Accept-Language": CONTENT_LANGUAGE,
          "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
        },
      });

      if (!resp.ok && !isRetryableStatusCode(resp.status)) {
        const e = await resp.text();
        throw new Error(
          `eBay status check failed (${resp.status}): ${e.slice(0, 200)}`,
        );
      }

      if (resp.ok) {
        lastStatus = await readJsonObject(resp, "poll video status");
        const rawStatus = String(
          lastStatus.videoStatus ?? lastStatus.status ?? "PENDING",
        );
        const normalizedStatus = normalizeVideoStatus(rawStatus);
        const processingTimeMs = Date.now() - startTimeMs;

        console.log(
          `pollVideoStatus: videoId=${videoId} attempt=${attempt}/${maxAttempts} status=${normalizedStatus} elapsed=${processingTimeMs}ms`,
        );

        // Video is done processing (LIVE or FAILED)
        if (normalizedStatus === "LIVE" || normalizedStatus === "FAILED") {
          return {
            videoId,
            status: normalizedStatus,
            statusMessage: lastStatus.statusMessage ?? lastStatus.status_message ?? null,
            attempts: attempt,
            processingTimeMs,
          };
        }

        // Still processing — calculate backoff and retry
        const exponentialBackoff = Math.min(
          initialDelayMs * Math.pow(1.5, attempt - 1),
          maxDelayMs,
        );
        console.log(
          `pollVideoStatus: videoId=${videoId} still processing (${normalizedStatus}), waiting ${
            exponentialBackoff.toFixed(
              0,
            )
          }ms before retry`,
        );
        await new Promise((resolve) => setTimeout(resolve, exponentialBackoff));
        continue;
      }

      // Transient error on this attempt — log and retry
      lastError = new Error(`Status check returned ${resp.status}`);
      console.warn(
        `pollVideoStatus: videoId=${videoId} transient error (${resp.status}) on attempt ${attempt}, retrying...`,
      );

      const exponentialBackoff = Math.min(
        initialDelayMs * Math.pow(1.5, attempt - 1),
        maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, exponentialBackoff));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `pollVideoStatus: videoId=${videoId} error on attempt ${attempt}/${maxAttempts}: ${lastError.message}`,
      );

      if (attempt >= maxAttempts) {
        break; // Don't retry after final attempt
      }

      const exponentialBackoff = Math.min(
        initialDelayMs * Math.pow(1.5, attempt - 1),
        maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, exponentialBackoff));
    }
  }

  // All retries exhausted
  const processingTimeMs = Date.now() - startTimeMs;
  const lastStatusStr = lastStatus ? String(lastStatus.videoStatus ?? lastStatus.status ?? "UNKNOWN") : "UNKNOWN";
  throw new Error(
    `Video processing timeout after ${maxAttempts} attempts (${processingTimeMs}ms): status=${lastStatusStr}. ${
      lastError ? `Last error: ${lastError.message}` : ""
    }`,
  );
}

function getResourceIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  const pathname = new URL(location).pathname.replace(/\/$/, "");
  const resourceId = pathname.split("/").pop();
  return resourceId ? decodeURIComponent(resourceId) : null;
}

async function readJsonObject(
  response: Response,
  operation: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      `eBay ${operation} returned ${response.status} with an empty response body`,
    );
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response body was not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `eBay ${operation} returned ${response.status} with invalid JSON: ${String(error)}; body=${text.slice(0, 200)}`,
    );
  }
}

/**
 * Detect and return the environment (sandbox/production) of a provided user token.
 * @param userToken The eBay user token to probe
 * @returns "production", "sandbox", or "unknown"
 */
async function probeTokenEnvironment(userToken: string): Promise<string> {
  try {
    try {
      const idProdResp = await fetchWithTimeout(IDENTITY_API_PROD, {
        method: "GET",
        timeout: 4000,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (idProdResp.ok) return "production";
    } catch {
      // ignore
    }

    try {
      const idSandResp = await fetchWithTimeout(IDENTITY_API_SANDBOX, {
        method: "GET",
        timeout: 4000,
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (idSandResp.ok) return "sandbox";
    } catch {
      // ignore
    }
  } catch {
    // ignore all errors — probe is non-critical
  }
  return "unknown";
}

/**
 * Upload a video to eBay Media API.
 * Validates format/duration server-side, creates video entity, uploads bytes, returns videoId.
 */
export async function handleUploadVideo({
  req,
  payload,
  apiBase,
  ebayEnv,
}: VideoHandlerContext): Promise<Response> {
  const authFailure = await requireAuthenticatedSession(req);
  if (authFailure) return authFailure;

  const {
    userToken,
    videoUrl,
    title: videoTitle,
    fileSize,
    contentType,
    durationSec,
  } = payload;
  if (!userToken) throw new Error("No eBay user token provided");
  if (!videoUrl) throw new Error("No videoUrl provided");

  // Defense-in-depth: re-validate format/duration server-side even though the
  // client already enforces these (client checks can be bypassed).
  if (
    contentType &&
    !ALLOWED_VIDEO_CONTENT_TYPES.includes(String(contentType))
  ) {
    return new Response(
      JSON.stringify({
        error: `Unsupported video format: ${contentType}. Use MP4, MOV, AVI, or WebM.`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (typeof durationSec === "number" && Number.isFinite(durationSec)) {
    if (durationSec > MAX_VIDEO_DURATION_SEC) {
      return new Response(
        JSON.stringify({
          error: `Video is too long (${durationSec.toFixed(1)}s). Maximum allowed is 10 seconds.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (durationSec < MIN_VIDEO_DURATION_SEC) {
      return new Response(
        JSON.stringify({
          error: `Video is too short (${durationSec.toFixed(1)}s). eBay requires at least 3 seconds.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }

  // Step 1: Create the video entity in eBay
  const mediaApiCandidates = getMediaVideoBaseCandidates(
    ebayEnv || "production",
  );
  let mediaApiBase = mediaApiCandidates[0];
  let videoCreateUrl = mediaApiBase;
  const videoCreateBody = JSON.stringify({
    title: videoTitle || "Item Video",
    size: Number(fileSize) || 0,
    classification: ["ITEM"],
  });
  console.log("upload_video: calling eBay video create", {
    environment: ebayEnv,
    url: videoCreateUrl,
    body: videoCreateBody,
    fileSizeMB: (Number(fileSize) || 0) / (1024 * 1024),
    durationSec,
    contentType,
  });

  // Lightweight identity probe: detect whether the provided userToken is
  // a sandbox token or a production token so we can return a clearer error
  // when environments are mixed (common cause of 404s).
  try {
    const tokenEnvDetected = await probeTokenEnvironment(String(userToken));
    if (tokenEnvDetected !== "unknown" && tokenEnvDetected !== ebayEnv) {
      console.error("upload_video: token environment mismatch", {
        tokenEnvDetected,
        ebayEnv,
      });
      return new Response(
        JSON.stringify({
          error: "token_env_mismatch",
          message:
            `Provided user token appears to be for '${tokenEnvDetected}' but the function is configured for '${ebayEnv}'. Use a ${ebayEnv} user token or set EBAY_ENVIRONMENT to '${tokenEnvDetected}'.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (probeErr) {
    console.warn("upload_video: identity probe failed (non-fatal):", probeErr);
  }

  let videoId: string | null = null;
  const endpointErrors: Array<{ url: string; status: number; body: string }> = [];

  for (const candidateBase of mediaApiCandidates) {
    videoCreateUrl = candidateBase;
    mediaApiBase = candidateBase;

    const resp = await fetchWithTimeout(videoCreateUrl, {
      method: "POST",
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": CONTENT_LANGUAGE,
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      },
      body: videoCreateBody,
    });

    if (resp.ok) {
      const locationVideoId = getResourceIdFromLocation(
        resp.headers.get("Location"),
      );
      const responseText = await resp.text();
      let bodyVideoId: string | null = null;

      if (responseText.trim()) {
        try {
          const parsed: unknown = JSON.parse(responseText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const data = parsed as Record<string, unknown>;
            bodyVideoId = String(data.videoId ?? data.video_id ?? "") || null;
          }
        } catch (error) {
          if (!locationVideoId) {
            throw new Error(
              `eBay video create returned ${resp.status} with invalid JSON and no Location video ID: ${String(error)}`,
            );
          }
          console.warn(
            "upload_video: ignoring invalid create response body because Location supplied video ID",
            {
              requestUrl: videoCreateUrl,
              status: resp.status,
              body: responseText.slice(0, 200),
            },
          );
        }
      }

      videoId = bodyVideoId ?? locationVideoId;
      if (!videoId) {
        throw new Error(
          `eBay video create returned ${resp.status} but supplied neither a response-body videoId nor a Location header`,
        );
      }
      console.log("upload_video: create succeeded", {
        requestUrl: videoCreateUrl,
        environment: ebayEnv,
        responseStatus: resp.status,
        videoIdSource: bodyVideoId ? "body" : "location",
      });
      break;
    }

    const respText = await resp.text().catch(() => "<no-body>");
    endpointErrors.push({
      url: videoCreateUrl,
      status: resp.status,
      body: respText.slice(0, 200),
    });

    if (isRetryableCreateEndpointStatus(resp.status)) {
      console.warn(
        "upload_video: retrying create on alternate media endpoint",
        {
          status: resp.status,
          requestUrl: videoCreateUrl,
        },
      );
      continue;
    }

    // Non-endpoint errors should fail fast.
    let guidance = "";
    if (resp.status === 401 || resp.status === 403) {
      guidance =
        "Authentication/authorization issue. Token may be expired, or the account may not be authorized for video uploads. " +
        "Verify: (1) your eBay token includes 'sell.inventory' scope (which grants Media API access), " +
        "(2) your eBay app is in Production mode, (3) your eBay account has video upload permissions.";
    } else if (resp.status === 400) {
      guidance =
        "Bad request. Check file size (typically < 500MB), title length, classification, and that the video format is supported (MP4, MOV, AVI, WebM).";
    } else if (resp.status === 422) {
      guidance =
        "Unprocessable entity. File format or metadata may be invalid. Verify video is valid MP4/MOV/AVI/WebM and meets eBay requirements.";
    }

    throw new Error(
      `eBay video create failed (${resp.status}) on ${videoCreateUrl}: ${respText.slice(0, 200)}. ${guidance}`,
    );
  }

  if (!videoId) {
    throw new Error(
      `eBay video create failed across endpoint variants: ${
        endpointErrors
          .map((e) => `${e.status}@${e.url}`)
          .join(", ")
      }`,
    );
  }

  console.log(`upload_video: created eBay video entity videoId=${videoId}`);

  // Step 2: Fetch video bytes from Supabase Storage
  const videoFetchResp = await fetch(videoUrl as string);
  if (!videoFetchResp.ok) {
    throw new Error(
      `Failed to fetch video from storage (${videoFetchResp.status})`,
    );
  }

  // Step 3: Upload bytes to eBay (no short timeout — large files may take minutes)
  const uploadResp = await fetch(`${mediaApiBase}/${videoId}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/octet-stream",
      "Content-Language": CONTENT_LANGUAGE,
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      ...(fileSize ? { "Content-Length": String(fileSize) } : {}),
    },
    body: videoFetchResp.body,
  });

  if (!uploadResp.ok && uploadResp.status !== 204) {
    const e = await uploadResp.text();
    throw new Error(`eBay video upload failed (${uploadResp.status}): ${e}`);
  }
  console.log(
    `upload_video: bytes uploaded for videoId=${videoId}, httpStatus=${uploadResp.status}`,
  );

  return new Response(JSON.stringify({ videoId, status: "PENDING" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Get the processing status of an uploaded eBay video.
 */
export async function handleGetVideoStatus({
  req,
  payload,
  apiBase,
  ebayEnv,
}: VideoHandlerContext): Promise<Response> {
  const authFailure = await requireAuthenticatedSession(req);
  if (authFailure) return authFailure;

  const { userToken, videoId } = payload;
  if (!userToken) throw new Error("No eBay user token provided");
  if (!videoId) throw new Error("No videoId provided");

  const mediaApiCandidates = getMediaVideoBaseCandidates(
    ebayEnv || "production",
  );
  let statusResp: Response | null = null;
  let statusData: Record<string, unknown> | null = null;

  for (const candidateBase of mediaApiCandidates) {
    const candidateUrl = `${candidateBase}/${videoId}`;
    const resp = await fetchWithTimeout(candidateUrl, {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Accept-Language": CONTENT_LANGUAGE,
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      },
    });

    if (resp.ok) {
      statusResp = resp;
      statusData = await readJsonObject(resp, "get video status");
      break;
    }

    // If endpoint itself likely mismatched, continue trying alternates.
    if (isRetryableCreateEndpointStatus(resp.status)) {
      continue;
    }

    const e = await resp.text();
    throw new Error(
      `eBay get video status failed (${resp.status}) on ${candidateUrl}: ${e}`,
    );
  }

  if (!statusResp || !statusData) {
    throw new Error(
      "eBay get video status failed: no endpoint variant returned success",
    );
  }

  const rawStatus = String(
    statusData.videoStatus ?? statusData.status ?? "PENDING",
  );
  const normalizedStatus = normalizeVideoStatus(rawStatus);
  console.log(
    `get_video_status: videoId=${videoId} status=${normalizedStatus} rawStatus=${rawStatus}`,
  );

  // If video is FAILED, provide diagnostic information
  if (normalizedStatus === "FAILED") {
    console.error(`get_video_status: video processing FAILED`, {
      videoId,
      statusMessage: statusData.statusMessage ?? statusData.status_message,
      rawResponse: statusData,
    });
  }

  return new Response(
    JSON.stringify({
      videoId,
      status: normalizedStatus,
      rawStatus,
      statusMessage: statusData.statusMessage ?? statusData.status_message ?? null,
      // Include additional metadata for debugging
      debugData: {
        fullResponse: statusData,
      },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

/**
 * Poll eBay video status until it reaches LIVE or FAILED state.
 * Exported for frontend to use for monitoring video processing.
 */
export async function handlePollVideoStatusUntilLive({
  req,
  payload,
  apiBase,
  ebayEnv,
}: VideoHandlerContext): Promise<Response> {
  const authFailure = await requireAuthenticatedSession(req);
  if (authFailure) return authFailure;

  const { userToken, videoId, maxWaitMs } = payload;
  if (!userToken) throw new Error("No eBay user token provided");
  if (!videoId) throw new Error("No videoId provided");

  const mediaApiCandidates = getMediaVideoBaseCandidates(
    ebayEnv || "production",
  );
  const mediaApiBase = mediaApiCandidates[0]; // Use primary endpoint for polling

  const maxWaitSeconds = typeof maxWaitMs === "number" ? Math.floor(maxWaitMs / 1000) : 300; // Default 5 min
  const maxAttempts = Math.ceil(maxWaitSeconds / 2); // 2 seconds base retry

  try {
    const result = await pollVideoStatusWithRetry(
      String(videoId),
      String(userToken),
      mediaApiBase,
      {
        maxAttempts,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
      },
    );

    console.log(
      `poll_video_status_until_live: completed for videoId=${videoId}`,
      result,
    );

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `poll_video_status_until_live: failed for videoId=${videoId}:`,
      errorMessage,
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        videoId,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}
