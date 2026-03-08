import { TrendingUp, DollarSign } from "lucide-react";

interface PricingCardProps {
  priceMin: number;
  priceMax: number;
}

export default function PricingCard({ priceMin, priceMax }: PricingCardProps) {
  const avg = ((priceMin + priceMax) / 2).toFixed(2);
  const soldItems = [
    { price: priceMin + Math.random() * (priceMax - priceMin), daysAgo: 1 },
    { price: priceMin + Math.random() * (priceMax - priceMin), daysAgo: 3 },
    { price: priceMin + Math.random() * (priceMax - priceMin), daysAgo: 5 },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-success" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-foreground">Pricing Research</h3>
          <p className="text-xs text-muted-foreground">Based on recently sold items</p>
        </div>
      </div>

      <div className="flex items-center justify-between bg-secondary rounded-lg p-3">
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">Low</p>
          <p className="text-lg font-bold text-foreground">${priceMin.toFixed(2)}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">Average</p>
          <p className="text-lg font-bold text-primary">${avg}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">High</p>
          <p className="text-lg font-bold text-foreground">${priceMax.toFixed(2)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recently Sold</p>
        {soldItems.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
            <div className="flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-success" />
              <span className="text-sm font-medium text-foreground">${item.price.toFixed(2)}</span>
            </div>
            <span className="text-xs text-muted-foreground">{item.daysAgo}d ago</span>
          </div>
        ))}
      </div>
    </div>
  );
}
