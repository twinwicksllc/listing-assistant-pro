import { ChevronLeft, ChevronRight } from "lucide-react";

interface ImageCarouselProps {
  imageUrls: string[];
  activePhoto: number;
  onSelectPhoto: (index: number) => void;
  onGoToPreviousPhoto: () => void;
  onGoToNextPhoto: () => void;
}

export function ImageCarousel({
  imageUrls,
  activePhoto,
  onSelectPhoto,
  onGoToPreviousPhoto,
  onGoToNextPhoto,
}: ImageCarouselProps) {
  return (
    <>
      {/* Main carousel */}
      <div className="relative rounded-xl overflow-hidden border border-border aspect-square bg-secondary">
        <img
          src={imageUrls[activePhoto]}
          alt={`Item photo ${activePhoto + 1}`}
          className="w-full h-full object-cover"
        />
        {imageUrls.length > 1 && (
          <>
            <button
              onClick={onGoToPreviousPhoto}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-background/90 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onGoToNextPhoto}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-background/90 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {imageUrls.map((_, i) => (
                <button
                  key={i}
                  onClick={() => onSelectPhoto(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === activePhoto ? "bg-primary" : "bg-background/60"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {imageUrls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {imageUrls.map((url, i) => (
            <button
              key={i}
              onClick={() => onSelectPhoto(i)}
              className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${
                i === activePhoto ? "border-primary" : "border-border"
              }`}
            >
              <img src={url} alt={`Thumb ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
