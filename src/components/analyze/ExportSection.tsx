import { Download, FileSpreadsheet, Sheet } from "lucide-react";

type ExportPlatform = "ebay_file_exchange" | "facebook_marketplace";
type ExportFormat = "csv" | "excel" | "google_sheets";

interface ExportSectionProps {
  exportPlatform: ExportPlatform;
  onSetExportPlatform: (platform: ExportPlatform) => void;
  exportFormat: ExportFormat;
  onSetExportFormat: (format: ExportFormat) => void;
  downloadLabel: string;
  onExport: () => void;
}

export function ExportSection({
  exportPlatform,
  onSetExportPlatform,
  exportFormat,
  onSetExportFormat,
  downloadLabel,
  onExport,
}: ExportSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Download className="w-3.5 h-3.5 text-primary" />
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Export Listing
        </label>
      </div>

      {/* Platform toggle */}
      <div className="flex gap-2">
        {(
          [
            ["ebay_file_exchange", "eBay File Exchange"],
            ["facebook_marketplace", "Facebook Marketplace"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onSetExportPlatform(key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
              exportPlatform === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Format toggle */}
      <div className="flex gap-2">
        {(
          [
            ["csv", "CSV", Download],
            ["excel", "Excel (.xlsx)", FileSpreadsheet],
            ["google_sheets", "Google Sheets", Sheet],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => onSetExportFormat(key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
              exportFormat === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/40"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      <button
        onClick={onExport}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm transition-all hover:bg-secondary/80 active:scale-[0.98]"
      >
        <Download className="w-4 h-4" />
        Download {downloadLabel}
      </button>
    </div>
  );
}
