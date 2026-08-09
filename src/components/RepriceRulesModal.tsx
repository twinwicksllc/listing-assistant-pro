import { useState } from "react";
import { X, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface RepriceRule {
  id?: string;
  rule_name: string;
  rule_type: "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";
  adjustment_pct: number;
  floor_price: number | null;
  ceiling_price: number | null;
  category_filter: string | null;
  is_enabled: boolean;
}

interface RepriceRulesModalProps {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function RepriceRulesModal({
  userId,
  onClose,
  onSaved,
}: RepriceRulesModalProps) {
  const [rules, setRules] = useState<(RepriceRule & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RepriceRule>({
    rule_name: "",
    rule_type: "match_lowest",
    adjustment_pct: 0,
    floor_price: null,
    ceiling_price: null,
    category_filter: null,
    is_enabled: true,
  });

  // Load existing rules
  const loadRules = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("reprice_rules")
        .select("*")
        .eq("user_id", userId);
      if (error) throw error;
      setRules(data || []);
    } catch (e) {
      toast.error(`Failed to load rules: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Save or update rule
  const handleSaveRule = async () => {
    if (!form.rule_name.trim()) {
      toast.error("Rule name is required");
      return;
    }

    try {
      if (editingId) {
        // Update
        const { error } = await supabase
          .from("reprice_rules")
          .update(form)
          .eq("id", editingId)
          .eq("user_id", userId);
        if (error) throw error;
        toast.success("Rule updated");
      } else {
        // Insert
        const { error } = await supabase.from("reprice_rules").insert({
          ...form,
          user_id: userId,
        });
        if (error) throw error;
        toast.success("Rule created");
      }
      setShowForm(false);
      setEditingId(null);
      setForm({
        rule_name: "",
        rule_type: "match_lowest",
        adjustment_pct: 0,
        floor_price: null,
        ceiling_price: null,
        category_filter: null,
        is_enabled: true,
      });
      await loadRules();
      onSaved();
    } catch (e) {
      toast.error(`Save failed: ${e.message}`);
    }
  };

  // Delete rule
  const handleDeleteRule = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    try {
      const { error } = await supabase
        .from("reprice_rules")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
      toast.success("Rule deleted");
      await loadRules();
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`);
    }
  };

  // Toggle rule enabled
  const handleToggleRule = async (id: string, isEnabled: boolean) => {
    try {
      const { error } = await supabase
        .from("reprice_rules")
        .update({ is_enabled: !isEnabled })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
      await loadRules();
    } catch (e) {
      toast.error(`Failed to update rule: ${e.message}`);
    }
  };

  // Start editing a rule
  const handleEditRule = (rule: RepriceRule & { id: string }) => {
    setForm({ ...rule });
    setEditingId(rule.id);
    setShowForm(true);
  };

  if (!loading && rules.length === 0 && !showForm) {
    // Initial load
    loadRules();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Auto-Reprice Rules
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading rules...
            </div>
          ) : showForm ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  Rule Name *
                </label>
                <input
                  type="text"
                  value={form.rule_name}
                  onChange={(e) =>
                    setForm({ ...form, rule_name: e.target.value })
                  }
                  placeholder="e.g., Beat Competition by 5%"
                  className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Strategy *
                  </label>
                  <select
                    value={form.rule_type}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rule_type: e.target.value as RepriceRule["rule_type"],
                      })
                    }
                    className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="match_lowest">Match Lowest Price</option>
                    <option value="beat_lowest">Beat Lowest by %</option>
                    <option value="match_avg">Match Market Average</option>
                    <option value="match_sold_avg">Match Sold Average</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    Adjustment %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.adjustment_pct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        adjustment_pct: parseFloat(e.target.value),
                      })
                    }
                    placeholder="e.g., -5 for 5% below"
                    className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    Floor Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.floor_price ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        floor_price: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    placeholder="Min price allowed"
                    className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">
                    Ceiling Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.ceiling_price ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ceiling_price: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    placeholder="Max price allowed"
                    className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  Category Filter (Optional)
                </label>
                <input
                  type="text"
                  value={form.category_filter ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category_filter: e.target.value || null,
                    })
                  }
                  placeholder="e.g., coins,bullion (comma-separated)"
                  className="w-full mt-1 text-sm border border-border rounded px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="bg-secondary/50 border border-border rounded p-3 text-xs text-muted-foreground">
                <p className="font-medium mb-1">How it works:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    <strong>Match Lowest:</strong> Price set to lowest
                    competitor price
                  </li>
                  <li>
                    <strong>Beat Lowest:</strong> Price is adjustment% below
                    lowest
                  </li>
                  <li>
                    <strong>Match Avg:</strong> Price set to market average
                  </li>
                  <li>
                    <strong>Match Sold Avg:</strong> Price set to average of
                    recently sold items
                  </li>
                  <li>
                    <strong>Floor/Ceiling:</strong> Calculated price is clamped
                    between these bounds
                  </li>
                </ul>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveRule}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  {editingId ? "Update Rule" : "Create Rule"}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setForm({
                      rule_name: "",
                      rule_type: "match_lowest",
                      adjustment_pct: 0,
                      floor_price: null,
                      ceiling_price: null,
                      category_filter: null,
                      is_enabled: true,
                    });
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-secondary text-foreground rounded hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="mb-4">No reprice rules yet</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Create First Rule
                  </button>
                </div>
              ) : (
                <>
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-3 p-3 border border-border rounded-lg bg-secondary/20 hover:bg-secondary/30 transition-colors"
                    >
                      <button
                        onClick={() =>
                          handleToggleRule(rule.id, rule.is_enabled)
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {rule.is_enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>

                      <div className="flex-1">
                        <p className="font-medium text-sm text-foreground">
                          {rule.rule_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {rule.rule_type === "match_lowest" &&
                            "Match lowest price"}
                          {rule.rule_type === "beat_lowest" &&
                            `Beat lowest by ${rule.adjustment_pct}%`}
                          {rule.rule_type === "match_avg" &&
                            "Match market average"}
                          {rule.rule_type === "match_sold_avg" &&
                            "Match sold average"}
                          {rule.floor_price && ` • Floor: $${rule.floor_price}`}
                          {rule.ceiling_price &&
                            ` • Ceiling: $${rule.ceiling_price}`}
                        </p>
                      </div>

                      <button
                        onClick={() => handleEditRule(rule)}
                        className="px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => setShowForm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-secondary text-foreground rounded hover:bg-secondary/80 transition-colors mt-4"
                  >
                    <Plus className="w-4 h-4" />
                    Add New Rule
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
