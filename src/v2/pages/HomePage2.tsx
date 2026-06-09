/**
 * HomePage2 — V2 Immersive Upload UX
 *
 * Enhancements over previous version:
 *   - Immersive large drop zone with brand glow on drag
 *   - High-end thumbnail grid with hover overlays (Delete + Set as Main)
 *   - Skeleton loaders during optimization
 *   - Glassmorphism depth: floating shadows, backdrop blur
 *   - Gradient CTA buttons with glow box-shadow
 *   - Airy layout: max-width 800px upload card, tighter tips spacing
 */

import {
  Camera, Upload, Sparkles, X, ArrowRight, ImagePlus,
  Mic, MicOff, Loader2, HelpCircle, Layers, Info, Star, Trash2,
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
import UsageSummaryCard from "../components/UsageSummaryCard";

// ── Constants ──────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "image/heif", "image/gif", "video/mp4", "video/quicktime", "video/webm",
];
const ACCEPT_STRING =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,video/mp4,video/quicktime,video/webm";
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_RECORDING_SEC = 10;
const TOUR_KEY = "sls_tour_seen";

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

// ── CSS keyframes injected once ────────────────────────────────────────────────

const GLOBAL_CSS = `
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pulse-skeleton {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@keyframes thumb-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.v2-thumb-wrap:hover .v2-thumb-overlay { opacity: 1; }
.v2-thumb-wrap:hover .v2-thumb-img     { transform: scale(1.04); }
`;

// ── Styles ─────────────────────────────────────────────────────────────────────

const BRAND     = "#0076B6";
const BRAND_DRK = "#005a8a";
const BRAND_LT  = "#e6f4fb";
const BG        = "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)";
const FG        = "#141820";
const MUTED     = "#6E7580";
const BORDER    = "#D0D9E4";
const FONT      = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const cardFloat: React.CSSProperties = {
  background: "#ffffff",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: "1px solid #D8E4EF",
  borderRadius: 16,
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.07), 0 10px 30px -5px rgba(0,80,140,0.10), 0 0 0 1px rgba(0,118,182,0.04)",
};

