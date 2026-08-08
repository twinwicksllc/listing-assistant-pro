import { useCallback, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics } from "@/types/listing";
import { uploadListingImages } from "@/lib/imageUpload";

interface EbayMetadata {
  requiredAspects: string[];
}

interface UseAnalyzePublishParams {
  canPublish: boolean;
  publishLimit: number;
  userId: string | null | undefined;
  imageUrls: string[];
  itemSpecifics: ItemSpecifics;
  ebayMetadata: EbayMetadata | null;
  coinConditionDetailRequired: boolean;
  coinConditionDetailComplete: boolean;
  buildPublishPayload: (args: {
    imageUrlsForPayload: string[];
    postalCode?: string | null;
    city?: string | null;
  }) => Record<string, unknown>;
  onRequireBilling: () => void;
  onPublishSuccess: (data: any) => Promise<void> | void;
}

interface StoredTokenData {
  token: string | null;
  postalCode: string | null;
  city: string | null;
  reconnectRequired: boolean;
}

function clearCachedEbayTokens() {
  localStorage.removeItem("ebay-user-token");
  localStorage.removeItem("ebay-refresh-token");
  localStorage.removeItem("ebay-token-expires-at");
}

export function useAnalyzePublish({
  canPublish,
  publishLimit,
  userId,
  imageUrls,
  itemSpecifics,
  ebayMetadata,
  coinConditionDetailRequired,
  coinConditionDetailComplete,
  buildPublishPayload,
  onRequireBilling,
  onPublishSuccess,
}: UseAnalyzePublishParams) {
  const [publishing, setPublishing] = useState(false);

  const fetchStoredTokenData = useCallback(async (targetUserId: string): Promise<StoredTokenData> => {
    try {
      const { data } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_stored_token", userId: targetUserId },
      });
      return {
        token: data?.token ?? null,
        postalCode: data?.postalCode ?? null,
        city: data?.city ?? null,
        reconnectRequired: data?.reconnectRequired === true || data?.isExpired === true,
      };
    } catch (e) {
      console.error("useAnalyzePublish: get_stored_token error", e);
      return {
        token: null,
        postalCode: null,
        city: null,
        reconnectRequired: false,
      };
    }
  }, []);

  const loadPolicyToken = useCallback(async (): Promise<string | null> => {
    if (!userId) return localStorage.getItem("ebay-user-token");
    const tokenData = await fetchStoredTokenData(userId);
    return tokenData.token ?? localStorage.getItem("ebay-user-token");
  }, [fetchStoredTokenData, userId]);

  const handlePublish = useCallback(async () => {
    if (!canPublish) {
      toast.error(`Monthly publish limit reached (${publishLimit}). Upgrade for more listings.`);
      onRequireBilling();
      return;
    }

    if (ebayMetadata?.requiredAspects && ebayMetadata.requiredAspects.length > 0) {
      const missingRequired = ebayMetadata.requiredAspects.filter(
        (aspect) => !itemSpecifics[aspect] || String(itemSpecifics[aspect]).trim() === "",
      );
      if (missingRequired.length > 0) {
        toast.error(`Missing required eBay fields: ${missingRequired.join(", ")}`, {
          description: "Fill in these fields above before publishing.",
          duration: 6000,
        });
        return;
      }
    }

    if (coinConditionDetailRequired && !coinConditionDetailComplete) {
      toast.error("Missing required coin condition details", {
        description: "eBay now requires structured condition details for coin listings. Re-run analysis or complete the coin condition details before publishing.",
        duration: 8000,
      });
      return;
    }

    setPublishing(true);
    try {
      let ebayToken: string | null = null;
      let postalCode: string | null = null;
      let city: string | null = null;
      let reconnectRequired = false;

      if (userId) {
        const tokenData = await fetchStoredTokenData(userId);
        reconnectRequired = tokenData.reconnectRequired;
        if (tokenData.token) {
          ebayToken = tokenData.token;
          postalCode = tokenData.postalCode;
          city = tokenData.city;
          console.log("useAnalyzePublish: retrieved stored token data", {
            hasToken: !!tokenData.token,
            postalCode,
            city,
          });
        } else {
          postalCode = tokenData.postalCode;
          city = tokenData.city;
          console.log("useAnalyzePublish: no token but got location data from database", {
            postalCode,
            city,
          });
        }
      }

      if (!ebayToken && !reconnectRequired) {
        ebayToken = localStorage.getItem("ebay-user-token");
      }

      if (!ebayToken) {
        if (reconnectRequired) {
          clearCachedEbayTokens();
          toast.info("Your eBay session needs to be reconnected before publishing.");
        }
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_auth_url" },
        });
        if (error || data?.error) {
          throw new Error(data?.error || error?.message || "Failed to get auth URL");
        }

        localStorage.setItem(
          "pending_listing",
          JSON.stringify(
            buildPublishPayload({
              imageUrlsForPayload: imageUrls,
              postalCode,
              city,
            }),
          ),
        );
        window.location.href = data.authUrl;
        return;
      }

      const imageUrlsForPublish = userId
        ? await uploadListingImages(imageUrls, userId)
        : imageUrls;

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          ...buildPublishPayload({
            imageUrlsForPayload: imageUrlsForPublish,
            postalCode,
            city,
          }),
        },
      });

      if (error || data?.error) {
        const isPublishPolicyError = data?.publishFailed === true;
        const isTokenExpiry = !isPublishPolicyError && (
          data?.error?.includes("401 ") ||
          data?.error === "401" ||
          (data?.error?.includes("expired") && !data?.error?.includes("code has expired")) ||
          error?.message?.includes("401")
        );

        if (isTokenExpiry) {
          clearCachedEbayTokens();
          toast.error("eBay session expired. Please reconnect eBay in Settings.");
          return;
        }

        if (data?.missingPolicies) {
          toast.error("eBay business policies not configured", {
            description: data.error,
            action: {
              label: "Open Seller Hub",
              onClick: () => window.open("https://www.ebay.com/sh/ovw/policies", "_blank"),
            },
            duration: 10000,
          });
          return;
        }

        if (data?.publishFailed) {
          if (data?.isTransientError) {
            toast.error("eBay is temporarily unavailable", {
              description: data.error as string,
              action: {
                label: "Retry",
                // Reference the stable memoized function so the retry always
                // uses the latest closure rather than a stale one.
                onClick: () => handlePublish(),
              },
              duration: 12000,
            });
          } else {
            toast.error("eBay rejected the listing", {
              description: data.error as string,
              duration: 10000,
            });
          }
          return;
        }

        throw new Error(data?.error || error?.message || "Publish failed");
      }

      const successMsg = data.listingId
        ? `Listing published live on eBay! (ID: ${data.listingId})`
        : `Listing created on eBay (Offer ID: ${data.offerId})`;

      toast.success(successMsg, {
        description: data.affiliateUrl
          ? "Affiliate link ready - share it to earn EPN commissions."
          : undefined,
        action: data.affiliateUrl
          ? { label: "Copy Link", onClick: () => navigator.clipboard.writeText(data.affiliateUrl) }
          : undefined,
        duration: 5000,
      });

      await onPublishSuccess(data);
    } catch (err: any) {
      console.error("Publish error:", err);
      toast.error(err.message || "Failed to publish to eBay.");
    } finally {
      setPublishing(false);
    }
  }, [
    canPublish,
    publishLimit,
    userId,
    imageUrls,
    itemSpecifics,
    ebayMetadata,
    coinConditionDetailRequired,
    coinConditionDetailComplete,
    buildPublishPayload,
    onRequireBilling,
    onPublishSuccess,
    fetchStoredTokenData,
  ]);

  return {
    publishing,
    handlePublish,
    loadPolicyToken,
  };
}
