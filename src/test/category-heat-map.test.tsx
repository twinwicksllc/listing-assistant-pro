import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryHeatMap } from "@/v2/components/CategoryHeatMap";
import { categoryTileLabel } from "@/lib/ebayCategoryMap";

// Regression coverage for the Dashboard category heat map (added in PR #613).
// It originally read `ebay_category_id` -- the drafts-table column -- while
// the dashboard passes eBay listings, which carry `categoryId`. Every listing
// therefore landed in one "unknown" tile. Tiles are grouped by `categoryId`
// and labeled with the category's leaf name.

const listing = (categoryId?: string) => ({ categoryId, title: "t" });

describe("CategoryHeatMap", () => {
  it("renders the empty state when there are no listings", () => {
    render(<CategoryHeatMap listings={[]} />);
    expect(screen.getByText(/No listings yet/)).toBeInTheDocument();
  });

  it("groups listings by categoryId, busiest category first", () => {
    render(
      <CategoryHeatMap
        listings={[
          listing("39489"),
          listing("39489"),
          listing("39489"),
          listing("159713"),
        ]}
      />,
    );
    const tiles = screen.getAllByTitle(/active listing/);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveTextContent("3");
    expect(tiles[1]).toHaveTextContent("1");
  });

  it("puts listings with no categoryId in a single Uncategorized tile", () => {
    render(<CategoryHeatMap listings={[listing(), listing(undefined)]} />);
    expect(
      screen.getByTitle("Uncategorized: 2 active listings"),
    ).toBeInTheDocument();
  });

  it("caps the number of tiles at maxTiles", () => {
    const many = Array.from({ length: 5 }, (_, i) => listing(String(1000 + i)));
    render(<CategoryHeatMap listings={many} maxTiles={3} />);
    expect(screen.getAllByTitle(/active listing/)).toHaveLength(3);
  });
});

describe("categoryTileLabel", () => {
  it("uses the leaf of a mapped category's breadcrumb", () => {
    expect(categoryTileLabel("39489")).toBe("Bars & Rounds");
  });

  it("falls back to 'Category #<id>' for an unmapped id", () => {
    expect(categoryTileLabel("999999999")).toBe("Category #999999999");
  });

  it("labels the uncategorized bucket", () => {
    expect(categoryTileLabel("unknown")).toBe("Uncategorized");
  });
});
