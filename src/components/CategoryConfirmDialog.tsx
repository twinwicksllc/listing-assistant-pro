import { useState, useEffect } from "react";
import { X, AlertCircle, CheckCircle2, Loader2, HelpCircle } from "lucide-react";
import { EBAY_CATEGORY_BREADCRUMBS } from "@/lib/ebayCategoryMap";

interface CategoryConfirmDialogProps {
  open: boolean;
  categoryId: string;
  onConfirm: (categoryId: string) => void;
  onCancel: () => void;
  suggestedCategories?: Array<{ categoryId: string; categoryName: string; reason: string }>;
}

type LookupState = "known" | "unknown" | "empty";
type RemoteState = "unknown" | "valid" | "invalid" | "checking";

/**
 * Dialog to confirm custom eBay category entry.
 *
 * Three states:
 *  - known:   ID is in our local breadcrumb map → show full name + green check
 *  - unknown: ID is NOT in our map but is non-empty → show advisory warning,
 *             still allow Confirm (eBay has 20,000+ categories; our map is a subset)
 *  - empty:   No ID entered → Confirm disabled
 */
export default function CategoryConfirmDialog({
  open,
  categoryId,
  onConfirm,
  onCancel,
  suggestedCategories = [],
}: CategoryConfirmDialogProps) {
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>("empty");
  const [remoteState, setRemoteState] = useState<RemoteState | null>(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    // Brief delay for UX polish
      const timer = setTimeout(() => {
      if (!categoryId.trim()) {
        setLookupState("empty");
        setCategoryName(null);
        setRemoteState(null);
      } else {
        const breadcrumb = EBAY_CATEGORY_BREADCRUMBS[categoryId];
        if (breadcrumb) {
          setCategoryName(breadcrumb);
          setLookupState("known");
          setRemoteState("valid");
        } else {
          // Not in our local map — perform remote verification via function
          setCategoryName(null);
          setLookupState("unknown");
          setRemoteState("checking");

          (async () => {
            try {
              const resp = await fetch("/api/functions/v1/category-lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "verify", categoryId }),
              });
              const json = await resp.json();
              if (json.valid === true) {
                setCategoryName(json.categoryName || null);
                setRemoteState("valid");
              } else if (json.valid === false) {
                setRemoteState("invalid");
              } else {
                setRemoteState("unknown");
              }
            } catch (e) {
              console.warn("Category verify request failed", e);
              setRemoteState("unknown");
            }
          })();
        }
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [open, categoryId]);

  if (!open) return null;

  // Confirm allowed when:
  // - Known (in our local map)
  // - Remote check passed as valid
  // - Unknown but remote check failed/timed out (user can still use if they verified it)
  // Disallow only when: empty OR (unknown AND explicitly invalid on eBay)
  const canConfirm = lookupState !== "empty" && !(lookupState === "unknown" && remoteState === "invalid");

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
          ) : lookupState === "known" ? (
            <>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category ID</p>
                  <p className="text-sm font-bold text-foreground">{categoryId}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category Name</p>
                  <p className="text-sm text-foreground">{categoryName}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3 py-2">
                This category is recognized and will be used for your listing.
              </p>
            </>
          ) : lookupState === "unknown" ? (
            <>
              <div className="flex items-start gap-3">
                <HelpCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">Category ID</p>
                  <p className="text-sm font-bold text-foreground">{categoryId}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">Not in local category list</p>
                  <p className="text-sm text-foreground/80">
                    This ID isn't in our built-in category list, but eBay has thousands of
                    categories we don't map locally. If you verified this ID on eBay, it
                    will work fine — you can still confirm below.
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-amber-500/30 pl-3 py-2">
                {remoteState === "checking" ? (
                  "Checking category on eBay..."
                ) : remoteState === "valid" ? (
                  "Category verified on eBay."
                ) : remoteState === "invalid" ? (
                  "This category ID does not appear to exist on eBay. Please verify the number and try again."
                ) : (
                  <>Tip: verify at{' '}
                    <a
                      href={`https://www.ebay.com/b/bn_${categoryId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      ebay.com/b/bn_{categoryId}
                    </a>
                  </>
                )}
              </p>

              {/* Show AI-suggested categories as alternatives */}
              {suggestedCategories && suggestedCategories.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-amber-500/20">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">AI-Recommended Categories</p>
                  <div className="space-y-1.5">
                    {suggestedCategories.map((cat) => (
                      <button
                        key={cat.categoryId}
                        onClick={() => onConfirm(cat.categoryId)}
                        className="w-full text-left p-2 text-xs rounded-lg hover:bg-primary/10 border border-transparent hover:border-primary/30 transition-colors cursor-pointer"
                      >
                        <p className="font-semibold text-foreground">#{cat.categoryId}</p>
                        <p className="text-muted-foreground text-[11px]">{cat.categoryName}</p>
                        <p className="text-[10px] text-primary/70 italic">{cat.reason}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">Please enter a category ID.</p>
            </div>
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
            disabled={!canConfirm}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {lookupState === "unknown" ? "Use Anyway" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}