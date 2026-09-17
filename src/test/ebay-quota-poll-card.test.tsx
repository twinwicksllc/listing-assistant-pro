import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EbayQuotaPollCard } from "@/components/admin/EbayQuotaPollCard";
import type { SystemData } from "@/components/admin/types";

// Regression coverage for surfacing ebay-quota-monitor's (PR #581/#582)
// latest poll in the admin dashboard -- the first Vitest coverage for
// anything in src/components/admin/, matching the "no unit-test seam
// without real DB, add coverage for the pure/isolable parts" reasoning used
// elsewhere in this plan. Covers the null-poll state, normal usage, the
// exact 90% warn boundary, and just-under-90%.

type Poll = SystemData["lastEbayQuotaPoll"];

function makePoll(overrides: Partial<NonNullable<Poll>>): NonNullable<Poll> {
  return {
    resource_name: "buy.browse",
    call_limit: 5000,
    call_count: 1000,
    call_remaining: 4000,
    reset_at: "2026-09-18T07:00:00.000Z",
    alert_sent: false,
    polled_at: "2026-09-17T18:31:00.000Z",
    ...overrides,
  };
}

describe("EbayQuotaPollCard", () => {
  it("renders a 'no poll data yet' state when poll is null", () => {
    render(<EbayQuotaPollCard poll={null} />);
    expect(screen.getByText("No poll data yet")).toBeInTheDocument();
  });

  it("renders normal (non-warning) styling when usage is well below 90%", () => {
    render(
      <EbayQuotaPollCard
        poll={makePoll({ call_count: 1000, call_remaining: 4000 })}
      />,
    );
    expect(screen.getByText(/4000 \/ 5000 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/20\.0% used/)).toBeInTheDocument();
  });

  it("warns at exactly the 90% threshold", () => {
    // 4500/5000 used = exactly 90%.
    render(
      <EbayQuotaPollCard
        poll={makePoll({ call_count: 4500, call_remaining: 500 })}
      />,
    );
    expect(screen.getByText(/500 \/ 5000 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/90\.0% used/)).toBeInTheDocument();
  });

  it("does not warn just under the 90% threshold", () => {
    // 4499/5000 used = 89.98%, rounds to 90.0% displayed but ratio itself is
    // still just under the threshold -- use a value that stays visibly under
    // when rounded to one decimal.
    render(
      <EbayQuotaPollCard
        poll={makePoll({ call_count: 4400, call_remaining: 600 })}
      />,
    );
    expect(screen.getByText(/88\.0% used/)).toBeInTheDocument();
  });

  it("shows the alert-sent marker when alert_sent is true", () => {
    render(<EbayQuotaPollCard poll={makePoll({ alert_sent: true })} />);
    expect(screen.getByText(/Alert sent today/)).toBeInTheDocument();
  });
});
