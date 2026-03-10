import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ListingDraft } from "@/types/listing";

/**
 * Returns a publishDraft(draft) function that sends a single ListingDraft
 * live to eBay using the same ebay-publish edge function as AnalyzePage.
 *
 * Returns: "ok" | "auth_redirect" | "error"
 */
export function usePublishDraft() {
  const { canPublish, recordUsage, isOwner } = useAuth();
  const navigate = useNavigate();

  const publishDraft = useCallback(
    async (draft: ListingDraft): Promise<"ok" | "auth_redirect" | "error"> => {
      if (!isOwner) {
        toast.error("Publishing is restricted to the account owner.");
        return "error";
      }

      if (!canPublish) {
        toast.error(
          `Monthly publish limit reached (${PLANS.starter.publishLimit}). Upgrade to Pro for unlimited.`
        );
        navigate("/billing");
        return "error";
      }

      const ebayToken = localStorage.getItem("ebay-user-token");

      if (!ebayToken) {
        // Save all pending draft IDs so we can resume after OAuth
        const pendingIds: string[] = JSON.parse(
          localStorage.getItem("pending_draft_ids") || "[]"
        );
        if (!pendingIds.includes(draft.id)) pendingIds.push(draft.id);
        localStorage.setItem("pending_draft_ids", JSON.stringify(pendingIds));

        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_auth_url" },
        });
        if (error || data?.error) {
          toast.error(data?.error || error?.message || "Failed to get auth URL");
          return "error";
        }
        window.location.href = data.authUrl;
        return "auth_redirect";
      }

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          title: draft.title,
          description: draft.description,
          listingFormat: draft.listingFormat ?? "FIXED_PRICE",
          listingPrice: draft.listingPrice ?? 0,
          auctionStartPrice: draft.listingFormat === "AUCTION" ? (draft.listingPrice ?? 0) : 0,
          auctionBuyItNow: null,
          imageUrl: draft.imageUrl,
          condition: draft.condition ?? "USED_EXCELLENT",
          ebayCategoryId: draft.ebayCategoryId ?? "",
          itemSpecifics: draft.itemSpecifics ?? {},
          fulfillmentPolicyId: draft.fulfillmentPolicyId ?? null,
          paymentPolicyId: draft.paymentPolicyId ?? null,
          returnPolicyId: draft.returnPolicyId ?? null,
        },
      });

      if (error || data?.error) {
        if (data?.error?.includes("401") || data?.error?.includes("expired")) {
          localStorage.removeItem("ebay-user-token");
          toast.error("eBay session expired. Please reconnect and try again.");
          return "error";
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
          return "error";
        }
        if (data?.publishFailed) {
          toast.error(`"${draft.title}" — offer created but couldn't go live`, {
            description: data.error,
            duration: 8000,
          });
          return "error";
        }
        toast.error(data?.error || error?.message || "Publish failed");
        return "error";
      }

      const successMsg = data.listingId
        ? `"${draft.title}" is live on eBay! (ID: ${data.listingId})`
        : `"${draft.title}" created on eBay (Offer ID: ${data.offerId})`;

      toast.success(successMsg, {
        description: data.affiliateUrl
          ? "Affiliate link ready — share it to earn EPN commissions."
          : undefined,
        action: data.affiliateUrl
          ? { label: "Copy Link", onClick: () => navigator.clipboard.writeText(data.affiliateUrl) }
          : undefined,
      });

      await recordUsage("ebay_publish");
      return "ok";
    },
    [canPublish, isOwner, navigate, recordUsage]
  );

  return { publishDraft };
}
