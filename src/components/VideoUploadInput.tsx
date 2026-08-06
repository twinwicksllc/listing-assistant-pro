import { useState, useEffect, useRef } from "react";
import { Video, Loader2, CheckCircle2, XCircle, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { compressVideo } from "@/utils/videoCompression";

type UploadStatus = "idle" | "recording" | "compressing" | "uploading_storage" | "uploading_ebay" | "processing" | "live" | "failed";

const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];
const MAX_VIDEO_SIZE_MB = 500;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
// eBay Sell Video API requires clips between 3s and 60s; we cap at 10s as a product choice.
const MAX_VIDEO_DURATION_SEC = 10;
const MIN_VIDEO_DURATION_SEC = 3;

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video duration."));
    };
    video.src = url;
  });
}

function pickRecorderMimeType(): string {
  // Safari can record directly to MP4 (eBay-safe); Chrome/Firefox only support WebM.
  const candidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "";
}

interface VideoUploadInputProps {
  /** Used as the eBay video title */
  title: string;
  /** eBay user token — needed to upload to the eBay Video API */
  userToken: string | null;
  /** Optional file selected before arriving at this screen */
  initialFile?: File;
  /** Pre-existing values from a saved draft (triggers polling on mount if non-LIVE) */
  initialVideoId?: string;
  initialVideoStatus?: string;
  initialVideoUrl?: string;
  onVideoReady: (videoId: string, videoUrl: string) => void;
  onVideoRemoved: () => void;
  /** Called whenever the eBay video status changes (PENDING, PROCESSING, LIVE, FAILED) */
  onStatusChange?: (status: string) => void;
}

