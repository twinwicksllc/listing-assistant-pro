import { useState } from "react";
import { TrendingUp, DollarSign, Loader2, X, ChevronDown } from "lucide-react";
import PriceRecommenderCard from "@/components/PriceRecommenderCard";

interface DraftPriceAdvisorProps {
  title: string;
  condition?: string;
  currentPrice?: number;
  priceMin?: number;
  priceMax?: number;
  metalType?: string;
  metalWeightOz?: number;
  meltValue?: number | null;
  onApplyPrice?: (price: number) => void;
}

export default function DraftPriceAdvisor({
  title,
  condition,
  currentPrice,
  priceMin,
  priceMax,
  metalType,
  metalWeightOz,
  meltValue,
  onApplyPrice,
}: DraftPriceAdvisorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-medium hover:bg-primary/15 transition-colors"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        Price Advisor
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Inline panel */}
      {open && (
        <div className="mt-2">
          <PriceRecommenderCard
            title={title}
            condition={condition}
            priceMin={priceMin}
            priceMax={priceMax}
            metalType={metalType}
            metalWeightOz={metalWeightOz}
            meltValue={meltValue}
            onApplyPrice={onApplyPrice}
            compact={false}
          />
        </div>
      )}
    </div>
  );
}