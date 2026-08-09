import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { MarketWatch, MarketPriceHistory } from "@/types/market-research";

// ----------------------------------------------------------------
// Row shape coming from Supabase (snake_case)
// ----------------------------------------------------------------
interface WatchRow {
  id: string;
  user_id: string;
  org_id?: string | null;
  search_query: string;
  category_id?: string | null;
  label?: string | null;
  last_checked_at?: string | null;
  avg_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  median_price?: number | null;
  active_count: number;
  sold_count: number;
  sell_through_rate?: number | null;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  watch_id: string;
  sampled_at: string;
  avg_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  median_price?: number | null;
  active_count: number;
  sold_count: number;
  sell_through_rate?: number | null;
}

function toWatch(row: WatchRow): MarketWatch {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    searchQuery: row.search_query,
    categoryId: row.category_id,
    label: row.label,
    lastCheckedAt: row.last_checked_at,
    avgPrice: row.avg_price,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    medianPrice: row.median_price,
    activeCount: row.active_count ?? 0,
    soldCount: row.sold_count ?? 0,
    sellThroughRate: row.sell_through_rate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistory(row: HistoryRow): MarketPriceHistory {
  return {
    id: row.id,
    watchId: row.watch_id,
    sampledAt: row.sampled_at,
    avgPrice: row.avg_price,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    medianPrice: row.median_price,
    activeCount: row.active_count ?? 0,
    soldCount: row.sold_count ?? 0,
    sellThroughRate: row.sell_through_rate,
  };
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------
export function useMarketWatches() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [watches, setWatches] = useState<MarketWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const fetchWatches = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("market_watches")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWatches(((data as WatchRow[]) ?? []).map(toWatch));
    } catch (err) {
      console.error("[useMarketWatches] fetch error:", err);
      toast({ title: "Failed to load market watches", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchWatches();
  }, [fetchWatches]);

  const addWatch = useCallback(
    async (params: {
      searchQuery: string;
      label?: string;
      categoryId?: string;
    }) => {
      if (!user) return null;
      try {
        const { data, error } = await supabase
          .from("market_watches")
          .insert({
            user_id: user.id,
            search_query: params.searchQuery,
            label: params.label || params.searchQuery,
            category_id: params.categoryId ?? null,
            active_count: 0,
            sold_count: 0,
          })
          .select()
          .single();

        if (error) throw error;
        const newWatch = toWatch(data as WatchRow);
        setWatches((prev) => [newWatch, ...prev]);
        toast({
          title: "Watch added",
          description: `Tracking "${params.label || params.searchQuery}"`,
        });
        return newWatch;
      } catch (err) {
        console.error("[useMarketWatches] add error:", err);
        toast({ title: "Failed to add watch", variant: "destructive" });
        return null;
      }
    },
    [user, toast],
  );

  const deleteWatch = useCallback(
    async (watchId: string) => {
      try {
        const { error } = await supabase
          .from("market_watches")
          .delete()
          .eq("id", watchId);

        if (error) throw error;
        setWatches((prev) => prev.filter((w) => w.id !== watchId));
        toast({ title: "Watch removed" });
      } catch (err) {
        console.error("[useMarketWatches] delete error:", err);
        toast({ title: "Failed to remove watch", variant: "destructive" });
      }
    },
    [toast],
  );

  const refreshWatch = useCallback(
    async (watchId: string) => {
      if (!user) return;
      setRefreshingId(watchId);
      try {
        const { data, error } = await supabase.functions.invoke(
          "market-watch-refresh",
          {
            body: { watchId, userId: user.id },
          },
        );

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        // Update local state with fresh data
        setWatches((prev) =>
          prev.map((w) =>
            w.id === watchId
              ? {
                  ...w,
                  lastCheckedAt: data.lastCheckedAt,
                  avgPrice: data.avgPrice,
                  minPrice: data.minPrice,
                  maxPrice: data.maxPrice,
                  medianPrice: data.medianPrice,
                  activeCount: data.activeCount ?? 0,
                  soldCount: data.soldCount ?? 0,
                  sellThroughRate: data.sellThroughRate,
                }
              : w,
          ),
        );

        toast({
          title: "Watch refreshed",
          description: `avg $${data.avgPrice?.toFixed(2) ?? "—"}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useMarketWatches] refresh error:", msg);
        toast({
          title: "Refresh failed",
          description: msg,
          variant: "destructive",
        });
      } finally {
        setRefreshingId(null);
      }
    },
    [user, toast],
  );

  const fetchHistory = useCallback(
    async (watchId: string, limit = 30): Promise<MarketPriceHistory[]> => {
      try {
        const { data, error } = await supabase
          .from("market_price_history")
          .select("*")
          .eq("watch_id", watchId)
          .order("sampled_at", { ascending: true })
          .limit(limit);

        if (error) throw error;
        return ((data as HistoryRow[]) ?? []).map(toHistory);
      } catch (err) {
        console.error("[useMarketWatches] history fetch error:", err);
        return [];
      }
    },
    [],
  );

  return {
    watches,
    loading,
    refreshingId,
    addWatch,
    deleteWatch,
    refreshWatch,
    fetchHistory,
    refetch: fetchWatches,
  };
}
