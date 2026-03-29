import { useState } from "react";
import { Zap, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RepriceRulesModal } from "./RepriceRulesModal";

interface RepriceManagerPanelProps {
  userId: string;
}

export function RepriceManagerPanel({ userId }: RepriceManagerPanelProps) {
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [ruleCount, setRuleCount] = useState(0);

  // Load rule count
  const loadRuleCount = async () => {
    const { data } = await supabase
      .from("reprice_rules")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("is_enabled", true);
    setRuleCount(data?.length || 0);
  };

  const handleManualRun = async () => {
    if (!ruleCount) {
      toast.info("Enable at least one rule to run");
      return;
    }

    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-reprice-trigger", {
        body: { userId, dryRun: false },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
      } else if (data?.updated) {
        toast.success(`Updated ${data.updated} listings`);
      } else {
        toast.success("Reprice run triggered");
      }
    } catch (e) {
      toast.error(`Failed to trigger run: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Auto-Reprice Manager
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {ruleCount} active rule{ruleCount !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => {
            setShowRulesModal(true);
            loadRuleCount();
          }}
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Manage Rules
        </button>
      </div>

      <button
        onClick={handleManualRun}
        disabled={running || ruleCount === 0}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-amber-500/10 text-amber-700 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-amber-500/30"
      >
        <RotateCw className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
        {running ? "Running reprice..." : "Run Reprice Now"}
      </button>

      <div className="text-xs text-muted-foreground bg-secondary/50 rounded p-3">
        <p className="font-medium mb-1">Auto-reprice runs daily at 2 AM. Use "Run Now" to trigger immediately.</p>
      </div>

      {showRulesModal && (
        <RepriceRulesModal
          userId={userId}
          onClose={() => setShowRulesModal(false)}
          onSaved={() => loadRuleCount()}
        />
      )}
    </div>
  );
}
