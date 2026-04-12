import { CheckCircle, XCircle, Loader2, ExternalLink, Download } from "lucide-react";
import type { BulkPublishResult } from "@/types/bulk-listing";

interface BulkProgressBarProps {
  total: number;
  published: number;
  failed: number;
  inProgress: boolean;
  results: BulkPublishResult[];
  onDownloadErrors?: () => void;
}

export default function BulkProgressBar({
  total,
  published,
  failed,
  inProgress,
  results,
  onDownloadErrors,
}: BulkProgressBarProps) {
  const completed = published + failed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const remaining = total - completed;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">
            {inProgress ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                Publishing... ({completed}/{total})
              </span>
            ) : completed === total && total > 0 ? (
              "Publishing complete"
            ) : (
              `${completed} of ${total} processed`
            )}
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background:
                failed > 0 && published === 0
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--primary))",
            }}
          />
        </div>

        {/* Stats row */}
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
            <CheckCircle className="w-3 h-3" />
            {published} published
          </span>
          {failed > 0 && (
            <span className="flex items-center gap-1 text-destructive font-medium">
              <XCircle className="w-3 h-3" />
              {failed} failed
            </span>
          )}
          {inProgress && remaining > 0 && (
            <span className="text-muted-foreground">{remaining} remaining</span>
          )}
        </div>
      </div>

      {/* Per-row results list */}
      {results.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto rounded-xl border border-border">
          {results.map((r) => (
            <div
              key={r.rowIndex}
              className={`flex items-center gap-2.5 px-3 py-2 text-xs border-b border-border/50 last:border-0 ${
                r.success
                  ? "bg-green-50/30 dark:bg-green-950/10"
                  : "bg-red-50/30 dark:bg-red-950/10"
              }`}
            >
              {r.success ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
              )}
              <span className="text-muted-foreground min-w-[40px]">Row {r.rowIndex + 1}</span>
              {r.success ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-green-700 dark:text-green-300 font-medium truncate">
                    {r.listingId ? `Listing #${r.listingId}` : `Offer #${r.offerId}`}
                  </span>
                  {r.ebayUrl && (
                    <a
                      href={r.ebayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex-shrink-0 text-primary hover:underline flex items-center gap-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View
                    </a>
                  )}
                </div>
              ) : (
                <span className="text-destructive truncate flex-1">{r.error ?? "Unknown error"}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final summary + error download */}
      {!inProgress && completed === total && total > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            {failed === 0 ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : published === 0 ? (
              <XCircle className="w-5 h-5 text-destructive" />
            ) : (
              <CheckCircle className="w-5 h-5 text-yellow-500" />
            )}
            <p className="text-sm font-semibold text-foreground">
              {failed === 0
                ? `All ${published} listings published successfully! 🎉`
                : published === 0
                ? `All ${failed} listings failed to publish`
                : `${published} published · ${failed} failed`}
            </p>
          </div>

          {failed > 0 && onDownloadErrors && (
            <button
              onClick={onDownloadErrors}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download Error Report ({failed} rows)
            </button>
          )}
        </div>
      )}
    </div>
  );
}