import { useState, useEffect, useRef } from "react";
import { Video, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type UploadStatus = "idle" | "uploading_storage" | "uploading_ebay" | "processing" | "live" | "failed";

interface VideoUploadInputProps {
  /** Used as the eBay video title */
  title: string;
  /** eBay user token — needed to upload to the eBay Video API */
  userToken: string | null;
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
  initialVideoId,
  initialVideoStatus,
  initialVideoUrl,
  onVideoReady,
  onVideoRemoved,
  onStatusChange,
}: VideoUploadInputProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

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

  // Track current videoId in a ref so the polling interval sees the latest value
  const videoIdRef = useRef<string | null>(initialVideoId ?? null);
  const videoUrlRef = useRef<string | null>(initialVideoUrl ?? null);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
      // ── Step 1: Upload to Supabase Storage ──────────────────────────────
      setStatus("uploading_storage");
      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `listing-videos/${user.id}/${Date.now()}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from("listing-images")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

      const { data: urlData } = supabase.storage.from("listing-images").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      setVideoUrl(publicUrl);
      videoUrlRef.current = publicUrl;

      // ── Step 2: Upload to eBay Video API ────────────────────────────────
      setStatus("uploading_ebay");
      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "upload_video",
          userToken: token,
          videoUrl: publicUrl,
          title: (title || "Item Video").slice(0, 80),
          fileSize: file.size,
          contentType: file.type,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error ?? error?.message ?? "Video upload failed");
      }

      const newVideoId: string = data.videoId;
      setVideoId(newVideoId);
      videoIdRef.current = newVideoId;

      // ── Step 3: Poll for LIVE status ─────────────────────────────────────
      setStatus("processing");
      onStatusChange?.("PROCESSING");
      startPolling(newVideoId);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setStatus("failed");
      setErrorMsg(err.message ?? "Upload failed");
    }
  };

  const handleRemove = () => {
    stopPolling();
    setStatus("idle");
    setVideoId(null);
    setVideoUrl(null);
    setFileName(null);
    setErrorMsg(null);
    onVideoRemoved();
    onStatusChange?.(null as unknown as string);
  };

  const statusLabel: Record<UploadStatus, string> = {
    idle: "",
    uploading_storage: "Uploading video…",
    uploading_ebay: "Sending to eBay…",
    processing: "eBay is processing your video — this can take a few minutes",
    live: fileName ? `Video ready · ${fileName}` : "Video ready",
    failed: errorMsg ?? "Video processing failed",
  };

  const isLoading = status === "uploading_storage" || status === "uploading_ebay" || status === "processing";
  const canRemove = status === "live" || status === "failed" || status === "processing";
  const canRetry = status === "failed";

  return (
    <div>
      {/* Always-present hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov,.avi"
        onChange={handleFileSelect}
        className="hidden"
      />

      {status === "idle" ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs"
        >
          <Video className="w-4 h-4 flex-shrink-0" />
          <span>Add optional video (MP4 / MOV — max ~500 MB)</span>
        </button>
      ) : (
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
    </div>
  );
}
