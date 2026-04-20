import { useCallback } from "react";

interface UseAnalyzeVideoHandlersParams {
  setEbayVideoId: (value: string | null) => void;
  setVideoUrl: (value: string | null) => void;
  setEbayVideoStatus: (value: string | null) => void;
}

export function useAnalyzeVideoHandlers({
  setEbayVideoId,
  setVideoUrl,
  setEbayVideoStatus,
}: UseAnalyzeVideoHandlersParams) {
  const onVideoReady = useCallback((id: string, url: string) => {
    setEbayVideoId(id);
    setVideoUrl(url);
    setEbayVideoStatus("LIVE");
  }, [setEbayVideoId, setEbayVideoStatus, setVideoUrl]);

  const onVideoRemoved = useCallback(() => {
    setEbayVideoId(null);
    setVideoUrl(null);
    setEbayVideoStatus(null);
  }, [setEbayVideoId, setEbayVideoStatus, setVideoUrl]);

  const onVideoStatusChange = useCallback((status: string) => {
    setEbayVideoStatus(status);
  }, [setEbayVideoStatus]);

  return {
    onVideoReady,
    onVideoRemoved,
    onVideoStatusChange,
  };
}
