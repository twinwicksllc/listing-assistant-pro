import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaMonitoringCard } from "@/components/admin/QuotaMonitoringCard";
import type { SystemData } from "@/components/admin/types";

// Regression coverage for the 2026-09-21 admin quota-monitoring dashboard
// (PR #611), following the pattern in ebay-quota-poll-card.test.tsx. Covers
// the null state, the dataError state, the exact 4,500 combined-calls warn
// boundary, stale/fresh poll text, and the rejectionRatio denominator fix
// (Copilot review, PR #611): the ratio must be rejectedUsability /
// (accepted + rejectedUsability), not diluted by error/rejectedNoStoredIds.

type QuotaMonitoring = SystemData["quotaMonitoring"];

function makeData(
  overrides: Partial<NonNullable<QuotaMonitoring>> = {},
): NonNullable<QuotaMonitoring> {
  return {
    last7Days: [
      { date: "2026-09-20", browseCalls: 1000, itemBulkCalls: 200 },
      { date: "2026-09-21", browseCalls: 1200, itemBulkCalls: 300 },
    ],
    itemsRefreshOutcomes: {
      accepted: 10,
      rejectedUsability: 2,
      rejectedNoStoredIds: 5,
      error: 1,
    },
    pollFreshness: { polledAt: "2026-09-21T00:31:00.000Z", isStale: false },
    ...overrides,
  };
}

describe("QuotaMonitoringCard", () => {
  it("renders a 'No data yet' state when data is null", () => {
    render(<QuotaMonitoringCard data={null} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("renders a dataError state distinct from the null state", () => {
    render(
      <QuotaMonitoringCard
        data={makeData({ dataError: "call-log count query failed" })}
      />,
    );
    expect(
      screen.getByText(/Data unavailable: call-log count query failed/),
    ).toBeInTheDocument();
  });

  it("does not warn when today's combined calls are below the threshold", () => {
    render(
      <QuotaMonitoringCard
        data={makeData({
          last7Days: [
            { date: "2026-09-21", browseCalls: 1000, itemBulkCalls: 200 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/Today: 1200 combined Browse API calls/),
    ).toBeInTheDocument();
  });

  it("warns at exactly the 4,500 combined-calls threshold", () => {
    render(
      <QuotaMonitoringCard
        data={makeData({
          last7Days: [
            { date: "2026-09-21", browseCalls: 4000, itemBulkCalls: 500 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/Today: 4500 combined Browse API calls/),
    ).toBeInTheDocument();
  });

  it("shows the stale-poll fallback message when pollFreshness.isStale is true", () => {
    render(
      <QuotaMonitoringCard
        data={makeData({
          pollFreshness: { polledAt: null, isStale: true },
        })}
      />,
    );
    expect(screen.getByText(/Poll stale/)).toBeInTheDocument();
  });

  it("shows the fresh-poll message when pollFreshness.isStale is false", () => {
    render(<QuotaMonitoringCard data={makeData()} />);
    expect(screen.getByText(/Poll fresh/)).toBeInTheDocument();
  });

  it("computes the rejection ratio from accepted + rejectedUsability only, not all outcomes", () => {
    // accepted=10, rejectedUsability=2 -> 2/12 = 16.7%. If the denominator
    // wrongly included rejectedNoStoredIds (5) and error (1), it would read
    // 2/18 = 11.1% instead -- this test fails against the old formula.
    render(<QuotaMonitoringCard data={makeData()} />);
    expect(screen.getByText(/16\.7% of attempts rejected/)).toBeInTheDocument();
  });

  it("shows the empty-outcomes state when there are no refresh attempts at all", () => {
    render(
      <QuotaMonitoringCard
        data={makeData({
          itemsRefreshOutcomes: {
            accepted: 0,
            rejectedUsability: 0,
            rejectedNoStoredIds: 0,
            error: 0,
          },
        })}
      />,
    );
    expect(
      screen.getByText("No refresh attempts logged yet"),
    ).toBeInTheDocument();
  });
});
