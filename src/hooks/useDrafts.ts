import { useState, useEffect, useCallback } from "react";
import { ListingDraft } from "@/types/listing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { uploadListingImage } from "@/lib/imageUpload";

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
          title: d.title,
          description: d.description,
          priceMin: Number(d.price_min),
          priceMax: Number(d.price_max),
          createdAt: new Date(d.created_at),
          ebayCategoryId: d.ebay_category_id || undefined,
          itemSpecifics: d.item_specifics || undefined,
          condition: d.condition || undefined,
          consignor: d.consignor || "",
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

      // Upload image to Supabase Storage if it's a base64 data URL
      // This avoids hitting Supabase's 1MB REST API request size limit
      let imageUrl = draft.imageUrl;
      if (draft.imageUrl?.startsWith("data:")) {
        imageUrl = await uploadListingImage(draft.imageUrl, user.id);
      }

      const { error } = await supabase.from("drafts").insert({
        id: draft.id,
        user_id: user.id,
        ...(orgId ? { org_id: orgId } : {}),
        image_url: imageUrl,
        title: draft.title,
        description: draft.description,
        price_min: Number(draft.priceMin) || 0,
        price_max: Number(draft.priceMax) || 0,
        ebay_category_id: draft.ebayCategoryId || null,
        item_specifics: draft.itemSpecifics || {},
        condition: draft.condition || null,
        consignor: draft.consignor || "",
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
      setDrafts((prev) => [{ ...draft, imageUrl }, ...prev]);
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

  return { drafts, addDraft, removeDraft, loading, refetchDrafts: fetchDrafts };
}
