import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { MarketPriceHistory } from "@/types/market-research";

interface PriceTrendChartProps {
  history: MarketPriceHistory[];
  className?: string;
}

interface ChartPoint {
  date: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d");
  } catch {
    return iso;
  }
}

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function PriceTrendChart({
  history,
  className,
}: PriceTrendChartProps) {
  if (history.length === 0) {
    return (
      <div
        className={`flex items-center justify-center h-40 text-muted-foreground text-sm ${className ?? ""}`}
      >
        No price history yet. Refresh the watch to start tracking.
      </div>
    );
  }

  const data: ChartPoint[] = history.map((h) => ({
    date: formatDate(h.sampledAt),
    avg: h.avgPrice ?? null,
    min: h.minPrice ?? null,
    max: h.maxPrice ?? null,
    median: h.medianPrice ?? null,
  }));

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${v}`}
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value: number) => formatPrice(value)}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          />
          <Legend wrapperStyle={{ fontSize: "11px" }} />
          <Line
            type="monotone"
            dataKey="avg"
            name="Avg"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="median"
            name="Median"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            connectNulls
            strokeDasharray="4 2"
          />
          <Line
            type="monotone"
            dataKey="max"
            name="Max"
            stroke="#f97316"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            strokeDasharray="3 3"
          />
          <Line
            type="monotone"
            dataKey="min"
            name="Min"
            stroke="#94a3b8"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            strokeDasharray="3 3"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