const S = {
  page: {
    minHeight: "100vh",
    background: BG,
    fontFamily: FONT,
    backgroundAttachment: "fixed",
  } as React.CSSProperties,

  pageInner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "2rem 2rem 3rem",
  } as React.CSSProperties,

  pageInnerMobile: {
    padding: "1.25rem 1rem 1.5rem",
  } as React.CSSProperties,

  headerBar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "1.5rem",
  } as React.CSSProperties,

  pageTitle: {
    fontSize: "1.75rem",
    fontWeight: 800,
    color: FG,
    letterSpacing: "-0.03em",
    margin: 0,
    lineHeight: 1.2,
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: "0.9375rem",
    fontWeight: 400,
    color: MUTED,
    marginTop: "0.3rem",
  } as React.CSSProperties,

  helpBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "1px solid #D8E4EF",
    background: "#ffffff",
    cursor: "pointer",
    color: MUTED,
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(0,80,140,0.08)",
    transition: "all 0.15s",
  } as React.CSSProperties,

  usageSection: {
    marginBottom: "1.5rem",
  } as React.CSSProperties,

  // Desktop two-column: upload card (max 800px) + tips sidebar
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 300px",
    gap: "1.5rem",
    alignItems: "start",
  } as React.CSSProperties,

  // The floating upload card
  uploadCard: {
    ...cardFloat,
    overflow: "hidden",
    borderTop: `3px solid ${BRAND}`,
  } as React.CSSProperties,

  cardHeader: {
    padding: "1.125rem 1.5rem",
    borderBottom: "1px solid #E8EEF5",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
  } as React.CSSProperties,

  cardTitle: {
    fontSize: "1rem",
    fontWeight: 700,
    color: FG,
    margin: 0,
  } as React.CSSProperties,

  cardBody: {
    padding: "1.5rem",
  } as React.CSSProperties,

  // ── Immersive drop zone ────────────────────────────────────────────
  dropZone: (dragging: boolean): React.CSSProperties => ({
    border: `2px dashed ${dragging ? BRAND : "#C8D0D9"}`,
    borderRadius: 24,
    background: dragging
      ? "rgba(0,118,182,0.06)"
      : "rgba(0,118,182,0.025)",
    boxShadow: dragging
      ? `0 0 0 4px rgba(0,118,182,0.12), inset 0 0 20px rgba(0,118,182,0.04)`
      : "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.25rem",
    padding: "3.5rem 2.5rem",
    textAlign: "center",
    transition: "all 0.25s ease",
    cursor: "pointer",
    minHeight: 300,
    position: "relative",
  }),

  uploadIconWrap: (dragging: boolean): React.CSSProperties => ({
    width: 96,
    height: 96,
    borderRadius: "50%",
    background: dragging
      ? `rgba(0,118,182,0.15)`
      : `rgba(0,118,182,0.07)`,
    border: `2px dashed ${dragging ? BRAND : "rgba(0,118,182,0.3)"}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.25s ease",
    boxShadow: dragging
      ? `0 0 20px rgba(0,118,182,0.18)`
      : "none",
  }),

  dropZoneCTA: {
    fontSize: "1.25rem",
    fontWeight: 800,
    color: FG,
    letterSpacing: "-0.01em",
    margin: 0,
  } as React.CSSProperties,

  dropZoneSub: {
    fontSize: "0.9375rem",
    fontWeight: 400,
    color: MUTED,
    marginTop: "0.25rem",
  } as React.CSSProperties,

  dropZoneHint: {
    fontSize: "0.8125rem",
    color: "#9BA3AD",
    marginTop: "0.125rem",
  } as React.CSSProperties,

  // ── Gradient CTA button ────────────────────────────────────────────
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.8125rem 2rem",
    background: `linear-gradient(135deg, #1a8fd1 0%, ${BRAND} 100%)`,
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 700,
    border: "none",
    borderRadius: 14,
    cursor: "pointer",
    width: "100%",
    boxShadow: "0 4px 14px 0 rgba(0,118,182,0.38)",
    transition: "transform 0.18s ease, box-shadow 0.18s ease",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,

  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.625rem 1.25rem",
    background: "rgba(255,255,255,0.8)",
    color: FG,
    fontSize: "0.9375rem",
    fontWeight: 500,
    border: "1px solid rgba(228,231,236,0.8)",
    borderRadius: 12,
    cursor: "pointer",
    transition: "background 0.15s, transform 0.1s",
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  } as React.CSSProperties,

  btnBrandOutline: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.5rem 1.125rem",
    background: "rgba(0,118,182,0.06)",
    color: BRAND,
    fontSize: "0.875rem",
    fontWeight: 600,
    border: `1px solid rgba(0,118,182,0.25)`,
    borderRadius: 12,
    cursor: "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties,

  // ── Thumbnail grid ─────────────────────────────────────────────────
  thumbGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
    gap: "0.75rem",
  } as React.CSSProperties,

  thumbWrap: {
    position: "relative",
    aspectRatio: "1 / 1",
    borderRadius: 14,
    overflow: "hidden",
    background: "#EFF2F5",
    cursor: "default",
  } as React.CSSProperties,

  thumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    transition: "transform 0.22s ease",
  } as React.CSSProperties,

  thumbOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(10,20,40,0.48)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    opacity: 0,
    transition: "opacity 0.2s ease",
    borderRadius: 14,
  } as React.CSSProperties,

  thumbOverlayBtn: (variant: "danger" | "star"): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.35rem 0.7rem",
    borderRadius: 8,
    border: "none",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
    background: variant === "danger" ? "rgba(220,38,38,0.85)" : "rgba(255,255,255,0.15)",
    color: "#fff",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    transition: "background 0.15s",
  }),

  mainBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    fontSize: "0.6875rem",
    fontWeight: 700,
    background: BRAND,
    color: "#fff",
    padding: "2px 7px",
    borderRadius: 6,
    pointerEvents: "none" as const,
  } as React.CSSProperties,

  // skeleton
  skeleton: {
    width: "100%",
    height: "100%",
    background: "linear-gradient(90deg, #EFF2F5 0%, #e0e5ea 50%, #EFF2F5 100%)",
    backgroundSize: "200% 100%",
    animation: "pulse-skeleton 1.4s ease-in-out infinite",
    borderRadius: 14,
  } as React.CSSProperties,

  // optimizer status bar
  optimizerBar: {
    background: "rgba(0,118,182,0.04)",
    border: "1px solid rgba(0,118,182,0.12)",
    borderRadius: 14,
    padding: "0.875rem 1rem",
  } as React.CSSProperties,

  badge: (color: "blue" | "green" | "silver"): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "0.25rem 0.625rem",
    borderRadius: 20,
    fontSize: "0.75rem",
    fontWeight: 600,
    background: color === "blue" ? "rgba(0,118,182,0.1)" : color === "green" ? "rgba(34,197,94,0.1)" : "#EFF2F5",
    color: color === "blue" ? BRAND : color === "green" ? "#16a34a" : MUTED,
  }),

  // Tips panel
  tipsPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
  } as React.CSSProperties,

  tipBox: {
    background: "linear-gradient(135deg, rgba(0,118,182,0.06) 0%, rgba(0,118,182,0.02) 100%)",
    border: "1px solid rgba(0,118,182,0.15)",
    borderLeft: `3px solid ${BRAND}`,
    borderRadius: 12,
    padding: "0.875rem 1rem",
    boxShadow: "0 2px 8px rgba(0,80,140,0.06)",
  } as React.CSSProperties,

  tipTitle: {
    fontSize: "0.8125rem",
    fontWeight: 700,
    color: BRAND,
    marginBottom: "0.3rem",
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
  } as React.CSSProperties,

  tipText: {
    fontSize: "0.8125rem",
    fontWeight: 400,
    color: "#4B5563",
    lineHeight: 1.5,
    margin: 0,
  } as React.CSSProperties,
};

