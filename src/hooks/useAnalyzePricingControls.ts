import { useCallback, useMemo } from "react";

interface UseAnalyzePricingControlsParams {
  listingPrice: number;
  auctionStartPrice: number;
  priceMin: number;
  priceMax: number;
  setListingPrice: (value: number) => void;
  setAuctionStartPrice: (value: number) => void;
  setListingFormat: (value: "FIXED_PRICE" | "AUCTION") => void;
  setQuantity: (value: number) => void;
  setPricingMode: (value: "per_item" | "total") => void;
  setAuctionBuyItNowEnabled: (value: boolean) => void;
  setAuctionBuyItNow: (value: number) => void;
}

export function useAnalyzePricingControls({
  listingPrice,
  auctionStartPrice,
  priceMin,
  priceMax,
  setListingPrice,
  setAuctionStartPrice,
  setListingFormat,
  setQuantity,
  setPricingMode,
  setAuctionBuyItNowEnabled,
  setAuctionBuyItNow,
}: UseAnalyzePricingControlsParams) {
  const listingPriceForCogs = useMemo(
    () =>
      listingPrice > 0
        ? listingPrice
        : auctionStartPrice > 0
          ? auctionStartPrice
          : (priceMin + priceMax) / 2,
    [auctionStartPrice, listingPrice, priceMax, priceMin],
  );

  const applyRecommendedPrice = useCallback(
    (price: number) => {
      setListingPrice(price);
      setAuctionStartPrice(price);
    },
    [setAuctionStartPrice, setListingPrice],
  );

  const selectFixedPriceFormat = useCallback(() => {
    setListingFormat("FIXED_PRICE");
  }, [setListingFormat]);

  const selectAuctionFormat = useCallback(() => {
    setListingFormat("AUCTION");
  }, [setListingFormat]);

  const updateListingPriceFromInput = useCallback(
    (rawValue: string) => {
      setListingPrice(parseFloat(rawValue) || 0);
    },
    [setListingPrice],
  );

  const updateAuctionStartPriceFromInput = useCallback(
    (rawValue: string) => {
      setAuctionStartPrice(parseFloat(rawValue) || 0);
    },
    [setAuctionStartPrice],
  );

  const updateQuantityFromInput = useCallback(
    (rawValue: string) => {
      const q = Math.max(1, Math.floor(parseFloat(rawValue) || 1));
      setQuantity(q);
      if (q === 1) setPricingMode("per_item");
    },
    [setPricingMode, setQuantity],
  );

  const selectPricingMode = useCallback(
    (mode: "per_item" | "total") => {
      setPricingMode(mode);
    },
    [setPricingMode],
  );

  const toggleAuctionBuyItNow = useCallback(
    (enabled: boolean) => {
      setAuctionBuyItNowEnabled(enabled);
    },
    [setAuctionBuyItNowEnabled],
  );

  const updateAuctionBuyItNowFromInput = useCallback(
    (rawValue: string) => {
      setAuctionBuyItNow(parseFloat(rawValue) || 0);
    },
    [setAuctionBuyItNow],
  );

  return {
    listingPriceForCogs,
    applyRecommendedPrice,
    selectFixedPriceFormat,
    selectAuctionFormat,
    updateListingPriceFromInput,
    updateAuctionStartPriceFromInput,
    updateQuantityFromInput,
    selectPricingMode,
    toggleAuctionBuyItNow,
    updateAuctionBuyItNowFromInput,
  };
}
