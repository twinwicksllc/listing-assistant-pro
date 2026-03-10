import { useState, useEffect, useCallback } from "react";
import { ListingDraft } from "@/types/listing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
          title: d.title,
          description: d.description,
          priceMin: Number(d.price_min),
          priceMax: Number(d.price_max),
          listingPrice: d.listing_price != null ? Number(d.listing_price) : undefined,
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
        }))
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const addDraft = async (draft: ListingDraft) => {
    if (!user) return;

    const orgId = (!org.loading && org.orgId) ? org.orgId : undefined;

    const { error } = await supabase.from("drafts").insert({
      id: draft.id,
      user_id: user.id,
      ...(orgId ? { org_id: orgId } : {}),
      image_url: draft.imageUrl,
      title: draft.title,
      description: draft.description,
      price_min: draft.priceMin,
      price_max: draft.priceMax,
      listing_price: draft.listingPrice ?? null,
      listing_format: draft.listingFormat ?? "FIXED_PRICE",
      ebay_category_id: draft.ebayCategoryId || null,
      ebay_category_breadcrumb: draft.ebayCategoryBreadcrumb || null,
      item_specifics: draft.itemSpecifics || {},
      condition: draft.condition || null,
      consignor: draft.consignor || "",
      fulfillment_policy_id: draft.fulfillmentPolicyId || null,
      payment_policy_id: draft.paymentPolicyId || null,
      return_policy_id: draft.returnPolicyId || null,
      auction_duration: draft.auctionDuration || null,
    });

    if (error) {
      console.error("Error adding draft:", error);
      toast.error("Failed to save draft");
    } else {
      setDrafts((prev) => [draft, ...prev]);
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

  const updateDraft = async (id: string, updates: Partial<ListingDraft>) => {
    const patch: Record<string, any> = {};
    if (updates.title !== undefined)                  patch.title = updates.title;
    if (updates.description !== undefined)            patch.description = updates.description;
    if (updates.listingPrice !== undefined)           patch.listing_price = updates.listingPrice;
    if (updates.listingFormat !== undefined)          patch.listing_format = updates.listingFormat;
    if (updates.ebayCategoryId !== undefined)         patch.ebay_category_id = updates.ebayCategoryId;
    if (updates.ebayCategoryBreadcrumb !== undefined) patch.ebay_category_breadcrumb = updates.ebayCategoryBreadcrumb;
    if (updates.itemSpecifics !== undefined)          patch.item_specifics = updates.itemSpecifics;
    if (updates.condition !== undefined)              patch.condition = updates.condition;
    if (updates.consignor !== undefined)              patch.consignor = updates.consignor;
    if (updates.priceMin !== undefined)               patch.price_min = updates.priceMin;
    if (updates.priceMax !== undefined)               patch.price_max = updates.priceMax;
    if (updates.fulfillmentPolicyId !== undefined)    patch.fulfillment_policy_id = updates.fulfillmentPolicyId || null;
    if (updates.paymentPolicyId !== undefined)        patch.payment_policy_id = updates.paymentPolicyId || null;
    if (updates.returnPolicyId !== undefined)         patch.return_policy_id = updates.returnPolicyId || null;
    if (updates.auctionDuration !== undefined)        patch.auction_duration = updates.auctionDuration || null;

    const { error } = await supabase.from("drafts").update(patch).eq("id", id);

    if (error) {
      console.error("Error updating draft:", error);
      toast.error("Failed to update draft");
      return false;
    } else {
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...updates } : d))
      );
      return true;
    }
  };

  return { drafts, addDraft, removeDraft, updateDraft, loading, refetchDrafts: fetchDrafts };
}
