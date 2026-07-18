import { useCallback } from "react";
import type { CoinConditionDetail, ItemSpecifics } from "@/types/listing";
import type { SelectedPolicies } from "@/types/ebay-policies";
import { buildPackageWeightAndSizePayload } from "@/lib/packageWeightAndSize";

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
  domain?: string; // Gemini Pass-1 domain (e.g. "coins_bullion") — forwarded to ebay-publish for coin detection
  packageWeightLb: number;
  packageWeightOz: number;
  packageLengthIn: number;
  packageWidthIn: number;
  packageHeightIn: number;
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
  domain,
  packageWeightLb,
  packageWeightOz,
  packageLengthIn,
  packageWidthIn,
  packageHeightIn,
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
    // Build publish item specifics — embed _coinConditionDetail and _domain so
    // ebay-publish can detect coin categories and build conditionDescriptors without
    // relying solely on its hardcoded HARDCODED_COIN_CATEGORY_IDS set.
    const publishItemSpecifics: Record<string, unknown> = {
      ...(itemSpecifics as Record<string, unknown>),
      ...(coinConditionDetail ? { _coinConditionDetail: coinConditionDetail } : {}),
      ...(domain && domain !== "general" ? { _domain: domain } : {}),
    };

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
    packageWeightAndSize: buildPackageWeightAndSizePayload({
      weightLb: packageWeightLb,
      weightOz: packageWeightOz,
      lengthIn: packageLengthIn,
      widthIn: packageWidthIn,
      heightIn: packageHeightIn,
    }),
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
    packageWeightLb,
    packageWeightOz,
    packageLengthIn,
    packageWidthIn,
    packageHeightIn,
    domain,
  ]);

  return {
    buildPublishPayload,
  };
}
