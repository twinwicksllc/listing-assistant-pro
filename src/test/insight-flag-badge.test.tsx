import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightFlagBadge } from "@/components/InsightFlagBadge";
import type { InsightFlag } from "@/lib/listingInsights";

describe("InsightFlagBadge", () => {
  it("renders nothing when there are no flags", () => {
    const { container } = render(<InsightFlagBadge flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a badge with its label and tooltip message for each flag type", () => {
    const flags: InsightFlag[] = [
      {
        type: "overpriced",
        message: "Priced 20% above the competitor average",
      },
      {
        type: "underpriced",
        message: "Priced 20% below the competitor average",
      },
      { type: "stale", message: "Active for 90 days" },
      {
        type: "duplicate",
        message: "Title is very similar to another active listing",
      },
    ];
    render(<InsightFlagBadge flags={flags} />);

    for (const flag of flags) {
      expect(screen.getByText(flag.type)).toBeInTheDocument();
      expect(screen.getByTitle(flag.message)).toBeInTheDocument();
    }
  });

  it("renders one badge per flag, in the order given", () => {
    const flags: InsightFlag[] = [
      { type: "stale", message: "Active for 90 days" },
      {
        type: "duplicate",
        message: "Title is very similar to another active listing",
      },
    ];
    render(<InsightFlagBadge flags={flags} />);

    const badges = screen.getAllByTitle(/.+/);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("stale");
    expect(badges[1]).toHaveTextContent("duplicate");
  });
});
