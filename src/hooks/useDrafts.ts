import { useState, useEffect } from "react";
import { ListingDraft } from "@/types/listing";

const STORAGE_KEY = "ebay-listing-drafts";

export function useDrafts() {
  const [drafts, setDrafts] = useState<ListingDraft[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored).map((d: any) => ({ ...d, createdAt: new Date(d.createdAt) }));
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  }, [drafts]);

  const addDraft = (draft: ListingDraft) => setDrafts((prev) => [draft, ...prev]);
  const removeDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  return { drafts, addDraft, removeDraft };
}
