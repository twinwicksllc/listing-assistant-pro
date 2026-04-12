import { Download } from "lucide-react";
import type { BulkTemplate } from "@/types/bulk-listing";
import { downloadTemplateCsv } from "@/lib/bulkTemplates";

interface BulkTemplateCardProps {
  template: BulkTemplate;
  onSelect: (template: BulkTemplate) => void;
  disabled?: boolean;
}

export default function BulkTemplateCard({
  template,
  onSelect,
  disabled = false,
}: BulkTemplateCardProps) {
  return (
    <div className="flex flex-col gap-2 p-3 bg-card border border-border rounded-xl hover:border-primary/40 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-2xl flex-shrink-0">{template.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">{template.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{template.description}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-1">
        <button
          onClick={() => !disabled && onSelect(template)}
          disabled={disabled}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          Use Template
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            downloadTemplateCsv(template.id);
          }}
          disabled={disabled}
          title="Download CSV template"
          className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}