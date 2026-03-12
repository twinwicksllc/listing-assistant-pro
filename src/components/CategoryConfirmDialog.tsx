import { useState, useEffect } from "react";
import { X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { EBAY_CATEGORY_BREADCRUMBS } from "@/lib/ebayCategoryMap";

interface CategoryConfirmDialogProps {
  open: boolean;
  categoryId: string;
  onConfirm: (categoryId: string) => void;
  onCancel: () => void;
}

/**
 * Dialog to confirm custom eBay category entry
 * Shows the category name/breadcrumb and asks user to confirm
 */
export default function CategoryConfirmDialog({
  open,
  categoryId,
  onConfirm,
  onCancel,
}: CategoryConfirmDialogProps) {
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);

  // Look up category when dialog opens
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    // Simulate brief lookup delay for UX polish
    const timer = setTimeout(() => {
      const breadcrumb = EBAY_CATEGORY_BREADCRUMBS[categoryId];
      if (breadcrumb) {
        setCategoryName(breadcrumb);
        setIsValid(true);
      } else {
        setCategoryName(null);
        setIsValid(false);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [open, categoryId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-lg max-w-md w-full space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-bold text-foreground">Confirm eBay Category</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : isValid ? (
            <>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category ID</p>
                  <p className="text-sm font-bold text-foreground">{categoryId}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category Name</p>
                  <p className="text-sm text-foreground">{categoryName}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3 py-2">
                This category exists in eBay's taxonomy and will be used for your listing.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-destructive uppercase tracking-wide">Category Not Found</p>
                  <p className="text-sm text-destructive/90">
                    Category ID <strong>{categoryId}</strong> is not recognized by eBay's taxonomy.
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-destructive/30 pl-3 py-2">
                This may cause issues when publishing. Please check the ID and try again.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium text-foreground bg-secondary hover:bg-secondary/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(categoryId)}
            disabled={!isValid}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
