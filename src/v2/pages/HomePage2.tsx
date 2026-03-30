/**
 * HomePage2 — V2 redesign of /home (Capture page)
 *
 * All business logic is identical to HomePage.tsx.
 * Only the presentation layer has been updated:
 *   - AppShell (left sidebar on desktop, BottomNav on mobile)
 *   - White background, #0076B6 primary, system font stack
 *   - Larger base font (16px), readable at arm's length
 *   - Desktop: two-column layout (upload panel left, instructions/tips right)
 *   - Mobile: single column, same UX feel as original
 */

import {
  Camera, Upload, Sparkles, X, ArrowRight, ImagePlus,
  Mic, MicOff, Loader2, Wand2, HelpCircle, Layers, Info,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { optimizeImages } from "@/lib/imageOptimizer";
import WelcomeTour, { type TourStep } from "@/components/WelcomeTour";
import AppShell from "../components/AppShell";

// ── Constants (identical to original) ────────────────────────────────────────

const ACCEPTED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "image/heif", "image/gif", "video/mp4", "video/quicktime", "video/webm",
];
const ACCEPT_STRING =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,video/mp4,video/quicktime,video/webm";
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_RECORDING_SEC = 10;
const TOUR_KEY = "teckstart_tour_seen";

const TOUR_STEPS: TourStep[] = [
  {
    target:      "capture-button",
    title:       "📸 Capture Items",
    description: "Tap here to take photos or upload images of items you want to list on eBay. You can add multiple photos at once.",
    placement:   "bottom",
  },
  {
    target:      "image-optimizer",
    title:       "✨ Auto Optimizer",
    description: "Photos are automatically optimized when added—backgrounds are auto-cropped, items centered, and brightness normalized for professional listings.",
    placement:   "top",
  },
  {
    target:      "analyze-tab",
    title:       "🔍 Drafts & Analysis",
    description: "After processing, your AI-generated listings appear in Drafts. Review titles, descriptions, and pricing before publishing to eBay.",
    placement:   "top",
  },
  {
    target:      "help-button",
    title:       "💡 Need Help?",
    description: "You can replay this tour anytime by tapping the help icon in the header. Happy listing!",
    placement:   "bottom",
  },
];

// ── Styles (inline, scoped) ───────────────────────────────────────────────────

