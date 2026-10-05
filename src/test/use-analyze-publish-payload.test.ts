import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useAnalyzePublishPayload } from "@/hooks/useAnalyzePublishPayload";

describe("useAnalyzePublishPayload condition descriptors", () => {
  test("forwards descriptors separately and keeps backend metadata out of item specifics", () => {
    const conditionDescriptors = [{ name: "grade", values: ["10"] }];
    const { result } = renderHook(() =>
      useAnalyzePublishPayload({
        title: "Test item",
        descriptionWithFooter: "Description",
        listingFormat: "FIXED_PRICE",
        listingPrice: 25,
        auctionStartPrice: 0,
        auctionBuyItNowEnabled: false,
        auctionBuyItNow: 0,
        condition: "LIKE_NEW",
        ebayCategoryId: "123",
        itemSpecifics: {
          Brand: "Example",
          _conditionDescriptors: conditionDescriptors,
        } as never,
        coinConditionDetail: null,
        selectedPolicies: {
          fulfillmentPolicyId: "fulfillment",
          paymentPolicyId: "payment",
          returnPolicyId: "return",
        },
        bestOfferEnabled: false,
        bestOfferAutoAcceptPrice: 0,
        bestOfferAutoDeclinePrice: 0,
        quantity: 1,
        pricingMode: "per_item",
        ebayVideoId: null,
        ebayVideoStatus: null,
        domain: "general",
        packageWeightLb: 0,
        packageWeightOz: 0,
        packageLengthIn: 0,
        packageWidthIn: 0,
        packageHeightIn: 0,
      }),
    );

    const payload = result.current.buildPublishPayload({
      imageUrlsForPayload: [],
    });
    expect(payload.conditionDescriptors).toEqual(conditionDescriptors);
    expect(payload.itemSpecifics).toEqual({ Brand: "Example" });

    const withoutDescriptors = renderHook(() =>
      useAnalyzePublishPayload({
        title: "Test item",
        descriptionWithFooter: "Description",
        listingFormat: "FIXED_PRICE",
        listingPrice: 25,
        auctionStartPrice: 0,
        auctionBuyItNowEnabled: false,
        auctionBuyItNow: 0,
        condition: "LIKE_NEW",
        ebayCategoryId: "123",
        itemSpecifics: { Brand: "Example" } as never,
        coinConditionDetail: null,
        selectedPolicies: {
          fulfillmentPolicyId: "fulfillment",
          paymentPolicyId: "payment",
          returnPolicyId: "return",
        },
        bestOfferEnabled: false,
        bestOfferAutoAcceptPrice: 0,
        bestOfferAutoDeclinePrice: 0,
        quantity: 1,
        pricingMode: "per_item",
        ebayVideoId: null,
        ebayVideoStatus: null,
        domain: "general",
        packageWeightLb: 0,
        packageWeightOz: 0,
        packageLengthIn: 0,
        packageWidthIn: 0,
        packageHeightIn: 0,
      }),
    );
    const payloadWithoutDescriptors =
      withoutDescriptors.result.current.buildPublishPayload({
        imageUrlsForPayload: [],
      });
    expect(payloadWithoutDescriptors).not.toHaveProperty(
      "conditionDescriptors",
    );
  });
});
