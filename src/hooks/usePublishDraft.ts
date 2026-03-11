import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ListingDraft } from "@/types/listing";
import { useDrafts } from "@/hooks/useDrafts";

/**
 * Returns a publishDraft(draft) function that sends a single ListingDraft
 * live to eBay using the ebay-publish edge function.
 *
 * Token retrieval order:
 *  1. Try to get the stored token from Supabase profiles (server-side, secure)
 *  2. Fall back to localStorage for backwards compatibility
 *  3. If no token found, trigger eBay OAuth flow
 *
 * Returns: "ok" | "auth_redirect" | "error"
 */
export function usePublishDraft() {
  const { canPublish, recordUsage, isOwner, user } = useAuth();
  const { markDraftPublished, markDraftFailed, updateDraft } = useDrafts();
  const navigate = useNavigate();

  /**
   * Retrieve the eBay user token.
   * Prefers server-side storage (Supabase profiles) over localStorage.
   */
  const getEbayToken = useCallback(async (): Promise<{
    token: string | null;
    postalCode: string | null;
  }> => {
    // 1. Try server-side stored token (secure, preferred)
    if (user?.id) {
      try {
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (!error && data?.token) {
          return { token: data.token, postalCode: data.postalCode ?? null };
        }
      } catch {
        // Fall through to localStorage
      }
    }

    // 2. Fall back to localStorage (legacy / backwards compat)
    const localToken = localStorage.getItem("ebay-user-token");
    return { token: localToken, postalCode: null };
  }, [user?.id]);

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

      // --- Policy validation: warn if no policies explicitly selected ---
      // Auto-selecting the first policy silently can cause wrong shipping/returns behavior.
      // We allow it but warn the user so they're aware.
      const hasPolicies =
        draft.fulfillmentPolicyId && draft.paymentPolicyId && draft.returnPolicyId;
      if (!hasPolicies) {
        toast.warning(
          `"${draft.title}" — no eBay policies selected. The first available policy of each type will be used automatically.`,
          { duration: 5000 }
        );
      }

      const { token: ebayToken, postalCode } = await getEbayToken();

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

      // Mark as "publishing" in DB so UI can show spinner and prevent duplicate submits
      await updateDraft(draft.id, { publishStatus: "publishing" });

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken: ebayToken,
          // Deterministic SKU based on draft ID — retries update the same eBay record
          sku: `LA-${draft.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`,
          // Seller's postal code — used to create/verify the eBay inventory location
          postalCode: postalCode || undefined,
          title: draft.title,
          description: draft.description,
          listingFormat: draft.listingFormat ?? "FIXED_PRICE",
          listingPrice: draft.listingPrice ?? 0,
          auctionStartPrice: draft.listingFormat === "AUCTION" ? (draft.listingPrice ?? 0) : 0,
          auctionBuyItNow: null,
          auctionDuration: draft.listingFormat === "AUCTION"
            ? (draft.auctionDuration || "Days_7")
            : undefined,
          imageUrl: draft.imageUrl,
          condition: draft.condition ?? "PRE_OWNED_GOOD",
          ebayCategoryId: draft.ebayCategoryId ?? "",
          itemSpecifics: draft.itemSpecifics ?? {},
          fulfillmentPolicyId: draft.fulfillmentPolicyId ?? null,
          paymentPolicyId: draft.paymentPolicyId ?? null,
          returnPolicyId: draft.returnPolicyId ?? null,
        },
      });

      if (error || data?.error) {
        const errMsg = data?.error || error?.message || "Publish failed";

        if (errMsg.includes("401") || errMsg.includes("expired")) {
          // Clear stale token from both storage locations
          localStorage.removeItem("ebay-user-token");
          await markDraftFailed(draft.id, "eBay session expired");
          toast.error("eBay session expired. Please reconnect and try again.");
          return "error";
        }
        if (data?.auctionNotSupported) {
          // Auction format is not supported by the Inventory API
          await updateDraft(draft.id, { publishStatus: "draft" }); // revert to draft
          toast.error("Auction format not supported", {
            description:
              "The eBay Inventory API only supports Fixed Price listings. " +
              "Please edit this draft and change the format to Fixed Price.",
            action: {
              label: "Learn More",
              onClick: () =>
                window.open(
                  "https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer",
                  "_blank"
                ),
            },
            duration: 10000,
          });
          return "error";
        }
        if (data?.missingPolicies) {
          await markDraftFailed(draft.id, errMsg);
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
          await markDraftFailed(draft.id, errMsg);
          toast.error(`"${draft.title}" — offer created but couldn't go live`, {
            description: data.error,
            duration: 8000,
          });
          return "error";
        }

        await markDraftFailed(draft.id, errMsg);
        toast.error(errMsg);
        return "error";
      }

      // --- Success: mark draft as published and remove from drafts list ---
      await markDraftPublished(draft.id, {
        sku: data.sku,
        offerId: data.offerId,
        listingId: data.listingId,
      });

      // Build success toast — affiliate URL failure is non-fatal
      const successMsg = data.listingId
        ? `"${draft.title}" is live on eBay! (ID: ${data.listingId})`
        : `"${draft.title}" created on eBay (Offer ID: ${data.offerId})`;

      toast.success(successMsg, {
        description: data.affiliateUrl
          ? "Affiliate link ready — share it to earn EPN commissions."
          : undefined,
        action: data.affiliateUrl
          ? {
              label: "Copy Link",
              onClick: () => {
                try {
                  navigator.clipboard.writeText(data.affiliateUrl);
                } catch {
                  // Non-fatal: clipboard may not be available
                }
              },
            }
          : undefined,
      });

      await recordUsage("ebay_publish");
      return "ok";
    },
    [canPublish, isOwner, navigate, recordUsage, getEbayToken, markDraftPublished, markDraftFailed, updateDraft]
  );

  return { publishDraft };
}
