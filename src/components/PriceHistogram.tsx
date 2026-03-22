interface HistogramBucket {
  bucket: string;
  count: number;
  min: number;
  max: number;
}

interface PriceHistogramProps {
  histogram: HistogramBucket[];
  selectedPrice?: number;
}

export default function PriceHistogram({ histogram, selectedPrice }: PriceHistogramProps) {
  if (!histogram || histogram.length === 0) return null;

  const maxCount = Math.max(...histogram.map((b) => b.count), 1);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        Price Distribution
      </p>
      <div className="flex items-end gap-1 h-12">
        {histogram.map((bucket, i) => {
          const heightPct = Math.max(10, (bucket.count / maxCount) * 100);
          // Highlight the bucket containing the selected price
          const isSelected =
            selectedPrice !== undefined &&
            selectedPrice >= bucket.min &&
            selectedPrice <= bucket.max;

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-sm transition-all ${
                  isSelected
                    ? "bg-primary"
                    : bucket.count > 0
                    ? "bg-primary/30"
                    : "bg-muted"
                }`}
                style={{ height: `${heightPct}%` }}
                title={`${bucket.bucket}: ${bucket.count} listing${bucket.count !== 1 ? "s" : ""}`}
              />
              <span className="text-[9px] text-muted-foreground leading-none truncate w-full text-center">
                {bucket.count}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>${histogram[0]?.min.toFixed(0)}</span>
        <span>${histogram[histogram.length - 1]?.max.toFixed(0)}</span>
      </div>
    </div>
  );
}