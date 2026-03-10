import { useState, useEffect, useCallback } from "react";
import { ListingDraft } from "@/types/listing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { uploadListingImage, uploadListingImages } from "@/lib/imageUpload";

export function useDrafts() {
  const { user, org } = useAuth();
  const [drafts, setDrafts] = useState<ListingDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());

  const fetchDrafts = useCallback(async () => {
    if (!user) {
      setDrafts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    
    // Filter by user_id - this ensures we only get the user's own drafts
    const query = supabase
      .from("drafts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching drafts:", error);
      toast.error("Failed to load drafts");
    } else {
      setDrafts(
        (data || []).map((d: any) => ({
          id: d.id,
          imageUrl: d.image_url,
          imageUrls: d.image_urls ?? undefined,
          title: d.title,
          description: d.description,
          priceMin: Number(d.price_min),
          priceMax: Number(d.price_max),
          createdAt: new Date(d.created_at),
          ebayCategoryId: d.ebay_category_id || undefined,
          itemSpecifics: d.item_specifics || undefined,
          condition: d.condition || undefined,
          consignor: d.consignor || "",
          listingFormat: (d.listing_format as "FIXED_PRICE" | "AUCTION") || "FIXED_PRICE",
          listingPrice: Number(d.listing_price) || 0,
          auctionStartPrice: Number(d.auction_start_price) || 0,
          auctionBuyItNow: d.auction_buy_it_now != null ? Number(d.auction_buy_it_now) : null,
        }))
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const addDraft = async (draft: ListingDraft): Promise<boolean> => {
    if (!user) {
      toast.error("Not authenticated");
      return false;
    }

    // Validate required fields
    if (!draft.imageUrl || !draft.title) {
      toast.error("Missing required fields: title and image");
      return false;
    }

    try {
      // Only include org_id if org has fully loaded and has a valid ID
      // Passing a null org_id when org is still loading can cause FK errors
      const orgId = (!org.loading && org.orgId) ? org.orgId : undefined;

      // Upload all images to Supabase Storage if they are base64 data URLs
      // This avoids hitting Supabase's 1MB REST API request size limit
      let imageUrl = draft.imageUrl;
      let imageUrls = draft.imageUrls;

      if (imageUrls && imageUrls.length > 0) {
        // Upload all images in parallel; the first becomes the thumbnail
        const base64Urls = imageUrls.filter((u) => u.startsWith("data:"));
        const alreadyStoredUrls = imageUrls.filter((u) => !u.startsWith("data:"));
        const uploadedUrls = base64Urls.length > 0
          ? await uploadListingImages(base64Urls, user.id)
          : [];
        imageUrls = [...uploadedUrls, ...alreadyStoredUrls];
        imageUrl = imageUrls[0];
      } else if (draft.imageUrl?.startsWith("data:")) {
        imageUrl = await uploadListingImage(draft.imageUrl, user.id);
        imageUrls = [imageUrl];
      }

      const { error } = await supabase.from("drafts").insert({
        id: draft.id,
        user_id: user.id,
        ...(orgId ? { org_id: orgId } : {}),
        image_url: imageUrl,
        image_urls: imageUrls ?? null,
        title: draft.title,
        description: draft.description,
        price_min: Number(draft.priceMin) || 0,
        price_max: Number(draft.priceMax) || 0,
        ebay_category_id: draft.ebayCategoryId || null,
        item_specifics: draft.itemSpecifics || {},
        condition: draft.condition || null,
        consignor: draft.consignor || "",
        listing_format: draft.listingFormat || "FIXED_PRICE",
        listing_price: Number(draft.listingPrice) || 0,
        auction_start_price: Number(draft.auctionStartPrice) || 0,
        auction_buy_it_now: draft.auctionBuyItNow ?? null,
      });

      if (error) {
        console.error("Error adding draft:", error);
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
        });
        toast.error(`Failed to save draft: ${error.message}`);
        return false;
      }

      // Update local state with the uploaded image URL
      setDrafts((prev) => [{ ...draft, imageUrl, imageUrls }, ...prev]);
      return true;
    } catch (err: any) {
      console.error("Unexpected error saving draft:", err);
      toast.error("Unexpected error saving draft");
      return false;
    }
  };

  const removeDraft = async (id: string) => {
    const { error } = await supabase.from("drafts").delete().eq("id", id);

    if (error) {
      console.error("Error deleting draft:", error);
      toast.error("Failed to delete draft");
    } else {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    }
  };

  /**
   * Publish a staged draft live to eBay using the user's stored token.
   * Returns true on success (draft is also removed from local state).
   */
  const publishDraft = async (draft: ListingDraft, userToken: string): Promise<boolean> => {
    setPublishingIds((prev) => new Set(prev).add(draft.id));
    try {
      const { data, error } = await supabase.functions.invoke("ebay-publish", {
        body: {
          action: "create_draft",
          userToken,
          title: draft.title,
          description: draft.description,
          listingFormat: draft.listingFormat || "FIXED_PRICE",
          listingPrice: draft.listingPrice || 0,
          auctionStartPrice: draft.auctionStartPrice || 0,
          auctionBuyItNow: draft.auctionBuyItNow ?? null,
          imageUrl: (draft.imageUrls && draft.imageUrls.length > 0) ? draft.imageUrls[0] : draft.imageUrl,
          condition: draft.condition,
          ebayCategoryId: draft.ebayCategoryId,
          itemSpecifics: draft.itemSpecifics,
        },
      });

      if (error || data?.error) {
        if (data?.missingPolicies) {
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
          toast.error(`"${draft.title}" — offer created but couldn't go live`, {
            description: data.error,
            duration: 8000,
          });
          return false;
        }
        const msg = data?.error || error?.message || "Publish failed";
        if (msg.includes("401") || msg.includes("expired")) {
          localStorage.removeItem("ebay-user-token");
          toast.error("eBay session expired. Please reconnect eBay and try again.");
          return false;
        }
        toast.error(`Failed to publish "${draft.title}": ${msg}`);
        return false;
      }

      const listingId = data?.listingId || data?.offerId;
      toast.success(`"${draft.title}" is live on eBay!`, {
        description: listingId ? `Listing ID: ${listingId}` : undefined,
        action: data?.affiliateUrl
          ? { label: "Copy Link", onClick: () => navigator.clipboard.writeText(data.affiliateUrl) }
          : undefined,
      });

      // Remove successfully published draft
      await removeDraft(draft.id);
      return true;
    } catch (err: any) {
      toast.error(`Unexpected error publishing "${draft.title}"`);
      return false;
    } finally {
      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
    }
  };

  return { drafts, addDraft, removeDraft, publishDraft, publishingIds, loading, refetchDrafts: fetchDrafts };
}
