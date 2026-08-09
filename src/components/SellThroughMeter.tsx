import { cn } from "@/lib/utils";

interface SellThroughMeterProps {
  rate: number; // 0–100
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

function getColor(rate: number): string {
  if (rate >= 60) return "text-green-500";
  if (rate >= 30) return "text-yellow-500";
  return "text-red-400";
}

function getLabel(rate: number): string {
  if (rate >= 60) return "High Demand";
  if (rate >= 30) return "Moderate";
  return "Low Demand";
}

export default function SellThroughMeter({
  rate,
  size = "md",
  showLabel = true,
  className,
}: SellThroughMeterProps) {
  const clampedRate = Math.max(0, Math.min(100, rate));
  const colorClass = getColor(clampedRate);
  const label = getLabel(clampedRate);

  // SVG circle parameters
  const sizeMap = { sm: 48, md: 64, lg: 80 };
  const px = sizeMap[size];
  const strokeWidth = size === "sm" ? 5 : 6;
  const radius = (px - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clampedRate / 100) * circumference;

  const textSizeMap = { sm: "text-xs", md: "text-sm", lg: "text-base" };
  const labelSizeMap = { sm: "text-[9px]", md: "text-[10px]", lg: "text-xs" };

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: px, height: px }}>
        <svg width={px} height={px} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />
          {/* Progress arc */}
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className={cn("transition-all duration-700", colorClass)}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <span
            className={cn(
              "font-bold leading-none",
              textSizeMap[size],
              colorClass,
            )}
          >
            {clampedRate.toFixed(0)}%
          </span>
          <span
            className={cn(
              "text-muted-foreground leading-none mt-0.5",
              labelSizeMap[size],
            )}
          >
            STR
          </span>
        </div>
      </div>
      {showLabel && (
        <span className={cn("font-medium", labelSizeMap[size], colorClass)}>
          {label}
        </span>
      )}
    </div>
  );
}