const S = {
  // Page wrapper
  page: {
    minHeight: "100vh",
    background: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  } as React.CSSProperties,

  // Desktop page inner
  pageInner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "2rem 2rem 2rem",
  } as React.CSSProperties,

  // Mobile page inner
  pageInnerMobile: {
    padding: "1.25rem 1rem 1rem",
  } as React.CSSProperties,

  // Page header bar
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.75rem",
    paddingBottom: "1.25rem",
    borderBottom: "1px solid #E4E7EC",
  } as React.CSSProperties,

  pageTitle: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#141820",
    letterSpacing: "-0.02em",
    margin: 0,
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: "0.9375rem",
    color: "#6E7580",
    marginTop: "0.125rem",
  } as React.CSSProperties,

  helpBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 8,
    border: "1px solid #E4E7EC",
    background: "transparent",
    cursor: "pointer",
    color: "#6E7580",
    transition: "all 0.15s",
  } as React.CSSProperties,

  // Two-column grid (desktop only)
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 340px",
    gap: "1.5rem",
    alignItems: "start",
  } as React.CSSProperties,

  // Card
  card: {
    background: "#fff",
    border: "1px solid #E4E7EC",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
  } as React.CSSProperties,

  cardHeader: {
    padding: "1rem 1.25rem",
    borderBottom: "1px solid #E4E7EC",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,

  cardTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#141820",
    margin: 0,
  } as React.CSSProperties,

  cardBody: {
    padding: "1.25rem",
  } as React.CSSProperties,

  // Drop zone
  dropZone: (dragging: boolean): React.CSSProperties => ({
    border: `2px dashed ${dragging ? "#0076B6" : "#B0B7BC"}`,
    borderRadius: 12,
    background: dragging ? "rgba(0,118,182,0.04)" : "#F7F9FB",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "3rem 2rem",
    textAlign: "center",
    transition: "all 0.2s",
    cursor: "pointer",
    minHeight: 260,
  }),

  uploadCircle: {
    width: 88,
    height: 88,
    borderRadius: "50%",
    background: "rgba(0,118,182,0.08)",
    border: "2px dashed rgba(0,118,182,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
  } as React.CSSProperties,

  uploadLabel: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#0076B6",
  } as React.CSSProperties,

  uploadSub: {
    fontSize: "0.875rem",
    color: "#6E7580",
    marginTop: "0.25rem",
  } as React.CSSProperties,

  // Primary button
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.75rem 1.75rem",
    background: "#0076B6",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.15s",
    width: "100%",
  } as React.CSSProperties,

  // Secondary / ghost button
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.625rem 1.25rem",
    background: "#fff",
    color: "#141820",
    fontSize: "0.9375rem",
    fontWeight: 500,
    border: "1px solid #E4E7EC",
    borderRadius: 8,
    cursor: "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties,

  // Tag / badge
  badge: (color: "blue" | "green" | "silver"): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "0.2rem 0.6rem",
    borderRadius: 20,
    fontSize: "0.75rem",
    fontWeight: 600,
    background: color === "blue" ? "rgba(0,118,182,0.1)" : color === "green" ? "rgba(34,197,94,0.1)" : "#EFF2F5",
    color: color === "blue" ? "#0076B6" : color === "green" ? "#16a34a" : "#6E7580",
  }),

  // Tip box (right column)
  tipBox: {
    background: "rgba(0,118,182,0.04)",
    border: "1px solid rgba(0,118,182,0.15)",
    borderRadius: 10,
    padding: "1rem 1.125rem",
    marginBottom: "0.75rem",
  } as React.CSSProperties,

  tipTitle: {
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: "#0076B6",
    marginBottom: "0.375rem",
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
  } as React.CSSProperties,

  tipText: {
    fontSize: "0.875rem",
    color: "#4B5563",
    lineHeight: 1.55,
  } as React.CSSProperties,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomePage2() {
  const { signOut, recordUsage, planFeatures } = useAuth();
  const cameraInputRef  = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const navigate        = useNavigate();
  const isMobile        = useIsMobile();

  // State (identical to original)
  const [stagedImages,      setStagedImages]      = useState<string[]>([]);
  const [dragging,          setDragging]          = useState(false);
  const [optimizing,        setOptimizing]        = useState(false);
  const [optimizeProgress,  setOptimizeProgress]  = useState({ done: 0, total: 0 });
  const [imagesOptimized,   setImagesOptimized]   = useState(false);
  const [showTour,          setShowTour]          = useState(false);

  // Voice state
  const [recording,     setRecording]     = useState(false);
  const [transcribing,  setTranscribing]  = useState(false);
  const [voiceNote,     setVoiceNote]     = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const chunksRef            = useRef<Blob[]>([]);
  const timerRef             = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoOptimizeTimerRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  // Show tour on first visit
  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEY)) {
      const t = setTimeout(() => setShowTour(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  // Auto-optimize when images are staged
  useEffect(() => {
    if (stagedImages.length === 0 || imagesOptimized || optimizing) return;
    if (autoOptimizeTimerRef.current) clearTimeout(autoOptimizeTimerRef.current);
    autoOptimizeTimerRef.current = setTimeout(async () => {
      setOptimizing(true);
      setOptimizeProgress({ done: 0, total: stagedImages.length });
      try {
        const optimized = await optimizeImages(stagedImages, (done, total) => {
          setOptimizeProgress({ done, total });
        });
        setStagedImages(optimized);
        setImagesOptimized(true);
        await recordUsage("optimize");
      } catch {
        toast.error("Failed to optimize images.");
      } finally {
        setOptimizing(false);
      }
    }, 500);
    return () => { if (autoOptimizeTimerRef.current) clearTimeout(autoOptimizeTimerRef.current); };
  }, [stagedImages, imagesOptimized, optimizing, recordUsage]);

  const handleTourFinish = () => {
    setShowTour(false);
    localStorage.setItem(TOUR_KEY, "true");
  };

  // File validation (identical to original)
  const validateAndStageFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" is not a supported format`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        setStagedImages(prev => [...prev, e.target?.result as string]);
        setImagesOptimized(false);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeImage    = (i: number)  => { setStagedImages(prev => prev.filter((_, idx) => idx !== i)); setImagesOptimized(false); };
  const handleCapture  = ()           => { (isMobile ? cameraInputRef : galleryInputRef).current?.click(); };
  const handleGallery  = ()           => { galleryInputRef.current?.click(); };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { validateAndStageFiles(e.target.files); e.target.value = ""; };
  const handleProcess  = ()           => { if (stagedImages.length) navigate("/analyze", { state: { imageUrls: stagedImages, voiceNote } }); };

  // Voice
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    setRecordingTime(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr     = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mr;
      chunksRef.current        = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setTranscribing(true);
        try {
          const blob   = new Blob(chunksRef.current, { type: "audio/webm" });
          const reader = new FileReader();
          const b64    = await new Promise<string>(res => { reader.onload = () => res(reader.result as string); reader.readAsDataURL(blob); });
          const { data, error } = await supabase.functions.invoke("transcribe-voice", { body: { audioBase64: b64 } });
          if (error || data?.error) throw new Error(data?.error || error?.message || "Transcription failed");
          const t = data.transcript || "";
          if (t) { setVoiceNote(prev => prev ? `${prev} ${t}` : t); toast.success("Voice note transcribed!"); }
          else toast.error("Couldn't detect any speech. Try again.");
        } catch (e: any) {
          toast.error(e.message || "Failed to transcribe voice note.");
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      setRecording(true);
      setRecordingTime(0);
      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed++;
        setRecordingTime(elapsed);
        if (elapsed >= MAX_RECORDING_SEC) stopRecording();
      }, 1000);
    } catch {
      toast.error("Microphone access denied.");
    }
  }, [stopRecording]);

  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); }, []);
  const handleDrop      = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); validateAndStageFiles(e.dataTransfer.files); }, [validateAndStageFiles]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const EmptyDropZone = (
    <div
      style={S.dropZone(dragging)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleCapture}
    >
      <div style={S.uploadCircle}>
        {isMobile
          ? <Camera size={36} color="#0076B6" />
          : <Upload size={36} color="#0076B6" />}
      </div>
      <div>
        <div style={S.uploadLabel} data-tour="capture-button">
          {isMobile ? "Capture Item" : "Upload Photos"}
        </div>
        <div style={S.uploadSub}>
          {isMobile
            ? "Take photos or upload images to generate your eBay listing"
            : "Click to browse or drag & drop files here"}
        </div>
        <div style={{ fontSize: "0.8125rem", color: "#9BA3AD", marginTop: "0.375rem" }}>
          JPG, PNG, WebP, GIF, MP4, MOV · Max {MAX_FILE_SIZE_MB}MB per file
        </div>
      </div>

      {/* Gallery shortcut on desktop */}
      {!isMobile && (
        <button
          style={{ ...S.btnSecondary, marginTop: "0.5rem" }}
          onClick={e => { e.stopPropagation(); handleGallery(); }}
        >
          <Upload size={16} />
          Browse Files
        </button>
      )}

      {/* Bulk listing shortcut */}
      <button
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.5rem 1rem", borderRadius: 8,
          border: "1px solid rgba(0,118,182,0.3)", background: "rgba(0,118,182,0.05)",
          color: "#0076B6", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer",
        }}
        onClick={e => { e.stopPropagation(); navigate("/bulk"); }}
      >
        <Layers size={15} />
        Bulk List (CSV/Excel)
      </button>
    </div>
  );

  const StagingGallery = (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Gallery header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "1rem", fontWeight: 600, color: "#141820" }}>
          Item Photos ({stagedImages.length})
        </span>
        <button
          onClick={handleCapture}
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none",
                   color: "#0076B6", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}
        >
          <ImagePlus size={16} /> Add More
        </button>
      </div>

      {dragging && (
        <div style={{ border: "2px dashed #0076B6", borderRadius: 10, padding: "2rem",
                      textAlign: "center", color: "#0076B6", fontSize: "0.9375rem",
                      fontWeight: 600, background: "rgba(0,118,182,0.04)" }}>
          Drop files here to add
        </div>
      )}

      {/* Photo grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "0.625rem" }}>
        {stagedImages.map((url, i) => (
          <div
            key={i}
            style={{ position: "relative", aspectRatio: "1", borderRadius: 8,
                     overflow: "hidden", border: "1px solid #E4E7EC", background: "#F7F9FB" }}
          >
            <img src={url} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button
              onClick={() => removeImage(i)}
              style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22,
                       borderRadius: "50%", background: "rgba(255,255,255,0.9)", border: "none",
                       cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={12} color="#141820" />
            </button>
            {i === 0 && (
              <span style={{ position: "absolute", bottom: 4, left: 4, fontSize: "0.6875rem",
                             fontWeight: 700, background: "#0076B6", color: "#fff",
                             padding: "1px 6px", borderRadius: 4 }}>
                Main
              </span>
            )}
          </div>
        ))}
        {/* Add tile */}
        <button
          onClick={handleCapture}
          style={{ aspectRatio: "1", borderRadius: 8, border: "2px dashed #B0B7BC",
                   background: "transparent", cursor: "pointer", display: "flex",
                   flexDirection: "column", alignItems: "center", justifyContent: "center",
                   gap: "0.375rem", color: "#6E7580", transition: "all 0.15s" }}
        >
          {isMobile ? <Camera size={20} /> : <Upload size={20} />}
          <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>Add</span>
        </button>
      </div>

      {/* Auto-optimizer status */}
      <div
        data-tour="image-optimizer"
        style={{ background: "#F7F9FB", border: "1px solid #E4E7EC", borderRadius: 10, padding: "0.875rem 1rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.375rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Sparkles size={15} color="#0076B6" />
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#141820" }}>Auto-Optimizer</span>
          </div>
          {imagesOptimized && <span style={S.badge("green")}>✓ Complete</span>}
          {optimizing && (
            <span style={{ ...S.badge("blue"), display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
              Processing...
            </span>
          )}
        </div>
        <p style={{ fontSize: "0.875rem", color: "#6E7580", lineHeight: 1.5, margin: 0 }}>
          {optimizing
            ? `Optimizing ${optimizeProgress.done}/${optimizeProgress.total} photo${optimizeProgress.total !== 1 ? "s" : ""}…`
            : imagesOptimized
              ? "✓ Photos optimized and ready for analysis."
              : "Photos are auto-optimized: backgrounds cropped, items centered, brightness normalized."}
        </p>
      </div>

      {/* Voice note */}
      {planFeatures.hasVoiceNotes ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Mic size={15} color="#0076B6" />
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#141820" }}>Voice Note</span>
            <span style={{ fontSize: "0.8125rem", color: "#9BA3AD", marginLeft: "auto" }}>
              Optional · {MAX_RECORDING_SEC}s max
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.625rem 1.25rem", borderRadius: 8,
                background: recording ? "#dc2626" : "#F7F9FB",
                color: recording ? "#fff" : "#141820",
                border: `1px solid ${recording ? "#dc2626" : "#E4E7EC"}`,
                fontSize: "0.9375rem", fontWeight: 500, cursor: "pointer",
                opacity: transcribing ? 0.6 : 1,
              }}
            >
              {transcribing ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Transcribing…</>
               : recording   ? <><MicOff size={16} /> Stop ({MAX_RECORDING_SEC - recordingTime}s)</>
               :               <><Mic size={16} /> Record Note</>}
            </button>
            {voiceNote && !recording && !transcribing && (
              <button
                onClick={() => setVoiceNote("")}
                style={{ padding: "0.625rem 1rem", borderRadius: 8, border: "1px solid #fca5a5",
                         background: "transparent", color: "#dc2626", fontSize: "0.875rem",
                         fontWeight: 500, cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>
          {voiceNote && (
            <div style={{ background: "#F7F9FB", border: "1px solid #E4E7EC", borderRadius: 8, padding: "0.75rem 1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6E7580", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Transcription
              </p>
              <textarea
                value={voiceNote}
                onChange={e => setVoiceNote(e.target.value)}
                rows={2}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none",
                         resize: "none", fontSize: "0.9375rem", color: "#141820", lineHeight: 1.5 }}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem",
                      background: "#F7F9FB", border: "1px solid #E4E7EC", borderRadius: 10,
                      padding: "0.875rem 1rem" }}>
          <Mic size={18} color="#B0B7BC" />
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#6E7580", margin: 0 }}>Voice Notes</p>
            <p style={{ fontSize: "0.8125rem", color: "#9BA3AD", margin: 0 }}>
              Upgrade to Pro ($49/mo) to add voice notes to your listings.
            </p>
          </div>
        </div>
      )}

      {/* Process button */}
      <button onClick={handleProcess} style={S.btnPrimary}>
        <Sparkles size={18} />
        Process Now
        <ArrowRight size={18} />
      </button>
    </div>
  );

  // ── Tips panel (desktop right column) ──────────────────────────────────────

  const TipsPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#141820", margin: "0 0 0.5rem" }}>
        Tips for Best Results
      </h3>

      {[
        {
          icon: "📸",
          title: "Photo Quality",
          text: "Use good lighting and photograph on a clean, neutral background. Multiple angles help the AI give better descriptions.",
        },
        {
          icon: "🔍",
          title: "Show Details",
          text: "Include close-ups of any labels, hallmarks, serial numbers, or wear. These details help accurate pricing.",
        },
        {
          icon: "🎙️",
          title: "Voice Notes",
          text: "Add a voice note with extra context — condition notes, provenance, or anything not visible in photos.",
        },
        {
          icon: "⚡",
          title: "Bulk Listing",
          text: "Listing multiple items? Use the Bulk List (CSV/Excel) option to create many listings at once.",
        },
      ].map(tip => (
        <div key={tip.title} style={S.tipBox}>
          <div style={S.tipTitle}>
            <span>{tip.icon}</span>
            {tip.title}
          </div>
          <p style={S.tipText}>{tip.text}</p>
        </div>
      ))}

      {/* Keyboard shortcut hint for desktop */}
      <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#F7F9FB",
                    border: "1px solid #E4E7EC", fontSize: "0.8125rem", color: "#6E7580" }}>
        <Info size={13} style={{ display: "inline", marginRight: "0.375rem", verticalAlign: "middle" }} />
        Drag & drop images anywhere on this page to add them.
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const isDesktop = !isMobile;

  return (
    <AppShell>
      <div style={{ ...S.page, ...(isDesktop ? {} : {}) }}>
        <div style={isDesktop ? S.pageInner : S.pageInnerMobile}>

          {/* Page header */}
          <div style={S.headerBar}>
            <div>
              <h1 style={S.pageTitle}>Capture Item</h1>
              <p style={S.pageSubtitle}>Upload photos to generate your eBay listing with AI</p>
            </div>
            <button
              onClick={() => setShowTour(true)}
              data-tour="help-button"
              style={S.helpBtn}
              title="Show tour"
            >
              <HelpCircle size={18} />
            </button>
          </div>

          {/* Content */}
          {isDesktop ? (
            /* Desktop: two-column */
            <div style={S.twoCol}>
              {/* Left: main upload/staging area */}
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardTitle}>
                    {stagedImages.length === 0 ? "Add Photos" : `Photos (${stagedImages.length})`}
                  </span>
                  {stagedImages.length > 0 && (
                    imagesOptimized
                      ? <span style={S.badge("green")}>✓ Optimized</span>
                      : optimizing
                        ? <span style={{ ...S.badge("blue"), display: "flex", alignItems: "center", gap: 4 }}>
                            <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                            Optimizing…
                          </span>
                        : null
                  )}
                </div>
                <div style={S.cardBody}>
                  {stagedImages.length === 0 ? EmptyDropZone : StagingGallery}
                </div>
              </div>

              {/* Right: tips */}
              {TipsPanel}
            </div>
          ) : (
            /* Mobile: single column */
            <div>
              {stagedImages.length === 0 ? EmptyDropZone : StagingGallery}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={cameraInputRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
      <input ref={galleryInputRef} type="file" accept={ACCEPT_STRING} multiple className="hidden" onChange={handleFileChange} />

      {/* Tour */}
      <WelcomeTour steps={TOUR_STEPS} active={showTour} onFinish={handleTourFinish} />

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}