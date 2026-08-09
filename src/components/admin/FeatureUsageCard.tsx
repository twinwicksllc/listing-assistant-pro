import type { SystemData } from "./types";

interface FeatureUsageCardProps {
  featureUsage: SystemData["featureUsage"];
}

export function FeatureUsageCard({ featureUsage }: FeatureUsageCardProps) {
  const items = [
    { label: "Analyze (AI)", count: featureUsage.ai_analysis, icon: "🔍" },
    { label: "Optimize", count: featureUsage.optimize, icon: "✨" },
    { label: "Publish", count: featureUsage.ebay_publish, icon: "📤" },
    { label: "Export", count: featureUsage.export, icon: "💾" },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Feature Usage (30 Days)
        </h2>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.label}
            className="px-4 py-3 flex items-center justify-between"
          >
            <span className="text-sm text-foreground flex items-center gap-2">
              <span>{item.icon}</span>
              {item.label}
            </span>
            <span className="text-sm font-bold text-foreground">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
