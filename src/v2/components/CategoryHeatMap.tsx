/**
 * CategoryHeatMap — grid of category tiles showing activity level
 *
 * Displays a grid of categories with color-coded heat (green = many active listings,
 * yellow = medium, red = few or none). Used on Dashboard to give a quick market
 * overview across the categories the user works in.
 */

import { useMemo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface CategoryTile {
  categoryId: string;
  categoryName: string;
  activeCount: number;
  trend?: "up" | "down" | "stable";
}

interface CategoryHeatMapProps {
  listings?: Array<{ ebay_category_id?: string; title?: string }>;
  maxTiles?: number;
}

export function CategoryHeatMap({
  listings = [],
  maxTiles = 12,
}: CategoryHeatMapProps) {
  const categoryStats = useMemo(() => {
    if (!listings || listings.length === 0) return [];

    // Count listings per category
    const categoryMap = new Map<string, number>();
    listings.forEach((listing) => {
      const catId = listing.ebay_category_id || "unknown";
      categoryMap.set(catId, (categoryMap.get(catId) || 0) + 1);
    });

    // Convert to sortable array
    return Array.from(categoryMap.entries())
      .map(([categoryId, count]) => ({
        categoryId,
        categoryName: categoryId || "Uncategorized",
        activeCount: count,
      }))
      .sort((a, b) => b.activeCount - a.activeCount)
      .slice(0, maxTiles);
  }, [listings, maxTiles]);

  const getHeatColor = (count: number) => {
    if (count >= 10) return "bg-gradient-to-br from-emerald-500 to-emerald-600";
    if (count >= 5) return "bg-gradient-to-br from-amber-500 to-amber-600";
    return "bg-gradient-to-br from-rose-500 to-rose-600";
  };

  const getTextColor = (count: number) => {
    if (count >= 10) return "text-emerald-950";
    if (count >= 5) return "text-amber-950";
    return "text-rose-950";
  };

  if (categoryStats.length === 0) {
    return (
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Category Activity
        </h3>
        <div className="text-center py-8 text-slate-500 text-sm">
          No listings yet. Create your first listing to see category heatmap.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 rounded-lg border border-slate-200 p-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">
        Category Activity Heatmap
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {categoryStats.map((cat) => (
          <div
            key={cat.categoryId}
            className={`${getHeatColor(cat.activeCount)} ${getTextColor(cat.activeCount)} rounded-md p-3 text-center transition-all hover:shadow-md cursor-default`}
            title={`${cat.categoryName}: ${cat.activeCount} active listing${cat.activeCount !== 1 ? "s" : ""}`}
          >
            <div className="text-lg font-bold mb-1">{cat.activeCount}</div>
            <div className="text-xs font-medium truncate">
              {cat.categoryName.length > 12
                ? cat.categoryName.substring(0, 10) + "…"
                : cat.categoryName}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
