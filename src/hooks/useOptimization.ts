import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type {
  RepriceRule,
  RepriceRuleInput,
  OptimizationHistoryEntry,
  OptimizeListingResult,
  RepriceRunResponse,
} from "@/types/optimization";

// ----------------------------------------------------------------
// Row shapes from Supabase (snake_case)
// ----------------------------------------------------------------
interface RepriceRuleRow {
  id: string;
  user_id: string;
  rule_name: string;
  rule_type: string;
  adjustment_pct: number;
  floor_price: number | null;
  ceiling_price: number | null;
  category_filter: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface OptHistoryRow {
  id: string;
  user_id: string;
  listing_id: string;
  listing_title: string | null;
  optimization_type: string;
  old_value: string | null;
  new_value: string | null;
  reasoning: string | null;
  applied_at: string;
  applied_by: string;
  result: string;
  created_at: string;
}

// ----------------------------------------------------------------
// Converters
// ----------------------------------------------------------------
function toRule(row: RepriceRuleRow): RepriceRule {
  return {
    id: row.id,
    userId: row.user_id,
    ruleName: row.rule_name,
    ruleType: row.rule_type as RepriceRule["ruleType"],
    adjustmentPct: row.adjustment_pct,
    floorPrice: row.floor_price,
    ceilingPrice: row.ceiling_price,
    categoryFilter: row.category_filter,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistoryEntry(row: OptHistoryRow): OptimizationHistoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    optimizationType: row.optimization_type as OptimizationHistoryEntry["optimizationType"],
    oldValue: row.old_value,
    newValue: row.new_value,
    reasoning: row.reasoning,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by as OptimizationHistoryEntry["appliedBy"],
    result: row.result as OptimizationHistoryEntry["result"],
    createdAt: row.created_at,
  };
}

// ================================================================
// useRepriceRules — CRUD for reprice rules
// ================================================================
export function useRepriceRules() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState<RepriceRule[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("reprice_rules")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRules((data as RepriceRuleRow[] ?? []).map(toRule));
    } catch (err) {
      console.error("[useRepriceRules] fetch error:", err);
      toast({ title: "Failed to load reprice rules", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  const addRule = useCallback(
    async (input: RepriceRuleInput): Promise<RepriceRule | null> => {
      if (!user) return null;
      try {
        const { data, error } = await supabase
          .from("reprice_rules")
          .insert({
            user_id: user.id,
            rule_name: input.ruleName,
            rule_type: input.ruleType,
            adjustment_pct: input.adjustmentPct,
            floor_price: input.floorPrice,
            ceiling_price: input.ceilingPrice,
            category_filter: input.categoryFilter,
            is_enabled: input.isEnabled,
          })
          .select()
          .single();

        if (error) throw error;
        const newRule = toRule(data as RepriceRuleRow);
        setRules((prev) => [newRule, ...prev]);
        toast({ title: "Rule created", description: `"${input.ruleName}" is ready` });
        return newRule;
      } catch (err) {
        console.error("[useRepriceRules] add error:", err);
        toast({ title: "Failed to create rule", variant: "destructive" });
        return null;
      }
    },
    [user, toast]
  );

  const updateRule = useCallback(
    async (ruleId: string, updates: Partial<RepriceRuleInput>): Promise<boolean> => {
      try {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.ruleName !== undefined) dbUpdates.rule_name = updates.ruleName;
        if (updates.ruleType !== undefined) dbUpdates.rule_type = updates.ruleType;
        if (updates.adjustmentPct !== undefined) dbUpdates.adjustment_pct = updates.adjustmentPct;
        if (updates.floorPrice !== undefined) dbUpdates.floor_price = updates.floorPrice;
        if (updates.ceilingPrice !== undefined) dbUpdates.ceiling_price = updates.ceilingPrice;
        if (updates.categoryFilter !== undefined) dbUpdates.category_filter = updates.categoryFilter;
        if (updates.isEnabled !== undefined) dbUpdates.is_enabled = updates.isEnabled;

        const { data, error } = await supabase
          .from("reprice_rules")
          .update(dbUpdates)
          .eq("id", ruleId)
          .select()
          .single();

        if (error) throw error;
        const updated = toRule(data as RepriceRuleRow);
        setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
        toast({ title: "Rule updated" });
        return true;
      } catch (err) {
        console.error("[useRepriceRules] update error:", err);
        toast({ title: "Failed to update rule", variant: "destructive" });
        return false;
      }
    },
    [toast]
  );

  const deleteRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      try {
        const { error } = await supabase.from("reprice_rules").delete().eq("id", ruleId);
        if (error) throw error;
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
        toast({ title: "Rule deleted" });
        return true;
      } catch (err) {
        console.error("[useRepriceRules] delete error:", err);
        toast({ title: "Failed to delete rule", variant: "destructive" });
        return false;
      }
    },
    [toast]
  );

