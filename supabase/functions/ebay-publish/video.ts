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

export interface VideoHandlerContext {
  payload: Record<string, unknown>;
  apiBase: string;
  ebayEnv?: string;
}

function getMediaVideoBaseCandidates(ebayEnv: string): string[] {
  const isProduction = ebayEnv === "production";
  const restBase = isProduction ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const mediaGatewayBase = isProduction ? "https://apim.ebay.com" : "https://apim.sandbox.ebay.com";

  // Prefer the currently documented REST path first, then fall back to
  // alternates that are observed in older docs / account environments.
  return [
    `${restBase}/commerce/media/v1/video`,
    `${restBase}/commerce/media/v1_beta/video`,
    `${mediaGatewayBase}/commerce/media/v1/video`,
    `${mediaGatewayBase}/commerce/media/v1_beta/video`,
  ];
}

function isRetryableCreateEndpointStatus(status: number): boolean {
  return status === 404 || status === 405;
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
export async function handleUploadVideo(
  {
    payload,
    apiBase,
    ebayEnv,
  }: VideoHandlerContext,
): Promise<Response> {
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
  if (contentType && !ALLOWED_VIDEO_CONTENT_TYPES.includes(String(contentType))) {
    return new Response(
      JSON.stringify({
        error: `Unsupported video format: ${contentType}. Use MP4, MOV, AVI, or WebM.`,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (typeof durationSec === "number" && Number.isFinite(durationSec)) {
    if (durationSec > MAX_VIDEO_DURATION_SEC) {
      return new Response(
        JSON.stringify({
          error: `Video is too long (${durationSec.toFixed(1)}s). Maximum allowed is 10 seconds.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (durationSec < MIN_VIDEO_DURATION_SEC) {
      return new Response(
        JSON.stringify({
          error: `Video is too short (${durationSec.toFixed(1)}s). eBay requires at least 3 seconds.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Step 1: Create the video entity in eBay
  const mediaApiCandidates = getMediaVideoBaseCandidates(ebayEnv || "production");
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (probeErr) {
    console.warn("upload_video: identity probe failed (non-fatal):", probeErr);
  }

  let createResp: Response | null = null;
  let createData: Record<string, unknown> | null = null;
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
      createResp = resp;
      createData = await resp.json();
      console.log("upload_video: create succeeded", {
        requestUrl: videoCreateUrl,
        environment: ebayEnv,
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
      console.warn("upload_video: retrying create on alternate media endpoint", {
        status: resp.status,
        requestUrl: videoCreateUrl,
      });
      continue;
    }

    // Non-endpoint errors should fail fast.
    let guidance = "";
    if (resp.status === 401 || resp.status === 403) {
      guidance =
        "Authentication/authorization issue. Token may be expired or lack required scopes (commerce.media).";
    } else if (resp.status === 400) {
      guidance = "Bad request. Check file size, title length, classification, and eBay API requirements.";
    }

    throw new Error(
      `eBay video create failed (${resp.status}) on ${videoCreateUrl}: ${respText.slice(0, 200)}. ${guidance}`,
    );
  }

  if (!createResp || !createData) {
    throw new Error(
      `eBay video create failed across endpoint variants: ${endpointErrors.map((e) => `${e.status}@${e.url}`).join(", ")}`,
    );
  }

  const videoId = createData.videoId ?? createData.video_id;
  if (!videoId) throw new Error("eBay returned no videoId");
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
export async function handleGetVideoStatus(
  {
    payload,
    apiBase,
  }: VideoHandlerContext,
): Promise<Response> {
  const { userToken, videoId } = payload;
  if (!userToken) throw new Error("No eBay user token provided");
  if (!videoId) throw new Error("No videoId provided");

  const mediaApiCandidates = getMediaVideoBaseCandidates(ebayEnv || "production");
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
      statusData = await resp.json();
      break;
    }

    // If endpoint itself likely mismatched, continue trying alternates.
    if (isRetryableCreateEndpointStatus(resp.status)) {
      continue;
    }

    const e = await resp.text();
    throw new Error(`eBay get video status failed (${resp.status}) on ${candidateUrl}: ${e}`);
  }

  if (!statusResp || !statusData) {
    throw new Error("eBay get video status failed: no endpoint variant returned success");
  }

  const rawStatus = String(statusData.videoStatus ?? statusData.status ?? "PENDING");
  const normalizedStatus = normalizeVideoStatus(rawStatus);
  console.log(`get_video_status: videoId=${videoId} status=${normalizedStatus} rawStatus=${rawStatus}`);

  return new Response(JSON.stringify({
    videoId,
    status: normalizedStatus,
    rawStatus,
    statusMessage: statusData.statusMessage ?? statusData.status_message ?? null,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
