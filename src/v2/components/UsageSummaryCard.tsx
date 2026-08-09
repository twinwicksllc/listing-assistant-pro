import React from "react";

interface UsageMetric {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}

interface UsageSummaryCardProps {
  metrics: UsageMetric[];
  planName?: string;
}

const UsageSummaryCard: React.FC<UsageSummaryCardProps> = ({
  metrics,
  planName,
}) => {
  const getUsageState = (used: number, limit: number): string => {
    const percentage = (used / limit) * 100;
    if (percentage >= 90) return "v2-usage-card--danger";
    if (percentage >= 70) return "v2-usage-card--warning";
    return "";
  };

  const getUsagePercentage = (used: number, limit: number): number => {
    return Math.min((used / limit) * 100, 100);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map((metric, index) => (
        <div
          key={index}
          className={`v2-usage-card ${getUsageState(metric.used, metric.limit)}`}
        >
          <div className="v2-usage-card-title">{metric.label}</div>
          <div className="v2-usage-card-value">
            {metric.used.toLocaleString()}
            {metric.unit && (
              <span className="text-base font-normal ml-1">{metric.unit}</span>
            )}
          </div>
          <div className="v2-usage-card-limit">
            of {metric.limit.toLocaleString()}
            {metric.unit && ` ${metric.unit}`} {planName && `(${planName})`}
          </div>
          <div className="v2-usage-bar">
            <div
              className="v2-usage-bar-fill"
              style={{
                width: `${getUsagePercentage(metric.used, metric.limit)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default UsageSummaryCard;
