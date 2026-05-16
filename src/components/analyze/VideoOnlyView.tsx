import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { VideoUploadInput } from "@/components/VideoUploadInput";

interface ExtractedFrame {
  url: string;
  timestampSec: number;
  score: number;
}

interface VideoOnlyViewProps {
  ebayTokenForPolicies: string | null;
  title: string;
  initialVideoFile?: File;
  videoIsProcessing: boolean;
  videoUrl: string | null;
  extractingFrames: boolean;
  extractedFrames: ExtractedFrame[];
  extractedFrameDataUrls: string[];
  extractFramesMessage: string;
  extractFramesErrorCode: string | null;
  onVideoReady: (videoId: string, url: string) => void;
  onVideoRemoved: () => void;
  onVideoStatusChange: (status: string) => void;
  onExtractFrames: () => void;
  onExtractFramesFallback: () => void;
  onAnalyzeExtractedFrames: () => void;
  onBack: () => void;
}

export function VideoOnlyView({
  ebayTokenForPolicies,
  title,
  initialVideoFile,
  videoIsProcessing,
  videoUrl,
  extractingFrames,
  extractedFrames,
  extractedFrameDataUrls,
  extractFramesMessage,
  extractFramesErrorCode,
  onVideoReady,
  onVideoRemoved,
  onVideoStatusChange,
  onExtractFrames,
  onExtractFramesFallback,
  onAnalyzeExtractedFrames,
  onBack,
}: VideoOnlyViewProps) {
  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-foreground">Analyze Item</h1>
        <span className="ml-auto text-xs text-muted-foreground">Video-first</span>
      </header>

      <div className="px-4 pt-4 max-w-lg mx-auto space-y-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground">Upload a Video</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You can attach a video here for your listing media. AI item identification still needs photos today.
            We are planning automatic key-frame extraction so video-only uploads can run identification in a future release.
          </p>
        </div>

        {ebayTokenForPolicies ? (
          <VideoUploadInput
            title={title}
            userToken={ebayTokenForPolicies}
            initialFile={initialVideoFile}
            onVideoReady={onVideoReady}
            onVideoRemoved={onVideoRemoved}
            onStatusChange={onVideoStatusChange}
          />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Connect eBay in Settings to upload a video.
          </div>
        )}

        {videoIsProcessing && (
          <p className="text-xs text-center text-amber-600">
            <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
            Video is processing on eBay. You can save a draft and publish when it becomes LIVE.
          </p>
        )}

        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">AI Frame Extraction</p>
          <p className="text-xs text-muted-foreground">
            Extract representative frames from the uploaded video so AI identification can run without photos.
          </p>
          <button
            type="button"
            onClick={onExtractFrames}
            disabled={extractingFrames || !videoUrl}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
          >
            {extractingFrames ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting Frames...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Extract Frames for AI
              </>
            )}
          </button>

          {!videoUrl && (
            <p className="text-[11px] text-amber-600">Upload a video and wait for readiness to enable extraction.</p>
          )}

          {extractFramesMessage && (
            <p className="text-[11px] text-muted-foreground">{extractFramesMessage}</p>
          )}

          {extractFramesErrorCode && (
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={onExtractFramesFallback}
                disabled={extractingFrames}
                className="w-full py-2 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:border-primary/40 disabled:opacity-60"
              >
                Use Fallback Frame Set
              </button>
              <button
                type="button"
                onClick={onBack}
                className="w-full py-2 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:border-primary/40"
              >
                Use Photo Capture Instead
              </button>
            </div>
          )}

          {extractedFrameDataUrls.length > 0 && (
            <button
              type="button"
              onClick={onAnalyzeExtractedFrames}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80"
            >
              <Sparkles className="w-4 h-4" />
              Run AI Identification with Extracted Frames
            </button>
          )}

          {extractedFrames.length > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {extractedFrames.map((frame, idx) => (
                <div key={`${frame.timestampSec}-${idx}`} className="rounded-md overflow-hidden border border-border bg-secondary">
                  <img src={frame.url} alt={`Extracted frame ${idx + 1}`} className="w-full aspect-video object-cover" />
                  <div className="px-1.5 py-1 text-[10px] text-muted-foreground">
                    {frame.timestampSec.toFixed(1)}s • {Math.round(frame.score * 100)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onBack}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-secondary text-foreground font-medium text-sm hover:bg-secondary/80"
        >
          Back to Capture
        </button>
      </div>
    </div>
  );
}
