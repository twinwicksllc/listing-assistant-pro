import { Camera, Upload, Sparkles, X, ArrowRight, ImagePlus, Mic, MicOff, Loader2, LogOut, Wand2 } from "lucide-react";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { optimizeImages } from "@/lib/imageOptimizer";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "video/mp4", "video/quicktime", "video/webm"];
const ACCEPT_STRING = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,video/mp4,video/quicktime,video/webm";
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_RECORDING_SEC = 10;

export default function HomePage() {
  const { signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [stagedImages, setStagedImages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  // Voice note state
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validateAndStageFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const fileArr = Array.from(files);

    fileArr.forEach((file) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" is not a supported format (JPG, PNG, WebP, GIF, MP4, MOV, WebM)`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        setStagedImages((prev) => [...prev, url]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeImage = (index: number) => {
    setStagedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProcess = () => {
    if (stagedImages.length === 0) return;
    navigate("/analyze", { state: { imageUrls: stagedImages, voiceNote } });
  };

  const handleCapture = () => {
    fileInputRef.current?.click();
  };

  // --- Voice recording ---
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setRecordingTime(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        // Convert to base64 and transcribe
        setTranscribing(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });

          const { data, error } = await supabase.functions.invoke("transcribe-voice", {
            body: { audioBase64: base64 },
          });

          if (error || data?.error) throw new Error(data?.error || error?.message || "Transcription failed");

          const transcript = data.transcript || "";
          if (transcript) {
            setVoiceNote((prev) => (prev ? `${prev} ${transcript}` : transcript));
            toast.success("Voice note transcribed!");
          } else {
            toast.error("Couldn't detect any speech. Try again.");
          }
        } catch (err: any) {
          console.error("Transcription error:", err);
          toast.error(err.message || "Failed to transcribe voice note.");
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);

      // Timer + auto-stop at max duration
      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed++;
        setRecordingTime(elapsed);
        if (elapsed >= MAX_RECORDING_SEC) {
          stopRecording();
        }
      }, 1000);
    } catch {
      toast.error("Microphone access denied. Please enable it in your browser settings.");
    }
  }, [stopRecording]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    validateAndStageFiles(e.dataTransfer.files);
  }, [validateAndStageFiles]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <img src={teckstartLogo} alt="Teckstart" className="h-9 w-auto" />
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Teckstart Listing Assistant</h1>
            <p className="text-xs text-muted-foreground">AI-powered eBay listings</p>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex flex-col px-5 pb-24 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
          {stagedImages.length === 0 ? (
            /* Empty state */
            <div
              className={`flex-1 flex flex-col items-center justify-center space-y-6 text-center rounded-2xl transition-colors ${dragging ? "bg-primary/10 border-2 border-dashed border-primary" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <button
                onClick={handleCapture}
                className="mx-auto w-40 h-40 md:w-48 md:h-48 rounded-full bg-primary/10 border-2 border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 transition-all hover:bg-primary/15 hover:border-primary/50 active:scale-95"
              >
                {isMobile ? (
                  <Camera className="w-10 h-10 text-primary" />
                ) : (
                  <Upload className="w-10 h-10 text-primary" />
                )}
                <span className="text-sm font-semibold text-primary">
                  {isMobile ? "Capture Item" : "Upload Photos"}
                </span>
              </button>

              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {isMobile
                    ? "Take photos or upload images to generate your eBay listing"
                    : "Upload images or drag & drop to generate your eBay listing"}
                </p>
                <p className="text-muted-foreground/60 text-xs">
                  JPG, PNG, WebP, GIF, MP4, MOV · Max {MAX_FILE_SIZE_MB}MB per file
                </p>
              </div>

              <button
                onClick={handleCapture}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium transition-colors hover:bg-secondary/80"
              >
                <Upload className="w-4 h-4" />
                {isMobile ? "Upload from Gallery" : "Browse Files"}
              </button>
            </div>
          ) : (
            /* Staging gallery */
            <div
              className="space-y-4 pt-2"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Item Photos ({stagedImages.length})
                </h2>
                <button
                  onClick={handleCapture}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Add More
                </button>
              </div>

              {dragging && (
                <div className="rounded-xl border-2 border-dashed border-primary bg-primary/10 py-8 text-center text-sm font-medium text-primary">
                  Drop files here to add
                </div>
              )}

              {/* Photo grid */}
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
                {stagedImages.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-secondary group">
                    <img src={url} alt={`Item photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5 text-foreground" />
                    </button>
                    {i === 0 && (
                      <span className="absolute bottom-1 left-1 text-[10px] font-medium bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                        Main
                      </span>
                    )}
                  </div>
                ))}

                {/* Add photo tile */}
                <button
                  onClick={handleCapture}
                  className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  {isMobile ? <Camera className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
                  <span className="text-[10px] font-medium">Add</span>
                </button>
              </div>

              {/* Voice Note Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-primary" />
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Voice Note</label>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">Optional · {MAX_RECORDING_SEC}s max</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={recording ? stopRecording : startRecording}
                    disabled={transcribing}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      recording
                        ? "bg-destructive text-destructive-foreground animate-pulse"
                        : "bg-secondary text-foreground hover:bg-secondary/80"
                    } disabled:opacity-60`}
                  >
                    {transcribing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Transcribing...
                      </>
                    ) : recording ? (
                      <>
                        <MicOff className="w-4 h-4" />
                        Stop ({MAX_RECORDING_SEC - recordingTime}s)
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        Record Note
                      </>
                    )}
                  </button>

                  {voiceNote && !recording && !transcribing && (
                    <button
                      onClick={() => setVoiceNote("")}
                      className="px-3 py-2.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {voiceNote && (
                  <div className="bg-card border border-border rounded-lg px-3 py-2.5">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Transcription:</p>
                    <textarea
                      value={voiceNote}
                      onChange={(e) => setVoiceNote(e.target.value)}
                      rows={2}
                      className="w-full text-sm text-foreground bg-transparent border-none focus:outline-none resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Process button */}
              <button
                onClick={handleProcess}
                className="w-full md:w-auto md:px-8 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
              >
                <Sparkles className="w-4 h-4" />
                Process Now
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        {...(isMobile ? { capture: "environment" as const } : {})}
        multiple
        className="hidden"
        onChange={(e) => {
          validateAndStageFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <BottomNav />
    </div>
  );
}
