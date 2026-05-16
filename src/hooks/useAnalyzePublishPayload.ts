import { useCallback } from "react";
import type { CoinConditionDetail, ItemSpecifics } from "@/types/listing";
import type { SelectedPolicies } from "@/types/ebay-policies";

interface UseAnalyzePublishPayloadParams {
  title: string;
  descriptionWithFooter: string;
  listingFormat: "FIXED_PRICE" | "AUCTION";
  listingPrice: number;
  auctionStartPrice: number;
  auctionBuyItNowEnabled: boolean;
  auctionBuyItNow: number;
  condition: string;
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  coinConditionDetail: CoinConditionDetail | null;
  selectedPolicies: SelectedPolicies;
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number;
  bestOfferAutoDeclinePrice: number;
  quantity: number;
  pricingMode: "per_item" | "total";
  ebayVideoId: string | null;
  ebayVideoStatus: string | null;
}

export function useAnalyzePublishPayload({
  title,
  descriptionWithFooter,
  listingFormat,
  listingPrice,
  auctionStartPrice,
  auctionBuyItNowEnabled,
  auctionBuyItNow,
  condition,
  ebayCategoryId,
  itemSpecifics,
  coinConditionDetail,
  selectedPolicies,
  bestOfferEnabled,
  bestOfferAutoAcceptPrice,
  bestOfferAutoDeclinePrice,
  quantity,
  pricingMode,
  ebayVideoId,
  ebayVideoStatus,
}: UseAnalyzePublishPayloadParams) {
  const buildPublishPayload = useCallback(({
    imageUrlsForPayload,
    postalCode,
    city,
  }: {
    imageUrlsForPayload: string[];
    postalCode?: string | null;
    city?: string | null;
  }) => {
    const publishItemSpecifics = coinConditionDetail
      ? { ...(itemSpecifics as Record<string, unknown>), _coinConditionDetail: coinConditionDetail }
      : itemSpecifics;

    return {
    title,
    description: descriptionWithFooter,
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNow: auctionBuyItNowEnabled ? auctionBuyItNow : null,
    imageUrls: imageUrlsForPayload,
    condition,
    ebayCategoryId,
    itemSpecifics: publishItemSpecifics,
    postalCode: postalCode || undefined,
    city: city || undefined,
    fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId || undefined,
    paymentPolicyId: selectedPolicies.paymentPolicyId || undefined,
    returnPolicyId: selectedPolicies.returnPolicyId || undefined,
    bestOfferEnabled: bestOfferEnabled || undefined,
    bestOfferAutoAcceptPrice: bestOfferEnabled && bestOfferAutoAcceptPrice > 0 ? bestOfferAutoAcceptPrice : undefined,
    bestOfferAutoDeclinePrice: bestOfferEnabled && bestOfferAutoDeclinePrice > 0 ? bestOfferAutoDeclinePrice : undefined,
    quantity: quantity > 1 ? quantity : undefined,
    pricingMode: quantity > 1 ? pricingMode : undefined,
    ebayVideoId: ebayVideoStatus === "LIVE" ? ebayVideoId : undefined,
    };
  }, [
    title,
    descriptionWithFooter,
    listingFormat,
    listingPrice,
    auctionStartPrice,
    auctionBuyItNowEnabled,
    auctionBuyItNow,
    condition,
    ebayCategoryId,
    itemSpecifics,
    coinConditionDetail,
    selectedPolicies.fulfillmentPolicyId,
    selectedPolicies.paymentPolicyId,
    selectedPolicies.returnPolicyId,
    bestOfferEnabled,
    bestOfferAutoAcceptPrice,
    bestOfferAutoDeclinePrice,
    quantity,
    pricingMode,
    ebayVideoStatus,
    ebayVideoId,
  ]);

  return {
    buildPublishPayload,
  };
}
