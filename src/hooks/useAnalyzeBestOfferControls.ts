import { useCallback } from "react";

interface UseAnalyzeBestOfferControlsParams {
  setBestOfferEnabled: (value: boolean) => void;
  setBestOfferAutoAcceptPrice: (value: number) => void;
  setBestOfferAutoDeclinePrice: (value: number) => void;
}

export function useAnalyzeBestOfferControls({
  setBestOfferEnabled,
  setBestOfferAutoAcceptPrice,
  setBestOfferAutoDeclinePrice,
}: UseAnalyzeBestOfferControlsParams) {
  const toggleBestOffer = useCallback((enabled: boolean) => {
    setBestOfferEnabled(enabled);
  }, [setBestOfferEnabled]);

  const updateBestOfferAutoAccept = useCallback((rawValue: string) => {
    setBestOfferAutoAcceptPrice(parseFloat(rawValue) || 0);
  }, [setBestOfferAutoAcceptPrice]);

  const updateBestOfferAutoDecline = useCallback((rawValue: string) => {
    setBestOfferAutoDeclinePrice(parseFloat(rawValue) || 0);
  }, [setBestOfferAutoDeclinePrice]);

  return {
    toggleBestOffer,
    updateBestOfferAutoAccept,
    updateBestOfferAutoDecline,
  };
}
