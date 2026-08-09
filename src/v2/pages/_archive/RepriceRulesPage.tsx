import { useState, useEffect } from "react";
import {
  Zap,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Play,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useRepriceRules,
  useAutoReprice,
  useOptimizationHistory,
} from "@/hooks/useOptimization";
import BottomNav from "@/components/BottomNav";
import type {
  RepriceRuleInput,
  RepriceRuleType,
  RepriceRunResult,
} from "@/types/optimization";
import { RULE_TYPE_LABELS, RULE_TYPE_DESCRIPTIONS } from "@/types/optimization";

const RULE_TYPES: RepriceRuleType[] = [
  "match_sold_avg",
  "match_avg",
  "match_lowest",
  "beat_lowest",
];

// ----------------------------------------------------------------
// Add/Edit Rule Dialog
// ----------------------------------------------------------------
function RuleDialog({
  open,
  onClose,
  onSave,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: RepriceRuleInput) => void;
  initial?: Partial<RepriceRuleInput>;
}) {
  const [ruleName, setRuleName] = useState(initial?.ruleName ?? "");
  const [ruleType, setRuleType] = useState<RepriceRuleType>(
    initial?.ruleType ?? "match_sold_avg",
  );
  const [adjustmentPct, setAdjustmentPct] = useState(
    String(initial?.adjustmentPct ?? 0),
  );
  const [floorPrice, setFloorPrice] = useState(
    initial?.floorPrice ? String(initial.floorPrice) : "",
  );
  const [ceilingPrice, setCeilingPrice] = useState(
    initial?.ceilingPrice ? String(initial.ceilingPrice) : "",
  );
  const [isEnabled, setIsEnabled] = useState(initial?.isEnabled ?? true);

  const isValid = ruleName.trim().length > 0 && ruleType;

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      ruleName: ruleName.trim(),
      ruleType,
      adjustmentPct: parseFloat(adjustmentPct) || 0,
      floorPrice: floorPrice ? parseFloat(floorPrice) : null,
      ceilingPrice: ceilingPrice ? parseFloat(ceilingPrice) : null,
      categoryFilter: null,
      isEnabled,
    });
  };

  const showAdjustment = ruleType === "beat_lowest";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            {initial?.ruleName ? "Edit Rule" : "New Reprice Rule"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Rule Name */}
          <div className="space-y-1.5">
            <Label htmlFor="ruleName">Rule Name</Label>
            <Input
              id="ruleName"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g. Match sold avg for all listings"
            />
          </div>

          {/* Rule Type */}
          <div className="space-y-1.5">
            <Label>Pricing Strategy</Label>
            <Select
              value={ruleType}
              onValueChange={(v) => setRuleType(v as RepriceRuleType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {RULE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {RULE_TYPE_DESCRIPTIONS[ruleType]}
            </p>
          </div>

          {/* Adjustment % (for beat_lowest) */}
          {showAdjustment && (
            <div className="space-y-1.5">
              <Label htmlFor="adjPct">Adjustment % (negative = below)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="adjPct"
                  type="number"
                  value={adjustmentPct}
                  onChange={(e) => setAdjustmentPct(e.target.value)}
                  placeholder="-5"
                  step="0.5"
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">
                  % {parseFloat(adjustmentPct) < 0 ? "below" : "above"} target
                </span>
              </div>
            </div>
          )}

          {/* Floor / Ceiling */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="floor">Floor Price ($)</Label>
              <Input
                id="floor"
                type="number"
                value={floorPrice}
                onChange={(e) => setFloorPrice(e.target.value)}
                placeholder="e.g. 5.00"
                step="0.01"
              />
              <p className="text-xs text-muted-foreground">Never go below</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ceiling">Ceiling Price ($)</Label>
              <Input
                id="ceiling"
                type="number"
                value={ceilingPrice}
                onChange={(e) => setCeilingPrice(e.target.value)}
                placeholder="e.g. 500.00"
                step="0.01"
              />
              <p className="text-xs text-muted-foreground">Never go above</p>
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enable Rule</p>
              <p className="text-xs text-muted-foreground">
                Rule will apply during reprice runs
              </p>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {initial?.ruleName ? "Save Changes" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------
// Dry Run Results Dialog
// ----------------------------------------------------------------
function DryRunDialog({
  open,
  onClose,
  onApply,
  results,
  applying,
}: {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  results: RepriceRunResult[];
  applying: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-amber-500" />
            Dry Run Results
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {results.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No listings would be updated. Rules may not match any listings, or
              prices are already at target.
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-lg border text-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Rule: {r.ruleApplied}
                  </p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-muted-foreground line-through text-xs">
                    ${r.oldPrice.toFixed(2)}
                  </p>
                  <p
                    className={`font-semibold ${r.newPrice < r.oldPrice ? "text-red-600" : "text-emerald-600"}`}
                  >
                    ${r.newPrice.toFixed(2)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {results.length > 0 && (
          <div className="pt-3 border-t">
            <p className="text-xs text-muted-foreground mb-3">
              {results.length} listing{results.length > 1 ? "s" : ""} will be
              updated. Review changes above then apply.
            </p>
            <div className="flex gap-2">
              <Button onClick={onApply} disabled={applying} className="flex-1">
                {applying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" /> Apply {results.length}{" "}
                    Change{results.length > 1 ? "s" : ""}
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={applying}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {results.length === 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------
// Main Page
// ----------------------------------------------------------------
export default function RepriceRulesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    rules,
    loading,
    fetchRules,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
  } = useRepriceRules();
  const { runReprice, running } = useAutoReprice();
  const {
    history,
    loading: histLoading,
    fetchHistory,
  } = useOptimizationHistory();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [dryRunDialogOpen, setDryRunDialogOpen] = useState(false);
  const [dryRunResults, setDryRunResults] = useState<RepriceRunResult[]>([]);
  const [applyingLive, setApplyingLive] = useState(false);
  const [tab, setTab] = useState<"rules" | "history">("rules");
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  useEffect(() => {
    fetchRules();
    fetchHistory(30);
  }, [fetchRules, fetchHistory]);

  const handleAddRule = async (input: RepriceRuleInput) => {
    await addRule(input);
    setAddDialogOpen(false);
  };

  const handleDryRun = async () => {
    if (!user) return;
    const result = await runReprice({ userId: user.id, dryRun: true });
    if (result) {
      setDryRunResults(result.results);
      setDryRunDialogOpen(true);
    }
  };

  const handleApplyLive = async () => {
    if (!user) return;
    setApplyingLive(true);
    await runReprice({ userId: user.id, dryRun: false });
    setApplyingLive(false);
    setDryRunDialogOpen(false);
    fetchHistory(30);
  };

  const enabledCount = rules.filter((r) => r.isEnabled).length;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/dashboard")}
            className="h-9 w-9"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            <h1 className="font-bold text-base">Auto-Reprice Rules</h1>
            <p className="text-xs text-muted-foreground">
              {enabledCount} active rule{enabledCount !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Add Rule
          </Button>
        </div>

        {/* Tabs */}
        <div className="max-w-2xl mx-auto px-4 pb-0 flex gap-1">
          {(["rules", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "history" ? "History" : "Rules"}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* ---- Rules Tab ---- */}
        {tab === "rules" && (
          <>
            {/* Run buttons */}
            {rules.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleDryRun}
                  disabled={running || enabledCount === 0}
                  className="flex-1"
                >
                  {running ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FlaskConical className="w-4 h-4 mr-2" />
                  )}
                  Dry Run
                </Button>
                <Button
                  onClick={handleApplyLive}
                  disabled={running || enabledCount === 0}
                  className="flex-1"
                >
                  {running ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Run Now
                </Button>
              </div>
            )}

            {/* Info banner */}
            {enabledCount > 0 && (
              <div className="flex gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                  {enabledCount} rule{enabledCount > 1 ? "s are" : " is"}{" "}
                  active. Use <strong>Dry Run</strong> to preview changes before
                  applying.
                </p>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Empty state */}
            {!loading && rules.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Settings2 className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">No rules yet</h3>
                <p className="text-sm text-muted-foreground max-w-xs mb-4">
                  Create repricing rules to automatically adjust your listing
                  prices based on market data.
                </p>
                <Button onClick={() => setAddDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Create First Rule
                </Button>
              </div>
            )}

            {/* Rules list */}
            {!loading &&
              rules.map((rule) => {
                const expanded = expandedRuleId === rule.id;
                return (
                  <div
                    key={rule.id}
                    className={`rounded-xl border bg-card transition-all ${!rule.isEnabled ? "opacity-60" : ""}`}
                  >
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() =>
                        setExpandedRuleId(expanded ? null : rule.id)
                      }
                    >
                      {/* Toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRule(rule.id, !rule.isEnabled);
                        }}
                        className="flex-shrink-0"
                      >
                        {rule.isEnabled ? (
                          <ToggleRight className="w-6 h-6 text-primary" />
                        ) : (
                          <ToggleLeft className="w-6 h-6 text-muted-foreground" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">
                            {rule.ruleName}
                          </p>
                          {!rule.isEnabled && (
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground"
                            >
                              Disabled
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {RULE_TYPE_LABELS[rule.ruleType]}
                        </p>
                      </div>

                      {expanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div className="px-4 pb-4 space-y-3 border-t pt-3">
                        <p className="text-xs text-muted-foreground">
                          {RULE_TYPE_DESCRIPTIONS[rule.ruleType]}
                        </p>

                        <div className="grid grid-cols-3 gap-2 text-sm">
                          {rule.adjustmentPct !== 0 && (
                            <div className="rounded-lg bg-muted/50 p-2 text-center">
                              <p className="text-xs text-muted-foreground">
                                Adjustment
                              </p>
                              <p className="font-medium">
                                {rule.adjustmentPct > 0 ? "+" : ""}
                                {rule.adjustmentPct}%
                              </p>
                            </div>
                          )}
                          {rule.floorPrice && (
                            <div className="rounded-lg bg-muted/50 p-2 text-center">
                              <p className="text-xs text-muted-foreground">
                                Floor
                              </p>
                              <p className="font-medium">
                                ${rule.floorPrice.toFixed(2)}
                              </p>
                            </div>
                          )}
                          {rule.ceilingPrice && (
                            <div className="rounded-lg bg-muted/50 p-2 text-center">
                              <p className="text-xs text-muted-foreground">
                                Ceiling
                              </p>
                              <p className="font-medium">
                                ${rule.ceilingPrice.toFixed(2)}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => deleteRule(rule.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </>
        )}

        {/* ---- History Tab ---- */}
        {tab === "history" && (
          <>
            {histLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!histLoading && history.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Zap className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No history yet</h3>
                <p className="text-sm text-muted-foreground">
                  Optimization actions will appear here.
                </p>
              </div>
            )}

            {!histLoading &&
              history.map((entry) => {
                const typeColors: Record<string, string> = {
                  price: "bg-blue-100 text-blue-700",
                  title: "bg-purple-100 text-purple-700",
                  description: "bg-teal-100 text-teal-700",
                  reprice_rule: "bg-amber-100 text-amber-700",
                };
                const resultColors: Record<string, string> = {
                  accepted: "text-emerald-600",
                  dismissed: "text-muted-foreground",
                  pending: "text-amber-600",
                };

                return (
                  <div key={entry.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[entry.optimizationType] ?? "bg-gray-100"}`}
                          >
                            {entry.optimizationType.replace("_", " ")}
                          </span>
                          <span
                            className={`text-xs font-medium ${resultColors[entry.result] ?? ""}`}
                          >
                            {entry.result}
                          </span>
                          {entry.appliedBy === "auto" && (
                            <Badge variant="outline" className="text-xs">
                              auto
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium truncate">
                          {entry.listingTitle ?? entry.listingId}
                        </p>
                        {entry.oldValue && entry.newValue && (
                          <p className="text-xs text-muted-foreground">
                            {entry.oldValue} → {entry.newValue}
                          </p>
                        )}
                        {entry.reasoning && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {entry.reasoning}
                          </p>
                        )}
                      </div>
                      <time className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {new Date(entry.appliedAt).toLocaleDateString()}
                      </time>
                    </div>
                  </div>
                );
              })}
          </>
        )}
      </div>

      {/* Dialogs */}
      <RuleDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSave={handleAddRule}
      />

      <DryRunDialog
        open={dryRunDialogOpen}
        onClose={() => setDryRunDialogOpen(false)}
        onApply={handleApplyLive}
        results={dryRunResults}
        applying={applyingLive}
      />

      <BottomNav />
    </div>
  );
}