  const toggleRule = useCallback(
    async (ruleId: string, isEnabled: boolean): Promise<boolean> => {
      return updateRule(ruleId, { isEnabled });
    },
    [updateRule]
  );

  return { rules, loading, fetchRules, addRule, updateRule, deleteRule, toggleRule };
}

// ================================================================
// useOptimizeListing — analyze a single listing
// ================================================================
export function useOptimizeListing() {
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingContent, setApplyingContent] = useState(false);
  const { toast } = useToast();

  const analyze = useCallback(
    async (params: {
      listingId: string;
      userId?: string;
      title: string;
      currentPrice: number;
      description?: string;
      categoryId?: string | null;
      listingDate?: string | null;
    }): Promise<OptimizeListingResult | null> => {
      setAnalyzing(true);
      try {
        const { data, error } = await supabase.functions.invoke("optimize-listing", {
          body: params,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data as OptimizeListingResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useOptimizeListing] analyze error:", msg);
        toast({ title: "Analysis failed", description: msg, variant: "destructive" });
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [toast]
  );

  const applyPriceChange = useCallback(
    async (params: {
      offerId: string | null;
      sku: string;
      listingId: string | null;
      newPrice: number;
      listingTitle: string;
      oldPrice: number;
      reasoning: string;
      userId: string;
      userToken?: string | null;
    }): Promise<boolean> => {
      setApplying(true);
      try {
        // Apply price via ebay-reprice
        const { data, error } = await supabase.functions.invoke("ebay-reprice", {
          body: {
            action: "single_update",
            offerId: params.offerId,
            sku: params.sku,
            listingId: params.listingId,
            newPrice: params.newPrice,
            userToken: params.userToken,
            userId: params.userId,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!data?.success) throw new Error("Reprice returned success=false");

        // Log to optimization_history
        await supabase.from("optimization_history").insert({
          user_id: params.userId,
          listing_id: params.listingId ?? params.sku,
          listing_title: params.listingTitle,
          optimization_type: "price",
          old_value: String(params.oldPrice),
          new_value: String(params.newPrice),
          reasoning: params.reasoning,
          applied_by: "user",
          result: "accepted",
        });

        toast({
          title: "Price updated",
          description: `Changed to $${params.newPrice.toFixed(2)}`,
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useOptimizeListing] apply error:", msg);
        toast({ title: "Failed to apply price change", description: msg, variant: "destructive" });
        return false;
      } finally {
        setApplying(false);
      }
    },
    [toast]
  );

  const dismissSuggestion = useCallback(
    async (params: {
      listingId: string;
      listingTitle: string;
      optimizationType: "price" | "title" | "description";
      oldValue: string;
      reasoning: string;
      userId: string;
    }): Promise<void> => {
      await supabase.from("optimization_history").insert({
        user_id: params.userId,
        listing_id: params.listingId,
        listing_title: params.listingTitle,
        optimization_type: params.optimizationType,
        old_value: params.oldValue,
        reasoning: params.reasoning,
        applied_by: "user",
        result: "dismissed",
      });
    },
    []
  );

  const applyContentChange = useCallback(
    async (params: {
      offerId: string | null;
      sku: string;
      listingId: string | null;
      listingTitle: string;
      oldTitle: string;
      newTitle: string;
      oldDescription: string;
      newDescription: string;
      titleReasoning: string;
      descriptionReasoning: string;
      userId: string;
      userToken?: string | null;
    }): Promise<boolean> => {
      setApplyingContent(true);
      try {
        const trimmedTitle = params.newTitle.trim();
        const trimmedDescription = params.newDescription.trim();
        const titleChanged = trimmedTitle !== params.oldTitle.trim();
        const descChanged = trimmedDescription !== params.oldDescription.trim();

        if (!titleChanged && !descChanged) {
          toast({ title: "No content changes to apply" });
          return false;
        }

        const { data, error } = await supabase.functions.invoke("ebay-reprice", {
          body: {
            action: "update_content",
            offerId: params.offerId,
            sku: params.sku,
            listingId: params.listingId,
            userToken: params.userToken,
            userId: params.userId,
            newTitle: titleChanged ? trimmedTitle : undefined,
            newDescription: descChanged ? trimmedDescription : undefined,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!data?.success) throw new Error(data?.error || "Update returned success=false");

        if (titleChanged) {
          await supabase.from("optimization_history").insert({
            user_id: params.userId,
            listing_id: params.listingId ?? params.sku,
            listing_title: params.listingTitle,
            optimization_type: "title",
            old_value: params.oldTitle,
            new_value: trimmedTitle,
            reasoning: params.titleReasoning,
            applied_by: "user",
            result: "accepted",
          });
        }

        if (descChanged) {
          await supabase.from("optimization_history").insert({
            user_id: params.userId,
            listing_id: params.listingId ?? params.sku,
            listing_title: params.listingTitle,
            optimization_type: "description",
            old_value: params.oldDescription,
            new_value: trimmedDescription,
            reasoning: params.descriptionReasoning,
            applied_by: "user",
            result: "accepted",
          });
        }

        toast({ title: "Listing content updated", description: "Title/description changes were sent to eBay." });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useOptimizeListing] applyContentChange error:", msg);
        toast({ title: "Failed to update listing content", description: msg, variant: "destructive" });
        return false;
      } finally {
        setApplyingContent(false);
      }
    },
    [toast],
  );

  return {
    analyze,
    applying,
    applyingContent,
    analyzing,
    applyPriceChange,
    applyContentChange,
    dismissSuggestion,
  };
}

// ================================================================
// useOptimizationHistory — fetch history log
// ================================================================
export function useOptimizationHistory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [history, setHistory] = useState<OptimizationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(
    async (limit = 50) => {
      if (!user) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("optimization_history")
          .select("*")
          .eq("user_id", user.id)
          .order("applied_at", { ascending: false })
          .limit(limit);

        if (error) throw error;
        setHistory((data as OptHistoryRow[] ?? []).map(toHistoryEntry));
      } catch (err) {
        console.error("[useOptimizationHistory] fetch error:", err);
        toast({ title: "Failed to load history", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [user, toast]
  );

  return { history, loading, fetchHistory };
}

// ================================================================
// useAutoReprice — run reprice rules (dry or live)
// ================================================================
export function useAutoReprice() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const runReprice = useCallback(
    async (params: {
      userId: string;
      dryRun?: boolean;
      listingIds?: string[];
    }): Promise<RepriceRunResponse | null> => {
      setRunning(true);
      try {
        const { data, error } = await supabase.functions.invoke("auto-reprice-cron", {
          body: params,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const result = data as RepriceRunResponse;
        toast({
          title: params.dryRun ? "Dry run complete" : "Reprice complete",
          description: `${result.processed} listing(s) ${params.dryRun ? "would be updated" : "updated"}`,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useAutoReprice] error:", msg);
        toast({ title: "Reprice failed", description: msg, variant: "destructive" });
        return null;
      } finally {
        setRunning(false);
      }
    },
    [toast]
  );

  return { runReprice, running };
}