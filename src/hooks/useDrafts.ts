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

  const addDraft = async (draft: ListingDraft) => {
    if (!user) return;

    // Only include org_id if org has fully loaded and has a valid ID
    // Passing a null org_id when org is still loading can cause FK errors
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
      ebay_category_id: draft.ebayCategoryId || null,
      item_specifics: draft.itemSpecifics || {},
      condition: draft.condition || null,
      consignor: draft.consignor || "",
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

  return { drafts, addDraft, removeDraft, loading, refetchDrafts: fetchDrafts };
}