// ── Skeleton tile ──────────────────────────────────────────────────────────────

function SkeletonTile() {
  return (
    <div style={{ aspectRatio: "1 / 1", borderRadius: 14, overflow: "hidden" }}>
      <div style={S.skeleton} />
    </div>
  );
}

// ── Thumbnail tile with hover overlay ─────────────────────────────────────────

interface ThumbTileProps {
  url: string;
  index: number;
  isMain: boolean;
  isOptimizing: boolean;
  onRemove: (i: number) => void;
  onSetMain: (i: number) => void;
}

function ThumbTile({ url, index, isMain, isOptimizing, onRemove, onSetMain }: ThumbTileProps) {
  const [hovered, setHovered] = useState(false);

  if (isOptimizing) return <SkeletonTile />;

  return (
    <div
      className="v2-thumb-wrap"
      style={S.thumbWrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={url}
        alt={`Photo ${index + 1}`}
        className="v2-thumb-img"
        style={{
          ...S.thumbImg,
          transform: hovered ? "scale(1.04)" : "scale(1)",
        }}
      />
      {/* Hover overlay */}
      <div
        className="v2-thumb-overlay"
        style={{
          ...S.thumbOverlay,
          opacity: hovered ? 1 : 0,
        }}
      >
        <button
          style={S.thumbOverlayBtn("danger")}
          onClick={(e) => { e.stopPropagation(); onRemove(index); }}
          title="Remove photo"
        >
          <Trash2 size={11} /> Remove
        </button>
        {!isMain && (
          <button
            style={S.thumbOverlayBtn("star")}
            onClick={(e) => { e.stopPropagation(); onSetMain(index); }}
            title="Set as main photo"
          >
            <Star size={11} /> Main
          </button>
        )}
      </div>
      {isMain && <span style={S.mainBadge}>★ Main</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HomePage2() {
  const { recordUsage, planFeatures, usage, currentPlanLimits, currentPlan } = useAuth();
  const cameraInputRef  = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const navigate        = useNavigate();
  const isMobile        = useIsMobile();

  const [stagedImages,      setStagedImages]      = useState<string[]>([]);
  const [mainIndex,         setMainIndex]         = useState(0);
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

  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEY)) {
      const t = setTimeout(() => setShowTour(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

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

  const removeImage = (i: number) => {
    setStagedImages(prev => prev.filter((_, idx) => idx !== i));
    setImagesOptimized(false);
    setMainIndex(prev => {
      if (i === prev) return 0;
      if (i < prev) return prev - 1;
      return prev;
    });
  };

  const setMainImage = (i: number) => {
    // Reorder: move selected image to index 0
    setStagedImages(prev => {
      const next = [...prev];
      const [picked] = next.splice(i, 1);
      next.unshift(picked);
      return next;
    });
    setMainIndex(0);
    toast.success("Main photo updated");
  };

  const handleCapture   = () => { (isMobile ? cameraInputRef : galleryInputRef).current?.click(); };
  const handleGallery   = () => { galleryInputRef.current?.click(); };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { validateAndStageFiles(e.target.files); e.target.value = ""; };
  const handleProcess   = () => {
    if (!stagedImages.length) return;
    // Ensure main photo is first
    navigate("/analyze", { state: { imageUrls: stagedImages, voiceNote } });
  };

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

  const planLabel = currentPlan === "free" ? "Free"
    : currentPlan === "starter" ? "Starter"
    : currentPlan === "pro" ? "Pro"
    : currentPlan === "shop" ? "Shop"
    : "Unlimited";

  // ── Render: empty immersive drop zone ─────────────────────────────────────

  const EmptyDropZone = (
    <div
      style={S.dropZone(dragging)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleCapture}
      data-tour="capture-button"
    >
      <div style={S.uploadIconWrap(dragging)}>
        {isMobile
          ? <Camera size={38} color={BRAND} strokeWidth={1.75} />
          : <Upload size={38} color={BRAND} strokeWidth={1.75} />}
      </div>

      <div>
        <p style={S.dropZoneCTA}>
          {isMobile ? "Tap to capture or upload" : "Drop images here to start"}
        </p>
        <p style={S.dropZoneSub}>
          {isMobile ? "Take a photo or choose from your camera roll" : "or click anywhere to browse files"}
        </p>
        <p style={S.dropZoneHint}>
          JPG, PNG, WebP, GIF, MP4, MOV · Max {MAX_FILE_SIZE_MB}MB per file
        </p>
      </div>

      {/* Desktop shortcuts */}
      {!isMobile && (
        <div style={{ display: "flex", gap: "0.625rem", marginTop: "0.25rem" }}>
          <button
            style={S.btnSecondary}
            onClick={e => { e.stopPropagation(); handleGallery(); }}
          >
            <Upload size={15} /> Browse Files
          </button>
          <button
            style={S.btnBrandOutline}
            onClick={e => { e.stopPropagation(); navigate("/bulk"); }}
          >
            <Layers size={15} /> Bulk List (CSV/Excel)
          </button>
        </div>
      )}
    </div>
  );

  // ── Render: photo staging gallery ─────────────────────────────────────────

  const StagingGallery = (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Gallery header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "1rem", fontWeight: 700, color: FG }}>
          Item Photos ({stagedImages.length})
        </span>
        <button
          onClick={handleCapture}
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none",
                   color: BRAND, fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}
        >
          <ImagePlus size={16} /> Add More
        </button>
      </div>

      {/* Drag-over cue when images already staged */}
      {dragging && (
        <div style={{ border: `2px dashed ${BRAND}`, borderRadius: 14, padding: "1.5rem",
                      textAlign: "center", color: BRAND, fontSize: "0.9375rem",
                      fontWeight: 700, background: "rgba(0,118,182,0.04)" }}>
          Drop files here to add
        </div>
      )}

      {/* Photo grid with ThumbTile */}
      <div style={S.thumbGrid}>
        {stagedImages.map((url, i) => (
          <ThumbTile
            key={`${url.slice(-20)}-${i}`}
            url={url}
            index={i}
            isMain={i === 0}
            isOptimizing={optimizing && i >= optimizeProgress.done}
            onRemove={removeImage}
            onSetMain={setMainImage}
          />
        ))}
        {/* Add tile */}
        <button
          onClick={handleCapture}
          style={{
            aspectRatio: "1 / 1", borderRadius: 14, border: "2px dashed #B0B7BC",
            background: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "0.375rem", color: MUTED, transition: "all 0.15s",
          }}
        >
          {isMobile ? <Camera size={22} /> : <Upload size={22} />}
          <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Add</span>
        </button>
      </div>

      {/* Auto-optimizer status */}
      <div style={S.optimizerBar} data-tour="image-optimizer">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Sparkles size={15} color={BRAND} />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: FG }}>Auto-Optimizer</span>
          </div>
          {imagesOptimized && <span style={S.badge("green")}>✓ Complete</span>}
          {optimizing && (
            <span style={{ ...S.badge("blue"), display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
              {optimizeProgress.done}/{optimizeProgress.total}
            </span>
          )}
        </div>
        <p style={{ fontSize: "0.8125rem", color: MUTED, lineHeight: 1.5, margin: 0 }}>
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
            <Mic size={15} color={BRAND} />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: FG }}>Voice Note</span>
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
                padding: "0.625rem 1.25rem", borderRadius: 12,
                background: recording ? "#dc2626" : "rgba(255,255,255,0.8)",
                color: recording ? "#fff" : FG,
                border: `1px solid ${recording ? "#dc2626" : BORDER}`,
                fontSize: "0.9375rem", fontWeight: 600, cursor: "pointer",
                opacity: transcribing ? 0.6 : 1,
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              {transcribing ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Transcribing…</>
               : recording   ? <><MicOff size={16} /> Stop ({MAX_RECORDING_SEC - recordingTime}s)</>
               :               <><Mic size={16} /> Record Note</>}
            </button>
            {voiceNote && !recording && !transcribing && (
              <button
                onClick={() => setVoiceNote("")}
                style={{ padding: "0.625rem 1rem", borderRadius: 12, border: "1px solid #fca5a5",
                         background: "transparent", color: "#dc2626", fontSize: "0.875rem",
                         fontWeight: 600, cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>
          {voiceNote && (
            <div style={{ background: "rgba(0,118,182,0.04)", border: "1px solid rgba(0,118,182,0.12)", borderRadius: 12, padding: "0.875rem 1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: MUTED, marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Transcription
              </p>
              <textarea
                value={voiceNote}
                onChange={e => setVoiceNote(e.target.value)}
                rows={2}
                style={{ width: "100%", background: "transparent", border: "none", outline: "none",
                         resize: "none", fontSize: "0.9375rem", color: FG, lineHeight: 1.5 }}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem",
                      background: "rgba(255,255,255,0.6)", border: `1px solid ${BORDER}`, borderRadius: 14,
                      padding: "0.875rem 1rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <Mic size={18} color="#B0B7BC" />
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 700, color: MUTED, margin: 0 }}>Voice Notes</p>
            <p style={{ fontSize: "0.8125rem", color: "#9BA3AD", margin: 0 }}>
              Upgrade to Pro ($49/mo) to add voice notes to your listings.
            </p>
          </div>
        </div>
      )}

      {/* Process CTA */}
      <button
        onClick={handleProcess}
        style={S.btnPrimary}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 22px rgba(0,118,182,0.44)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 14px 0 rgba(0,118,182,0.38)";
        }}
      >
        <Sparkles size={18} />
        Process Now
        <ArrowRight size={18} />
      </button>
    </div>
  );

  // ── Tips panel (desktop right column) ─────────────────────────────────────

  const TipsPanel = (
    <div style={S.tipsPanel}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, color: FG, margin: "0 0 0.25rem", letterSpacing: "-0.01em" }}>
        Tips for Best Results
      </h3>
      {[
        {
          icon: "📸",
          title: "Photo Quality",
          text: "Good lighting + neutral background = better AI descriptions and pricing.",
        },
        {
          icon: "🔍",
          title: "Show Details",
          text: "Close-ups of labels, hallmarks, or serial numbers help accurate pricing.",
        },
        {
          icon: "🎙️",
          title: "Voice Notes",
          text: "Add condition notes or provenance via voice — anything not visible in photos.",
        },
        {
          icon: "⚡",
          title: "Bulk Listing",
          text: "Listing many items? Use the Bulk List CSV/Excel option.",
        },
      ].map(tip => (
        <div key={tip.title} style={S.tipBox}>
          <div style={S.tipTitle}>
            <span>{tip.icon}</span> {tip.title}
          </div>
          <p style={S.tipText}>{tip.text}</p>
        </div>
      ))}
      <div style={{ padding: "0.625rem 0.875rem", borderRadius: 10, background: "#ffffff",
                    border: `1px solid ${BORDER}`, fontSize: "0.75rem", color: MUTED,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.05)" }}>
        <Info size={12} style={{ display: "inline", marginRight: "0.3rem", verticalAlign: "middle" }} />
        Drag & drop images anywhere on this page.
      </div>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────────

  const isDesktop = !isMobile;

  return (
    <AppShell>
      <style>{GLOBAL_CSS}</style>
      <div style={S.page}>
        <div style={isDesktop ? S.pageInner : S.pageInnerMobile}>

          {/* Header */}
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

          {/* Usage summary */}
          <div style={S.usageSection}>
            <UsageSummaryCard
              metrics={[
                { label: "AI Analyses", used: usage.aiAnalysis, limit: currentPlanLimits.analysisLimit },
                { label: "eBay Publishes", used: usage.ebayPublish, limit: currentPlanLimits.publishLimit },
              ]}
              planName={planLabel}
            />
          </div>

          {/* Content */}
          {isDesktop ? (
            <div style={S.twoCol}>
              {/* Upload card */}
              <div style={S.uploadCard}>
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

              {/* Tips */}
              {TipsPanel}
            </div>
          ) : (
            <div>
              {/* Mobile: card wrapper */}
              <div style={{ ...S.uploadCard, marginBottom: "1rem" }}>
                <div style={S.cardBody}>
                  {stagedImages.length === 0 ? EmptyDropZone : StagingGallery}
                </div>
              </div>
              {/* Mobile tips (collapsed) */}
              <div style={{ ...S.tipsPanel, marginTop: "0.5rem" }}>
                {TipsPanel}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden inputs */}
      <input ref={cameraInputRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
      <input ref={galleryInputRef} type="file" accept={ACCEPT_STRING} multiple className="hidden" onChange={handleFileChange} />

      {/* Tour */}
      <WelcomeTour steps={TOUR_STEPS} active={showTour} onFinish={handleTourFinish} />
    </AppShell>
  );
}