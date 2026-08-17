import { useState, useEffect, useCallback } from "react";
import {
  ListingDraft,
  PublishStatus,
  CoinConditionDetail,
} from "@/types/listing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const LISTING_IMAGES_PUBLIC_URL_MARKER = "/object/public/listing-images/";

/**
 * Reverse of getPublicUrl(): recover a bare storage object path from a
 * listing-images public URL, for use with storage.remove(). Returns null for
 * anything that isn't a listing-images URL (e.g. a data: URL from a failed
 * upload, or an unrelated remote URL) so callers can safely skip those
 * instead of passing them to remove().
 */
function listingImagesPathFromPublicUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const idx = url.indexOf(LISTING_IMAGES_PUBLIC_URL_MARKER);
  if (idx === -1) return null;
  return url.slice(idx + LISTING_IMAGES_PUBLIC_URL_MARKER.length);
}

export function useDrafts() {
  const { user, org } = useAuth();
  const [drafts, setDrafts] = useState<ListingDraft[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    if (!user) {
      setDrafts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("drafts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching drafts:", error);
      toast.error("Failed to load drafts");
    } else {
      setDrafts(
        (data || []).map((d: any) => ({
          id: d.id,
          imageUrl: d.image_url,
          imageUrls: d.image_urls || (d.image_url ? [d.image_url] : []),
          title: d.title,
          description: d.description,
          priceMin: Number(d.price_min),
          priceMax: Number(d.price_max),
          listingPrice:
            d.listing_price != null ? Number(d.listing_price) : undefined,
          listingFormat: d.listing_format || "FIXED_PRICE",
          createdAt: new Date(d.created_at),
          ebayCategoryId: d.ebay_category_id || undefined,
          ebayCategoryBreadcrumb: d.ebay_category_breadcrumb || undefined,
          itemSpecifics: d.item_specifics || undefined,
          condition: d.condition || undefined,
          consignor: d.consignor || "",
          fulfillmentPolicyId: d.fulfillment_policy_id || undefined,
          paymentPolicyId: d.payment_policy_id || undefined,
          returnPolicyId: d.return_policy_id || undefined,
          auctionDuration: d.auction_duration || undefined,
          // Publish lifecycle
          publishStatus: (d.publish_status as PublishStatus) || "draft",
          publishedAt: d.published_at ? new Date(d.published_at) : undefined,
          ebaySku: d.ebay_sku || undefined,
          ebayOfferId: d.ebay_offer_id || undefined,
          ebayListingId: d.ebay_listing_id || undefined,
          lastPublishError: d.last_publish_error || undefined,
          // Cost of Goods Sold
          cogs: d.cogs != null ? Number(d.cogs) : undefined,
          cogsSource: d.cogs_source || undefined,
          cogsAcquiredAt: d.cogs_acquired_at
            ? new Date(d.cogs_acquired_at)
            : undefined,
          // Precious metal content
          metalType: d.metal_type || "none",
          metalWeightOz: Number(d.metal_weight_oz) || 0,
          // eBay June 2026 coin condition requirement (stored inside item_specifics)
          coinConditionDetail: (d.item_specifics as any)
            ?._coinConditionDetail as CoinConditionDetail | undefined,
          // Multi-quantity
          quantity: d.quantity ?? 1,
          pricingMode: (d.pricing_mode as "per_item" | "total") ?? "per_item",
          // Package dimensions
          packageWeightLb:
            d.package_weight_lb != null
              ? Number(d.package_weight_lb)
              : undefined,
          packageWeightOz:
            d.package_weight_oz != null
              ? Number(d.package_weight_oz)
              : undefined,
          packageLengthIn:
            d.package_length_in != null
              ? Number(d.package_length_in)
              : undefined,
          packageWidthIn:
            d.package_width_in != null ? Number(d.package_width_in) : undefined,
          packageHeightIn:
            d.package_height_in != null
              ? Number(d.package_height_in)
              : undefined,
          // Video
          videoUrl: d.video_url || undefined,
          ebayVideoId: d.ebay_video_id || undefined,
          ebayVideoStatus: d.ebay_video_status || undefined,
          // Item domain (Phase 4 quality-assurance tracking)
          domain: d.domain || undefined,
        })),
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const addDraft = async (draft: ListingDraft): Promise<boolean> => {
    if (!user) return false;

    const orgId = !org.loading && org.orgId ? org.orgId : undefined;

    const { error } = await supabase.from("drafts").insert({
      id: draft.id,
      user_id: user.id,
      ...(orgId ? { org_id: orgId } : {}),
      image_url:
        draft.imageUrl ||
        (draft.imageUrls && draft.imageUrls.length > 0
          ? draft.imageUrls[0]
          : ""),
      image_urls:
        draft.imageUrls && draft.imageUrls.length > 0 ? draft.imageUrls : null,
      title: draft.title,
      description: draft.description,
      price_min: draft.priceMin,
      price_max: draft.priceMax,
      listing_price: draft.listingPrice ?? null,
      listing_format: draft.listingFormat ?? "FIXED_PRICE",
      ebay_category_id: draft.ebayCategoryId || null,
      ebay_category_breadcrumb: draft.ebayCategoryBreadcrumb || null,
      item_specifics: draft.coinConditionDetail
        ? {
            ...(draft.itemSpecifics || {}),
            _coinConditionDetail: draft.coinConditionDetail,
          }
        : draft.itemSpecifics || {},
      condition: draft.condition || null,
      consignor: draft.consignor || "",
      fulfillment_policy_id: draft.fulfillmentPolicyId || null,
      payment_policy_id: draft.paymentPolicyId || null,
      return_policy_id: draft.returnPolicyId || null,
      auction_duration: draft.auctionDuration || null,
      publish_status: "draft",
      // Precious metal content
      metal_type: draft.metalType || "none",
      metal_weight_oz: draft.metalWeightOz ?? 0,
      // Multi-quantity
      quantity: draft.quantity ?? 1,
      pricing_mode: draft.pricingMode ?? "per_item",
      // Package dimensions
      package_weight_lb: draft.packageWeightLb ?? null,
      package_weight_oz: draft.packageWeightOz ?? null,
      package_length_in: draft.packageLengthIn ?? null,
      package_width_in: draft.packageWidthIn ?? null,
      package_height_in: draft.packageHeightIn ?? null,
      // Video
      video_url: draft.videoUrl ?? null,
      ebay_video_id: draft.ebayVideoId ?? null,
      ebay_video_status: draft.ebayVideoStatus ?? null,
      // Cost of Goods Sold
      cogs: draft.cogs ?? null,
      cogs_source: draft.cogsSource ?? null,
      cogs_acquired_at: draft.cogsAcquiredAt?.toISOString() ?? null,
      // Item domain (Phase 4 quality-assurance tracking)
      domain: draft.domain ?? null,
    });

    if (error) {
      console.error("Error adding draft:", error);
      toast.error("Failed to save draft");
      return false;
    } else {
      setDrafts((prev) => [{ ...draft, publishStatus: "draft" }, ...prev]);
      return true;
    }
  };

  const removeDraft = async (id: string) => {
    // Best-effort cleanup of this draft's own storage objects before
    // deleting the row -- without this, every deleted draft permanently
    // orphans its images/video, which is how listing-images ended up with
    // 4,716 orphaned objects (RBR-0033). Non-fatal: the row delete below is
    // the primary operation and must still succeed even if this fails.
    const draft = drafts.find((d) => d.id === id);
    if (draft) {
      const paths = [draft.imageUrl, ...(draft.imageUrls ?? []), draft.videoUrl]
        .map((url) => listingImagesPathFromPublicUrl(url))
        .filter((path): path is string => path !== null);

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("listing-images")
          .remove(paths);
        if (storageError) {
          console.warn(
            `removeDraft: failed to delete storage objects for draft ${id}`,
            storageError.message,
          );
        }
      }
    }

    const { error } = await supabase.from("drafts").delete().eq("id", id);

    if (error) {
      console.error("Error deleting draft:", error);
      toast.error("Failed to delete draft");
    } else {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    }
  };

  const updateDraft = async (id: string, updates: Partial<ListingDraft>) => {
    const patch: Record<string, any> = {};
    if (updates.imageUrl !== undefined) patch.image_url = updates.imageUrl;
    if (updates.imageUrls !== undefined) patch.image_urls = updates.imageUrls;
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined)
      patch.description = updates.description;
    if (updates.listingPrice !== undefined)
      patch.listing_price = updates.listingPrice;
    if (updates.listingFormat !== undefined)
      patch.listing_format = updates.listingFormat;
    if (updates.ebayCategoryId !== undefined)
      patch.ebay_category_id = updates.ebayCategoryId || null;
    // Always patch breadcrumb when ebayCategoryId is being updated, even if breadcrumb is
    // undefined (meaning "clear it"). This ensures a stale breadcrumb from the old category
    // is never left in the DB when the user picks a new category ID.
    if (
      updates.ebayCategoryId !== undefined ||
      updates.ebayCategoryBreadcrumb !== undefined
    ) {
      patch.ebay_category_breadcrumb = updates.ebayCategoryBreadcrumb || null;
    }
    if (updates.itemSpecifics !== undefined) {
      // Merge coinConditionDetail into item_specifics if present
      patch.item_specifics =
        updates.coinConditionDetail !== undefined
          ? {
              ...(updates.itemSpecifics || {}),
              _coinConditionDetail: updates.coinConditionDetail,
            }
          : updates.itemSpecifics || {};
    } else if (updates.coinConditionDetail !== undefined) {
      // coinConditionDetail updated without touching other specifics — handled at DB level
      // We don't have the existing specifics here, so just store as a marker for the caller
      // to also pass itemSpecifics. In practice, coinConditionDetail is always set alongside itemSpecifics.
    }
    if (updates.condition !== undefined) patch.condition = updates.condition;
    if (updates.consignor !== undefined) patch.consignor = updates.consignor;
    if (updates.priceMin !== undefined) patch.price_min = updates.priceMin;
    if (updates.priceMax !== undefined) patch.price_max = updates.priceMax;
    if (updates.fulfillmentPolicyId !== undefined)
      patch.fulfillment_policy_id = updates.fulfillmentPolicyId || null;
    if (updates.paymentPolicyId !== undefined)
      patch.payment_policy_id = updates.paymentPolicyId || null;
    if (updates.returnPolicyId !== undefined)
      patch.return_policy_id = updates.returnPolicyId || null;
    if (updates.auctionDuration !== undefined)
      patch.auction_duration = updates.auctionDuration || null;
    // Publish lifecycle fields
    if (updates.publishStatus !== undefined)
      patch.publish_status = updates.publishStatus;
    if (updates.publishedAt !== undefined)
      patch.published_at = updates.publishedAt?.toISOString() || null;
    if (updates.ebaySku !== undefined) patch.ebay_sku = updates.ebaySku || null;
    if (updates.ebayOfferId !== undefined)
      patch.ebay_offer_id = updates.ebayOfferId || null;
    if (updates.ebayListingId !== undefined)
      patch.ebay_listing_id = updates.ebayListingId || null;
    if (updates.lastPublishError !== undefined)
      patch.last_publish_error = updates.lastPublishError || null;
    if (updates.metalType !== undefined) patch.metal_type = updates.metalType;
    if (updates.metalWeightOz !== undefined)
      patch.metal_weight_oz = updates.metalWeightOz;
    // Multi-quantity
    if (updates.quantity !== undefined) patch.quantity = updates.quantity;
    if (updates.pricingMode !== undefined)
      patch.pricing_mode = updates.pricingMode;
    // Package dimensions (allow clearing to 0 by converting 0 to null)
    if (updates.packageWeightLb !== undefined)
      patch.package_weight_lb =
        updates.packageWeightLb > 0 ? updates.packageWeightLb : null;
    if (updates.packageWeightOz !== undefined)
      patch.package_weight_oz =
        updates.packageWeightOz > 0 ? updates.packageWeightOz : null;
    if (updates.packageLengthIn !== undefined)
      patch.package_length_in =
        updates.packageLengthIn > 0 ? updates.packageLengthIn : null;
    if (updates.packageWidthIn !== undefined)
      patch.package_width_in =
        updates.packageWidthIn > 0 ? updates.packageWidthIn : null;
    if (updates.packageHeightIn !== undefined)
      patch.package_height_in =
        updates.packageHeightIn > 0 ? updates.packageHeightIn : null;
    // Video
    if (updates.videoUrl !== undefined)
      patch.video_url = updates.videoUrl ?? null;
    if (updates.ebayVideoId !== undefined)
      patch.ebay_video_id = updates.ebayVideoId ?? null;
    if (updates.ebayVideoStatus !== undefined)
      patch.ebay_video_status = updates.ebayVideoStatus ?? null;
    // Cost of Goods Sold
    if (updates.cogs !== undefined) patch.cogs = updates.cogs ?? null;
    if (updates.cogsSource !== undefined)
      patch.cogs_source = updates.cogsSource ?? null;
    if (updates.cogsAcquiredAt !== undefined)
      patch.cogs_acquired_at = updates.cogsAcquiredAt?.toISOString() ?? null;
    if (updates.domain !== undefined) patch.domain = updates.domain ?? null;

    const { error } = await supabase.from("drafts").update(patch).eq("id", id);

    if (error) {
      console.error("Error updating draft:", error);
      toast.error("Failed to update draft");
      return false;
    } else {
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...updates } : d)),
      );
      return true;
    }
  };

  /**
   * Mark a draft as successfully published and remove it from the active drafts list.
   * Stores the eBay listing metadata for reference.
   * Returns true if successful, false otherwise.
   */
  const markDraftPublished = async (
    id: string,
    meta: { sku: string; offerId: string; listingId: string | null },
  ): Promise<boolean> => {
    const success = await updateDraft(id, {
      publishStatus: "published",
      publishedAt: new Date(),
      ebaySku: meta.sku,
      ebayOfferId: meta.offerId,
      ebayListingId: meta.listingId || undefined,
      lastPublishError: undefined,
    });
    if (success) {
      console.log(
        `markDraftPublished: draft ${id} marked as published in database`,
      );
      // Remove from active drafts list — published items appear in Dashboard
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      return true;
    } else {
      console.error(
        `markDraftPublished: failed to update draft ${id} in database`,
      );
      return false;
    }
  };

  /**
   * Mark a draft as failed with an error message. `meta.sku`/`meta.offerId`,
   * when the failure response included them, are persisted the same way
   * markDraftPublished persists them on success -- ebay-publish's
   * generateDraftSku only reuses a SKU if one is passed back in, so without
   * this, every retry after a partial failure (inventory item created, then
   * offer/publish failed) mints a brand-new SKU and permanently orphans the
   * first inventory item on eBay instead of the existing idempotent-PUT
   * behavior ever engaging.
   */
  const markDraftFailed = async (
    id: string,
    errorMsg: string,
    meta?: { sku?: string; offerId?: string },
  ) => {
    console.error(
      `markDraftFailed: draft ${id} failed with error: ${errorMsg}`,
    );
    await updateDraft(id, {
      publishStatus: "failed",
      lastPublishError: errorMsg,
      ...(meta?.sku ? { ebaySku: meta.sku } : {}),
      ...(meta?.offerId ? { ebayOfferId: meta.offerId } : {}),
    });
  };

  return {
    drafts,
    addDraft,
    removeDraft,
    updateDraft,
    markDraftPublished,
    markDraftFailed,
    loading,
    refetchDrafts: fetchDrafts,
  };
}
