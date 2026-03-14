import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PLANS } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ListingDraft } from "@/types/listing";
import { useDrafts } from "@/hooks/useDrafts";
import { uploadListingImage } from "@/lib/imageUpload";

/**
 * Sequential publishing with retry logic.
 * 
 * Publishes drafts one at a time to avoid token refresh race conditions.
 * Implements exponential backoff retry (up to 3 attempts) for transient failures.
 * 
 * Returns: "ok" | "auth_redirect" | "error"
 */
export function usePublishDraft() {
  const { canPublish, recordUsage, isOwner, user } = useAuth();
  const { markDraftPublished, markDraftFailed, updateDraft, removeDraft } = useDrafts();
  const navigate = useNavigate();

  // Queue management: tracks pending drafts and prevents concurrent publishes
  const publishQueueRef = useRef<ListingDraft[]>([]);
  const isPublishingRef = useRef(false);
  const [, setPublishingState] = useState(false); // force re-render on queue changes

  /**
   * Retrieve the eBay user token and location data (postal code + city).
   * Prefers server-side storage (Supabase profiles) over localStorage.
   * 
   * Flow:
   * 1. Try get_stored_token from ebay-publish (returns token + location from profiles table)   * 2. If no token, fall back to localStorage + return null for location
   */
  const getEbayToken = useCallback(async (): Promise<{
    token: string | null;
    postalCode: string | null;
    city: string | null;
    isExpired?: boolean;
  }> => {
    // 1. Try server-side stored token (secure, preferred)
    if (user?.id) {
      try {
        const { data, error } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (!error && data?.token) {
          console.log("getEbayToken: server-side token found:", {
            tokenExists: !!data.token,
            postalCode: data.postalCode || "NOT_SET",
            city: data.city || "NOT_SET",
            isExpired: data.isExpired || false,
          });
          return {
            token: data.token,
            postalCode: data.postalCode ?? null,
            city: data.city ?? null,
            isExpired: data.isExpired ?? false,
          };
        }
        if (!error && data?.isExpired) {
          // Token is expired and refresh failed
          console.log("getEbayToken: token expired, refresh failed");
          return {
            token: null,
            postalCode: data.postalCode ?? null,
            city: data.city ?? null,
            isExpired: true,
          };
        }
      } catch (err) {
        console.warn("getEbayToken: server-side token fetch failed:", err);
        // Fall through to localStorage
      }
    }

    // 2. Fall back to localStorage (legacy / backwards compat)
    const localToken = localStorage.getItem("ebay-user-token");
    console.log("getEbayToken: using localStorage token (no server-side token found)");
    return { token: localToken, postalCode: null, city: null };
  }, [user?.id]);

  /**
   * Attempt to publish a single draft with retry logic.
   * On transient failures (token expiry), clears token and retries.
   * On permanent failures (missing policies, auction format, etc), marks as failed.
   * Returns true if published successfully, false if failed after retries.
   */
  const publishWithRetry = useCallback(
    async (draft: ListingDraft, attempt: number = 1): Promise<boolean> => {
      const maxRetries = 3;
      const baseDelayMs = 1000;

      // --- Pre-flight checks ---
      if (!isOwner) {
        toast.error("Publishing is restricted to the account owner.");
        await markDraftFailed(draft.id, "Publishing restricted to account owner");
        return false;
      }

      if (!canPublish) {
        toast.error(
          `Monthly publish limit reached (${PLANS.starter.publishLimit}). Upgrade to Pro for unlimited.`
        );
        navigate("/billing");
        await markDraftFailed(draft.id, "Monthly publish limit reached");
        return false;
      }

      // --- Policy validation: warn if no policies explicitly selected ---
      const hasPolicies =
        draft.fulfillmentPolicyId && draft.paymentPolicyId && draft.returnPolicyId;
      if (!hasPolicies) {
        toast.warning(
          `"${draft.title}" — no eBay policies selected. The first available policy of each type will be used automatically.`,
          { duration: 5000 }
        );
      }

      // --- Get fresh token (with proactive refresh inside getEbayToken) ---
      const { token: ebayToken, postalCode, city, isExpired } = await getEbayToken();

      console.log(`publishWithRetry [attempt ${attempt}/${maxRetries}]:`, {
        draftId: draft.id,
        hasToken: !!ebayToken,
        isExpired,
      });

      if (!ebayToken) {
        if (isExpired) {
          // Token was expired and refresh failed — need re-auth
          if (attempt < maxRetries) {
            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            console.log(`publishWithRetry: token expired, waiting ${delayMs}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return publishWithRetry(draft, attempt + 1);
          } else {
            console.error(`publishWithRetry: max retries reached, token expired`);
            await markDraftFailed(draft.id, "eBay session expired after retry");
            toast.error("eBay session expired. Please reconnect and try again.");
            return false;
          }
        } else {
          // No token at all — trigger OAuth
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
            await markDraftFailed(draft.id, "Failed to get eBay auth URL");
            return false;
          }
          window.location.href = data.authUrl;
          return false; // publishWithRetry will never return after redirect
        }
      }

      // --- Mark as "publishing" in DB ---
      await updateDraft(draft.id, { publishStatus: "publishing" });

      // --- Ensure imageUrl is a public HTTPS URL ---
      let resolvedImageUrl = draft.imageUrl;
      if (resolvedImageUrl?.startsWith("data:") && user?.id) {
        const uploaded = await uploadListingImage(resolvedImageUrl, user.id);
        if (!uploaded.startsWith("data:")) {
          resolvedImageUrl = uploaded;
          await updateDraft(draft.id, { imageUrl: resolvedImageUrl });
        }
      }

      const publishPayload = {
        action: "create_draft",
        userToken: ebayToken,
        sku: `LA-${draft.id.replace(/-/g, "").slice(0, 16).toUpperCase()}`,
        postalCode: postalCode || undefined,
        city: city || undefined,
        _debug_postalCode: postalCode,
        _debug_city: city,
        title: draft.title,
        description: draft.description,
        listingFormat: draft.listingFormat ?? "FIXED_PRICE",
        listingPrice: draft.listingPrice ?? 0,
        auctionStartPrice: draft.listingFormat === "AUCTION" ? (draft.listingPrice ?? 0) : 0,
        auctionBuyItNow: null,
        auctionDuration: draft.listingFormat === "AUCTION"
          ? (draft.auctionDuration || "Days_7")
          : undefined,
        imageUrl: resolvedImageUrl,
        condition: draft.condition ?? "PRE_OWNED_GOOD",
        ebayCategoryId: draft.ebayCategoryId ?? "",
        itemSpecifics: draft.itemSpecifics ?? {},
        fulfillmentPolicyId: draft.fulfillmentPolicyId ?? null,
        paymentPolicyId: draft.paymentPolicyId ?? null,
        returnPolicyId: draft.returnPolicyId ?? null,
      };

      console.log(`publishWithRetry [attempt ${attempt}/${maxRetries}]: invoking ebay-publish`, {
        draftId: draft.id,
        title: draft.title,
      });

      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: publishPayload,
      });

      if (error || data?.error) {
        const errMsg = data?.error || error?.message || "Publish failed";

        // --- Permanent failures: don't retry ---
        if (data?.auctionNotSupported) {
          await updateDraft(draft.id, { publishStatus: "draft" });
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
          return false;
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
          return false;
        }
        if (data?.publishFailed) {
          await markDraftFailed(draft.id, errMsg);
          toast.error(`"${draft.title}" — offer created but couldn't go live`, {
            description: data.error,
            duration: 8000,
          });
          return false;
        }

        // --- Transient failures: retry with exponential backoff ---
        if (errMsg.includes("401") || errMsg.includes("expired") || errMsg.includes("session")) {
          localStorage.removeItem("ebay-user-token");
          if (attempt < maxRetries) {
            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            console.log(`publishWithRetry [attempt ${attempt}/${maxRetries}]: token error, retrying in ${delayMs}ms`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return publishWithRetry(draft, attempt + 1);
          } else {
            console.error(`publishWithRetry: max retries reached for token error`);
            await markDraftFailed(draft.id, "eBay session expired after retry");
            toast.error("eBay session expired. Please reconnect and try again.");
            return false;
          }
        }

        // --- Other errors: mark as failed ---
        await markDraftFailed(draft.id, errMsg);
        toast.error(errMsg);
        return false;
      }

      // --- Success ---
      console.log(`publishWithRetry: success [attempt ${attempt}/${maxRetries}]`, {
        draftId: draft.id,
        listingId: data.listingId,
        offerId: data.offerId,
      });

      await markDraftPublished(draft.id, {
        sku: data.sku,
        offerId: data.offerId,
        listingId: data.listingId,
      });

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
                  // Non-fatal
                }
              },
            }
          : undefined,
      });

      toast("Delete this draft from your list?", {
        action: {
          label: "Delete",
          onClick: async () => {
            await removeDraft(draft.id);
            toast.success("Draft deleted");
          },
        },
        cancel: {
          label: "Keep",
        },
      });

      await recordUsage("ebay_publish");
      return true;
    },
    [canPublish, isOwner, navigate, recordUsage, getEbayToken, markDraftPublished, markDraftFailed, updateDraft, removeDraft, user?.id]
  );

  /**
   * Process the publish queue sequentially.
   * Only one draft publishes at a time to avoid token refresh race conditions.
   */
  const processPublishQueue = useCallback(async () => {
    if (isPublishingRef.current) {
      console.log("processPublishQueue: already publishing, skipping");
      return;
    }

    if (publishQueueRef.current.length === 0) {
      console.log("processPublishQueue: queue empty");
      isPublishingRef.current = false;
      setPublishingState(false);
      return;
    }

    isPublishingRef.current = true;
    setPublishingState(true);

    while (publishQueueRef.current.length > 0) {
      const draft = publishQueueRef.current[0];
      console.log(`processPublishQueue: publishing ${draft.id}`, {
        queueLength: publishQueueRef.current.length,
        title: draft.title,
      });

      const success = await publishWithRetry(draft);
      publishQueueRef.current.shift(); // Remove from queue regardless of success/failure
      setPublishingState(publishQueueRef.current.length > 0);

      // Small delay between publishes to avoid overwhelming the API
      if (publishQueueRef.current.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    isPublishingRef.current = false;
    setPublishingState(false);
    console.log("processPublishQueue: finished");
  }, [publishWithRetry]);

  /**
   * Enqueue a draft for publishing.
   * If no publish is in progress, start processing the queue.
   */
  const publishDraft = useCallback(
    async (draft: ListingDraft): Promise<"ok" | "auth_redirect" | "error"> => {
      // Enqueue the draft
      publishQueueRef.current.push(draft);
      console.log("publishDraft: draft enqueued", {
        draftId: draft.id,
        title: draft.title,
        queueLength: publishQueueRef.current.length,
      });

      // Start processing queue if not already processing
      if (!isPublishingRef.current) {
        await processPublishQueue();
      }

      // Return "ok" immediately (actual result will be shown via toasts)
      return "ok";
    },
    [processPublishQueue]
  );

  return { publishDraft };
}
