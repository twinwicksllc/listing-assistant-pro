import { useRef, useState, useEffect, useCallback } from "react";
import { X, Camera, CheckCircle, RotateCcw, Trash2, Zap, ZapOff, FlipHorizontal } from "lucide-react";

interface CameraSheetModalProps {
  open: boolean;
  onClose: () => void;
  onDone: (photos: string[]) => void;
}

export default function CameraSheetModal({ open, onClose, onDone }: CameraSheetModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [queue, setQueue] = useState<string[]>([]);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashEffect, setFlashEffect] = useState(false);

  // Start camera stream
  const startCamera = useCallback(async (facing: "environment" | "user") => {
    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraError(null);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check torch support
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as any;
      setTorchSupported(!!(capabilities?.torch));
      setTorchOn(false);
    } catch (err: any) {
      console.error("Camera error:", err);
      if (err.name === "NotAllowedError") {
        setCameraError("Camera access denied. Please allow camera access in your browser settings.");
      } else if (err.name === "NotFoundError") {
        setCameraError("No camera found on this device.");
      } else {
        setCameraError("Could not start camera. Please try again.");
      }
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Open/close lifecycle
  useEffect(() => {
    if (open) {
      setQueue([]);
      setFacingMode("environment");
      startCamera("environment");
    } else {
      stopCamera();
      setQueue([]);
      setTorchOn(false);
    }
  }, [open, startCamera, stopCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Toggle torch
  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await (track as any).applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch (e) {
      console.warn("Torch toggle failed:", e);
    }
  };

  // Flip camera
  const flipCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  // Capture a frame
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || capturing) return;
    setCapturing(true);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) { setCapturing(false); return; }

    // Mirror if front camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setQueue((prev) => [...prev, dataUrl]);

    // Flash effect
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);
    setCapturing(false);
  }, [facingMode, capturing]);

  const removeFromQueue = (index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDone = () => {
    stopCamera();
    onDone(queue);
    onClose();
  };

  const handleCancel = () => {
    stopCamera();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Flash effect overlay */}
      {flashEffect && (
        <div className="absolute inset-0 z-50 bg-white opacity-70 pointer-events-none" />
      )}

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-safe-top py-3 bg-gradient-to-b from-black/70 to-transparent">
        <button
          onClick={handleCancel}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-white text-sm font-semibold">
          {queue.length === 0
            ? "Take Photos"
            : `${queue.length} photo${queue.length !== 1 ? "s" : ""} captured`}
        </div>

        <div className="flex items-center gap-2">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white"
            >
              {torchOn ? <Zap className="w-5 h-5 text-yellow-400" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={flipCamera}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white"
          >
            <FlipHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera viewfinder */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="w-12 h-12 text-white/40" />
            <p className="text-white/70 text-sm">{cameraError}</p>
            <button
              onClick={() => startCamera(facingMode)}
              className="px-6 py-2.5 rounded-xl bg-white text-black text-sm font-semibold"
            >
              Try Again
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover ${
              facingMode === "user" ? "scale-x-[-1]" : ""
            }`}
          />
        )}

        {/* Corner guides */}
        <div className="absolute inset-6 pointer-events-none">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white/60 rounded-tl-sm" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white/60 rounded-tr-sm" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white/60 rounded-bl-sm" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white/60 rounded-br-sm" />
        </div>
      </div>

      {/* Thumbnail queue strip */}
      {queue.length > 0 && (
        <div className="relative z-10 flex gap-2 px-4 py-2 bg-gradient-to-t from-black/80 to-transparent overflow-x-auto">
          {queue.map((photo, i) => (
            <div key={i} className="relative flex-shrink-0">
              <img
                src={photo}
                alt={`Shot ${i + 1}`}
                className="w-14 h-14 rounded-lg object-cover border-2 border-white/30"
              />
              <button
                onClick={() => removeFromQueue(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-primary text-white px-1 rounded">
                  MAIN
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom controls */}
      <div className="relative z-10 flex items-center justify-between px-8 py-6 pb-safe-bottom bg-gradient-to-t from-black to-transparent">
        {/* Retake last / spacer */}
        <div className="w-14 h-14 flex items-center justify-center">
          {queue.length > 0 && (
            <button
              onClick={() => removeFromQueue(queue.length - 1)}
              className="w-11 h-11 rounded-full bg-black/50 border border-white/30 flex items-center justify-center text-white"
              title="Remove last photo"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Shutter button */}
        <button
          onClick={capturePhoto}
          disabled={!!cameraError || capturing}
          className="w-20 h-20 rounded-full bg-white border-4 border-white/30 shadow-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className="w-16 h-16 rounded-full bg-white border-2 border-black/10" />
        </button>

        {/* Done button */}
        <div className="w-14 h-14 flex items-center justify-center">
          {queue.length > 0 ? (
            <button
              onClick={handleDone}
              className="w-14 h-14 rounded-full bg-primary flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform"
              title={`Use ${queue.length} photo${queue.length !== 1 ? "s" : ""}`}
            >
              <CheckCircle className="w-6 h-6 text-white" />
              <span className="text-[10px] text-white font-bold mt-0.5">{queue.length}</span>
            </button>
          ) : (
            <div className="w-14 h-14" />
          )}
        </div>
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}