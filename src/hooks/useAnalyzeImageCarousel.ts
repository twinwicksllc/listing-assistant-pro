import { useCallback, useState } from "react";

export function useAnalyzeImageCarousel(imageCount: number) {
  const [activePhoto, setActivePhoto] = useState(0);

  const goToNextPhoto = useCallback(() => {
    if (imageCount <= 1) return;
    setActivePhoto((p) => (p + 1) % imageCount);
  }, [imageCount]);

  const goToPreviousPhoto = useCallback(() => {
    if (imageCount <= 1) return;
    setActivePhoto((p) => (p - 1 + imageCount) % imageCount);
  }, [imageCount]);

  const selectPhoto = useCallback((index: number) => {
    if (index < 0 || index >= imageCount) return;
    setActivePhoto(index);
  }, [imageCount]);

  return {
    activePhoto,
    selectPhoto,
    goToNextPhoto,
    goToPreviousPhoto,
  };
}
