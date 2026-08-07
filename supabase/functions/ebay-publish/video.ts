import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  CONTENT_LANGUAGE,
  EBAY_MARKETPLACE_ID,
  IDENTITY_API_PROD,
  IDENTITY_API_SANDBOX,
  MAX_VIDEO_DURATION_SEC,
  MIN_VIDEO_DURATION_SEC,
} from "./constants.ts";
import { fetchWithTimeout } from "./fetch.ts";

// CORS headers for video responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export interface VideoHandlerContext {
  payload: Record<string, unknown>;
  apiBase: string;
  ebayEnv: string;
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
  const mediaApiBase = `${apiBase}/commerce/media/v1/video`;
  const videoCreateUrl = mediaApiBase;
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
    const tokenEnvDetected = await probeTokenEnvironment(userToken);
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

  const createResp = await fetchWithTimeout(videoCreateUrl, {
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

  if (!createResp.ok) {
    const respText = await createResp.text().catch(() => "<no-body>");
    const respSnippet = respText.slice(0, 200) + (respText.length > 200 ? "…" : "");

    // Provide diagnostic guidance based on status
    let guidance = "";
    if (createResp.status === 404) {
      guidance =
        "404 typically means: (1) Account not enabled for video on eBay, (2) Token missing video scope, or (3) Account status issue. Contact eBay seller support to enable video uploads.";
    } else if (createResp.status === 401 || createResp.status === 403) {
      guidance =
        "Authentication/authorization issue. Token may be expired or lack required scopes (sell.marketing.media.manage).";
    } else if (createResp.status === 400) {
      guidance = "Bad request. Check file size, title length, or eBay API requirements.";
    }

    console.error("upload_video: eBay video create returned non-ok response", {
      environment: ebayEnv,
      status: createResp.status,
      statusText: createResp.statusText,
      body: respSnippet,
      truncated: respText.length > 200,
      requestUrl: videoCreateUrl,
      guidance,
      fileSizeMB: (Number(fileSize) || 0) / (1024 * 1024),
      durationSec,
    });
    throw new Error(
      `eBay video create failed (${createResp.status}): ${respSnippet}. ${guidance}`,
    );
  }

  const createData = await createResp.json();
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

  const statusResp = await fetchWithTimeout(
    `${apiBase}/commerce/media/v1/video/${videoId}`,
    {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Accept-Language": CONTENT_LANGUAGE,
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      },
    },
  );

  if (!statusResp.ok) {
    const e = await statusResp.text();
    throw new Error(`eBay get video status failed (${statusResp.status}): ${e}`);
  }

  const statusData = await statusResp.json();
  const currentStatus = statusData.videoStatus ?? statusData.status ?? "PENDING";
  console.log(`get_video_status: videoId=${videoId} status=${currentStatus}`);

  return new Response(JSON.stringify({ videoId, status: currentStatus }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
