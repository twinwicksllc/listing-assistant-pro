import { Camera, Upload, Sparkles } from "lucide-react";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "@/components/BottomNav";

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;
      navigate("/analyze", { state: { imageUrl } });
    };
    reader.readAsDataURL(file);
  };

  const handleCapture = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Listing Assistant</h1>
            <p className="text-xs text-muted-foreground">AI-powered eBay listings</p>
          </div>
        </div>
      </header>

      {/* Main capture area */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 pb-24">
        <div className="w-full max-w-sm space-y-6 text-center">
          {/* Capture circle */}
          <button
            onClick={handleCapture}
            className="mx-auto w-40 h-40 rounded-full bg-primary/10 border-2 border-dashed border-primary/30 flex flex-col items-center justify-center gap-3 transition-all hover:bg-primary/15 hover:border-primary/50 active:scale-95"
          >
            <Camera className="w-10 h-10 text-primary" />
            <span className="text-sm font-semibold text-primary">Capture Item</span>
          </button>

          <p className="text-muted-foreground text-sm">
            Take a photo or upload an image to generate your eBay listing instantly
          </p>

          {/* Upload alternative */}
          <button
            onClick={handleCapture}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium transition-colors hover:bg-secondary/80"
          >
            <Upload className="w-4 h-4" />
            Upload from Gallery
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <BottomNav />
    </div>
  );
}
