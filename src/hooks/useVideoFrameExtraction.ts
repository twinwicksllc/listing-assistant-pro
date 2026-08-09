import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  computeFrameQualityScore,
  selectBestFrames,
} from "./videoFrameExtraction.utils";

interface UseVideoFrameExtractionProps {
  videoUrl: string | null;
  voiceNote: string;
  ebayVideoId: string | null;
  ebayVideoStatus: string | null;
}

export function useVideoFrameExtraction({
  videoUrl,
  voiceNote,
  ebayVideoId,
  ebayVideoStatus,
}: UseVideoFrameExtractionProps) {
  const navigate = useNavigate();
  const [extractingFrames, setExtractingFrames] = useState(false);
  const [extractedFrames, setExtractedFrames] = useState<
    Array<{ url: string; timestampSec: number; score: number }>
  >([]);
  const [extractedFrameDataUrls, setExtractedFrameDataUrls] = useState<
    string[]
  >([]);
  const [extractFramesMessage, setExtractFramesMessage] = useState("");
  const [extractFramesErrorCode, setExtractFramesErrorCode] = useState<
    string | null
  >(null);

  const extractFramesClientSide = async (
    sourceVideoUrl: string,
    maxFrames: number,
  ): Promise<
    Array<{ dataUrl: string; timestampSec: number; score: number }>
  > => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = sourceVideoUrl;

    await new Promise<void>((resolve, reject) => {
      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(
          new Error("Could not load video metadata for frame extraction."),
        );
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onLoadedMetadata);
      video.addEventListener("error", onError);
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0)
      throw new Error("Video duration is invalid for frame extraction.");

    const frameCount = Math.max(3, Math.min(maxFrames, 8));
    const start = Math.min(0.5, duration * 0.1);
    const end = Math.max(start, duration - 0.5);
    const step = frameCount > 1 ? (end - start) / (frameCount - 1) : 0;

    const canvas = document.createElement("canvas");
    const targetWidth = 960;
    const sourceWidth = Math.max(1, video.videoWidth || 1280);
    const sourceHeight = Math.max(1, video.videoHeight || 720);
    const targetHeight = Math.max(
      1,
      Math.round((targetWidth * sourceHeight) / sourceWidth),
    );
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to initialize extraction canvas.");

    const candidates: Array<{
      dataUrl: string;
      timestampSec: number;
      score: number;
    }> = [];
    for (let i = 0; i < frameCount; i++) {
      const timestampSec = Number((start + i * step).toFixed(2));
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Failed while seeking video for frame extraction."));
        };
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = Math.min(duration, Math.max(0, timestampSec));
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const qualityScore = computeFrameQualityScore(
        imageData,
        canvas.width,
        canvas.height,
      );
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      candidates.push({
        dataUrl,
        timestampSec,
        score: Number(qualityScore.toFixed(3)),
      });
    }

    const selected = selectBestFrames(
      candidates.map((candidate) => ({
        timestampSec: candidate.timestampSec,
        qualityScore: candidate.score,
      })),
      4,
    );

    return candidates
      .filter((candidate) =>
        selected.some((item) => item.timestampSec === candidate.timestampSec),
      )
      .map((candidate) => ({
        ...candidate,
        score: Number(candidate.score.toFixed(3)),
      }));
  };

  const mapExtractError = (err: unknown): { code: string; message: string } => {
    const raw = String((err as Error)?.message || err || "").toLowerCase();
    if (
      raw.includes("tainted") ||
      raw.includes("cross-origin") ||
      raw.includes("securityerror")
    )
      return {
        code: "cors_tainted_canvas",
        message:
          "Video frame extraction was blocked by browser security policy. Try re-uploading, or use photo capture as fallback.",
      };
    if (raw.includes("metadata"))
      return {
        code: "metadata_load_failed",
        message:
          "Could not read video metadata. Please try a different video file.",
      };
    if (raw.includes("seek"))
      return {
        code: "seek_failed",
        message:
          "Frame seeking failed during extraction. Retry, or use photo capture for now.",
      };
    return {
      code: "extract_failed",
      message: (err as Error)?.message || "Frame extraction failed.",
    };
  };

  const handleExtractFrames = async () => {
    if (!videoUrl) {
      setExtractFramesMessage(
        "Upload a video first. Once it is ready, you can extract frames for AI.",
      );
      return;
    }
    setExtractingFrames(true);
    setExtractFramesMessage("");
    setExtractFramesErrorCode(null);
    try {
      const startedAt = performance.now();
      const clientFrames = await extractFramesClientSide(videoUrl, 6);
      setExtractedFrameDataUrls(clientFrames.map((f) => f.dataUrl));
      const extractionMs = Math.round(performance.now() - startedAt);

      const { data, error } = await supabase.functions.invoke(
        "video-frame-extract",
        {
          body: {
            videoUrl,
            maxFrames: 6,
            strategy: "scene_change",
            frames: clientFrames,
            telemetry: {
              source: "client-canvas",
              extractionMs,
              framesGenerated: clientFrames.length,
              userAgent: navigator.userAgent,
            },
          },
        },
      );
      if (error) throw error;

      const frames = Array.isArray(data?.frames)
        ? data.frames.filter(
            (f: { url?: unknown }) => typeof f?.url === "string",
          )
        : [];
      setExtractedFrames(frames);
      setExtractFramesMessage(
        frames.length > 0
          ? `Extracted ${frames.length} frame${frames.length !== 1 ? "s" : ""}. Ready for AI identification.`
          : "No frames returned.",
      );
    } catch (err) {
      const mapped = mapExtractError(err);
      setExtractFramesErrorCode(mapped.code);
      setExtractFramesMessage(mapped.message);
      setExtractedFrames([]);
      setExtractedFrameDataUrls([]);
    } finally {
      setExtractingFrames(false);
    }
  };

  const handleExtractFramesFallback = async () => {
    if (!videoUrl) return;
    setExtractingFrames(true);
    setExtractFramesMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "video-frame-extract",
        {
          body: {
            videoUrl,
            maxFrames: 6,
            strategy: "scene_change",
            telemetry: {
              source: "fallback-no-frames",
              reason: extractFramesErrorCode,
              userAgent: navigator.userAgent,
            },
          },
        },
      );
      if (error) throw error;
      const frames = Array.isArray(data?.frames)
        ? data.frames.filter(
            (f: { url?: unknown }) => typeof f?.url === "string",
          )
        : [];
      if (frames.length === 0) {
        setExtractedFrames([]);
        setExtractedFrameDataUrls([]);
        setExtractFramesMessage(
          "Frame extraction is still unavailable. Please use photo capture as the safer fallback for AI analysis.",
        );
        setExtractFramesErrorCode("fallback_unavailable");
        return;
      }
      setExtractedFrames(frames);
      setExtractedFrameDataUrls([]);
      setExtractFramesMessage(
        "Fallback frame set generated. For best AI quality, use photo capture or retry extraction.",
      );
      setExtractFramesErrorCode(null);
    } catch (err) {
      setExtractFramesMessage(
        (err as Error)?.message || "Fallback extraction failed.",
      );
    } finally {
      setExtractingFrames(false);
    }
  };

  const handleAnalyzeExtractedFrames = () => {
    if (extractedFrameDataUrls.length === 0) {
      setExtractFramesMessage(
        "Extract frames first before running AI identification.",
      );
      return;
    }
    navigate("/analyze", {
      state: {
        imageUrls: extractedFrameDataUrls,
        voiceNote,
        fromVideoExtraction: true,
        videoUrl,
        ebayVideoId,
        ebayVideoStatus,
      },
    });
  };

  return {
    extractingFrames,
    extractedFrames,
    extractedFrameDataUrls,
    extractFramesMessage,
    extractFramesErrorCode,
    handleExtractFrames,
    handleExtractFramesFallback,
    handleAnalyzeExtractedFrames,
  };
}
