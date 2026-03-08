import { Trash2, FileText } from "lucide-react";
import { useDrafts } from "@/hooks/useDrafts";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";

export default function DraftsPage() {
  const { drafts, removeDraft } = useDrafts();

  const handleDelete = (id: string) => {
    removeDraft(id);
    toast.success("Draft deleted");
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-lg font-bold text-foreground">Saved Drafts</h1>
        <p className="text-xs text-muted-foreground">{drafts.length} listing{drafts.length !== 1 ? "s" : ""}</p>
      </header>

      <div className="px-4 space-y-3 max-w-lg mx-auto">
        {drafts.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mx-auto">
              <FileText className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">No drafts yet. Capture an item to get started!</p>
          </div>
        )}

        {drafts.map((draft) => (
          <div key={draft.id} className="bg-card border border-border rounded-xl p-3 flex gap-3">
            <img
              src={draft.imageUrl}
              alt={draft.title}
              className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{draft.title}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ${draft.priceMin.toFixed(2)} – ${draft.priceMax.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">
                {draft.createdAt.toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => handleDelete(draft.id)}
              className="self-start p-1.5 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
