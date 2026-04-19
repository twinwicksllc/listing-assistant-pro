import { useCallback } from "react";
import { toast } from "sonner";
import { uploadListingImages } from "@/lib/imageUpload";

interface UseAnalyzeSaveParams {
  userId: string | null | undefined;
  imageUrls: string[];
  addDraft: (draft: any) => Promise<boolean>;
  buildDraftPayload: (uploadedUrls: string[]) => any;
  onSaved: () => void;
}

export function useAnalyzeSave({
  userId,
  imageUrls,
  addDraft,
  buildDraftPayload,
  onSaved,
}: UseAnalyzeSaveParams) {
  const handleSave = useCallback(async () => {
    let uploadedUrls = imageUrls;
    if (userId) {
      uploadedUrls = await uploadListingImages(imageUrls, userId);
    }

    const success = await addDraft(buildDraftPayload(uploadedUrls));
    if (success) {
      toast.success("Draft saved!");
      onSaved();
    }
  }, [addDraft, buildDraftPayload, imageUrls, onSaved, userId]);

  return {
    handleSave,
  };
}
