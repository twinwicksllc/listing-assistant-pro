import { Save, Loader2, Send, Lock } from "lucide-react";

interface ActionButtonsProps {
  onSave: () => void;
  onPublish: () => void;
  publishing: boolean;
  videoIsProcessing: boolean;
  isOwner: boolean;
}

export function ActionButtons({
  onSave,
  onPublish,
  publishing,
  videoIsProcessing,
  isOwner,
}: ActionButtonsProps) {
  return (
    <div className="space-y-2">
      <button
        onClick={onSave}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-success text-success-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
      >
        <Save className="w-4 h-4" />
        Save Draft
      </button>

      {isOwner ? (
        <button
          onClick={onPublish}
          disabled={publishing || videoIsProcessing}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {publishing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Publishing...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Publish Live to eBay
            </>
          )}
        </button>
      ) : (
        <div className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted text-muted-foreground font-semibold text-sm">
          <Lock className="w-4 h-4" />
          Publishing restricted to account owner
        </div>
      )}

      {videoIsProcessing && (
        <p className="text-xs text-center text-amber-600">
          <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
          Video is processing on eBay — save as draft now and publish once it's
          ready.
        </p>
      )}
    </div>
  );
}