export function VideoUploadInput({
  title,
  userToken,
  initialFile,
  initialVideoId,
  initialVideoStatus,
  initialVideoUrl,
  onVideoReady,
  onVideoRemoved,
  onStatusChange,
}: VideoUploadInputProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureFileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const resolveInitialStatus = (): UploadStatus => {
    if (!initialVideoId) return "idle";
    if (initialVideoStatus === "LIVE") return "live";
    if (initialVideoStatus === "FAILED") return "failed";
    return "processing";
  };

  const [status, setStatus] = useState<UploadStatus>(resolveInitialStatus);
  const [videoId, setVideoId] = useState<string | null>(initialVideoId ?? null);
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState(MAX_VIDEO_DURATION_SEC);
  const [recordedFormatWarning, setRecordedFormatWarning] = useState(false);
  const [enableCompression, setEnableCompression] = useState(true);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionInfo, setCompressionInfo] = useState<{
    originalSize: number;
    compressedSize: number;
    ratio: number;
  } | null>(null);

  // Track current videoId in a ref so the polling interval sees the latest value
  const videoIdRef = useRef<string | null>(initialVideoId ?? null);
  const videoUrlRef = useRef<string | null>(initialVideoUrl ?? null);
  const autoUploadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      stopRecordTimer();
      stopCameraStream();
    };
  }, []);

  // Start polling immediately if we loaded from a draft that had a processing video
  useEffect(() => {
    if (initialVideoId && resolveInitialStatus() === "processing") {
      startPolling(initialVideoId);
    }
  }, []);

  const stopPolling = () => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPolling = (vidId: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      if (!mountedRef.current) return stopPolling();
      const token = userToken ?? localStorage.getItem("ebay-user-token");
      if (!token) return;

      try {
        const { data } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_video_status", userToken: token, videoId: vidId },
        });

        if (!mountedRef.current) return;

        if (data?.status === "LIVE") {
          stopPolling();
          setStatus("live");
          onStatusChange?.("LIVE");
          onVideoReady(vidId, videoUrlRef.current ?? "");
        } else if (data?.status === "FAILED") {
          stopPolling();
          setStatus("failed");
          onStatusChange?.("FAILED");
          setErrorMsg("eBay could not process this video. Please try a different file.");
        }
        // PENDING / PROCESSING → keep polling
      } catch {
        // Non-fatal: keep polling on next tick
      }
    }, 15_000); // poll every 15 s
  };

  const uploadFile = async (file: File) => {
    if (!file) return;

    if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
      setErrorMsg("Unsupported video format. Use MP4, MOV, WebM, or AVI.");
      setStatus("failed");
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      setErrorMsg(`Video exceeds ${MAX_VIDEO_SIZE_MB}MB limit.`);
      setStatus("failed");
      return;
    }

    let durationSec: number | null = null;
    try {
      durationSec = await getVideoDuration(file);
    } catch {
      // Non-fatal — some formats don't report duration up front; skip client-side check.
    }
    if (durationSec != null && Number.isFinite(durationSec)) {
      if (durationSec > MAX_VIDEO_DURATION_SEC + 0.5) {
        setErrorMsg(`Video is ${durationSec.toFixed(1)}s — please keep it to ${MAX_VIDEO_DURATION_SEC} seconds or less.`);
        setStatus("failed");
        return;
      }
      if (durationSec < MIN_VIDEO_DURATION_SEC) {
        setErrorMsg(`Video is too short (${durationSec.toFixed(1)}s). eBay requires at least ${MIN_VIDEO_DURATION_SEC} seconds.`);
        setStatus("failed");
        return;
      }
    }

    const token = userToken ?? localStorage.getItem("ebay-user-token");
    if (!token) {
      setErrorMsg("Connect eBay in Settings before uploading a video.");
      setStatus("failed");
      return;
    }
    if (!user?.id) return;

    setFileName(file.name);
    setErrorMsg(null);
    stopPolling();

    // Reset file input so the same file can be re-selected on retry
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      // ── Step 1: Optionally compress video ───────────────────────────────
      let fileToUpload = file;
      if (enableCompression && file.type.includes("video")) {
        setStatus("compressing");
        try {
          // Track compression progress
          const progressInterval = setInterval(() => {
            const now = Date.now();
            // Simulate smooth progress since FFmpeg doesn't always report it
            setCompressionProgress((p) => Math.min(p + 0.05, 0.95));
          }, 500);

          const compressionResult = await compressVideo(file, {
            bitrate: 2500, // 2.5 Mbps optimal for eBay
            resolution: "720p",
            preset: "medium", // Balance speed and compression ratio
          });

          clearInterval(progressInterval);
          setCompressionProgress(1);

          fileToUpload = new File([compressionResult.blob], compressionResult.filename, {
            type: "video/mp4",
          });

          const savedMB = ((1 - compressionResult.compressionRatio) * 100).toFixed(1);
          setCompressionInfo({
            originalSize: compressionResult.originalSize,
            compressedSize: compressionResult.compressedSize,
            ratio: compressionResult.compressionRatio,
          });

          console.log(
            `[VideoUploadInput] Compression complete: ${(compressionResult.originalSize / (1024 * 1024)).toFixed(2)}MB → ${(compressionResult.compressedSize / (1024 * 1024)).toFixed(2)}MB (saved ${savedMB}%)`,
          );
        } catch (compressionErr: any) {
          console.warn(
            `[VideoUploadInput] Compression failed (uploading original):`,
            compressionErr.message,
          );
          // Fall back to uploading original file
          setCompressionInfo(null);
        }
        setCompressionProgress(0);
      }

      // ── Step 2: Upload to Supabase Storage ──────────────────────────────
      setStatus("uploading_storage");
      const ext = fileToUpload.name.split(".").pop() ?? "mp4";
      const path = `listing-videos/${user.id}/${Date.now()}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from("listing-images")
        .upload(path, fileToUpload, { contentType: fileToUpload.type, upsert: false });

      if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

      const { data: urlData } = supabase.storage.from("listing-images").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      setVideoUrl(publicUrl);
      videoUrlRef.current = publicUrl;

      // ── Step 3: Upload to eBay Video API ────────────────────────────────
      setStatus("uploading_ebay");
      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "upload_video",
          userToken: token,
          videoUrl: publicUrl,
          title: (title || "Item Video").slice(0, 80),
          fileSize: fileToUpload.size,
          contentType: fileToUpload.type,
          durationSec: durationSec ?? undefined,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error ?? error?.message ?? "Video upload failed");
      }

      const newVideoId: string = data.videoId;
      setVideoId(newVideoId);
      videoIdRef.current = newVideoId;

      // ── Step 4: Poll for LIVE status ─────────────────────────────────────
      setStatus("processing");
      onStatusChange?.("PROCESSING");
      startPolling(newVideoId);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setStatus("failed");
      setErrorMsg(err.message ?? "Upload failed");
      setCompressionProgress(0);
      setCompressionInfo(null);
    }
  };

  useEffect(() => {
    if (!initialFile || status !== "idle") return;

    const fileKey = `${initialFile.name}:${initialFile.size}:${initialFile.lastModified}`;
    if (autoUploadKeyRef.current === fileKey) return;

    autoUploadKeyRef.current = fileKey;
    void uploadFile(initialFile);
  }, [initialFile, status]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so the same file/recording can be re-selected on retry
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  };

  const stopRecordTimer = () => {
    if (recordTimerRef.current !== null) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const stopCameraStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    stopRecordTimer();
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setRecordedFormatWarning(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
      streamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play().catch(() => {});
      }

      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopCameraStream();
        const usedMimeType = recorder.mimeType || mimeType || "video/webm";
        const isMp4 = usedMimeType.includes("mp4");
        setRecordedFormatWarning(!isMp4);

        const blob = new Blob(recordedChunksRef.current, { type: usedMimeType });
        const ext = isMp4 ? "mp4" : "webm";
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: usedMimeType });
        await uploadFile(file);
      };

      recorder.start();
      setStatus("recording");
      setRecordSecondsLeft(MAX_VIDEO_DURATION_SEC);

      let elapsed = 0;
      recordTimerRef.current = setInterval(() => {
        elapsed++;
        setRecordSecondsLeft(Math.max(0, MAX_VIDEO_DURATION_SEC - elapsed));
        if (elapsed >= MAX_VIDEO_DURATION_SEC) {
          stopRecording();
        }
      }, 1000);
    } catch {
      setErrorMsg("Camera/microphone access denied. Please enable permissions or upload a video file instead.");
      setStatus("failed");
    }
  };

  const handleRemove = () => {
    stopPolling();
    setStatus("idle");
    setVideoId(null);
    setVideoUrl(null);
    setFileName(null);
    setErrorMsg(null);
    setRecordedFormatWarning(false);
    onVideoRemoved();
    onStatusChange?.(null as unknown as string);
  };

  const statusLabel: Record<UploadStatus, string> = {
    idle: "",
    recording: "",
    compressing: "Optimizing video for eBay…",
    uploading_storage: "Uploading video…",
    uploading_ebay: "Sending to eBay…",
    processing: "eBay is processing your video — this can take a few minutes",
    live: fileName ? `Video ready · ${fileName}` : "Video ready",
    failed: errorMsg ?? "Video processing failed",
  };

  const isLoading = status === "compressing" || status === "uploading_storage" || status === "uploading_ebay" || status === "processing";
  const canRemove = status === "live" || status === "failed" || status === "processing";
  const canRetry = status === "failed";

  return (
    <div>
      {/* Always-present hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi"
        onChange={handleFileSelect}
        className="hidden"
      />
      {/* Mobile native camera fallback: opens native camera app for recording */}
      <input
        ref={captureFileInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />

      {status === "recording" && (
        <div className="space-y-2">
          <video
            ref={previewVideoRef}
            muted
            playsInline
            className="w-full aspect-video rounded-lg bg-black object-cover"
          />
          <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border border-destructive/40 bg-destructive/5 text-xs">
            <span className="flex items-center gap-1.5 text-destructive font-medium">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              Recording… {recordSecondsLeft}s left
            </span>
            <button type="button" onClick={stopRecording} className="text-destructive hover:underline font-medium">
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Compression toggle (only show when idle or if compression was used) */}
      {(status === "idle" || compressionInfo) && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
          <input
            type="checkbox"
            id="enable-compression"
            checked={enableCompression}
            onChange={(e) => setEnableCompression(e.target.checked)}
            className="w-4 h-4 rounded border-border cursor-pointer"
            disabled={status !== "idle"}
          />
          <label htmlFor="enable-compression" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5 flex-1">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Optimize video size (2.5 Mbps, 720p)
          </label>
          {compressionInfo && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
              Saved {((1 - compressionInfo.ratio) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Compression progress bar */}
      {status === "compressing" && compressionProgress > 0 && (
        <div className="mt-2 space-y-1">
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-amber-500 h-full transition-all"
              style={{ width: `${Math.min(compressionProgress * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {(compressionProgress * 100).toFixed(0)}% complete
          </p>
        </div>
      )}

      {status === "idle" && (
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={startRecording}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs"
          >
            <Video className="w-4 h-4 flex-shrink-0" />
            Record (max {MAX_VIDEO_DURATION_SEC}s)
          </button>
          <button
            type="button"
            onClick={() => captureFileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs"
            title="Record with phone camera"
          >
            <Video className="w-4 h-4 flex-shrink-0" />
            Camera app
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs"
          >
            <Video className="w-4 h-4 flex-shrink-0" />
            Upload file
          </button>
        </div>
      )}

      {status !== "idle" && status !== "recording" && (
        <div className="flex items-center gap-2 py-2.5 px-3 rounded-lg border border-border bg-card text-xs">
          {/* Status icon */}
          {isLoading && <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-primary" />}
          {status === "live" && <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-500" />}
          {status === "failed" && <XCircle className="w-4 h-4 flex-shrink-0 text-destructive" />}

          {/* Message */}
          <p className={`flex-1 min-w-0 leading-snug ${
            status === "live"
              ? "text-green-600 dark:text-green-400 font-medium"
              : status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}>
            {statusLabel[status]}
          </p>

          {/* Retry (failed state only) */}
          {canRetry && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 text-xs text-primary hover:underline"
            >
              Retry
            </button>
          )}

          {/* Remove */}
          {canRemove && (
            <button
              type="button"
              onClick={handleRemove}
              className="flex-shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Remove video"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {recordedFormatWarning && status !== "idle" && status !== "recording" && (
        <p className="text-[11px] text-amber-600 mt-1">
          Recorded in WebM — if eBay rejects it, upload an MP4 file instead.
        </p>
      )}
    </div>
  );
}
