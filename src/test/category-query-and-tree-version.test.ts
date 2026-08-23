/**
 * category-query-and-tree-version.test.ts
 *
 * Covers two follow-ups to the eBay category finder work:
 *
 *  1. categoryQuery — analyze-item now asks the model for a clean "what the
 *     item is" phrase and sends THAT to category-lookup, instead of the
 *     SEO-optimised sales title. eBay's docs warn that getCategorySuggestions
 *     is "partially determined by live inventory data", so keyword-stuffed
 *     marketing titles actively pull in miscategorised listings.
 *
 *     It must degrade safely: when the model omits the field (or returns
 *     something too short to be useful) we fall back to the title, so
 *     behaviour is never worse than before.
 *
 *  2. categoryTreeVersion — the weekly sync now records eBay's tree version
 *     and flags drift, rather than discarding it.
 */

import { describe, expect, it } from "vitest";

// ── 1. categoryQuery selection ────────────────────────────────────────────

/** Mirrors the selection logic in analyze-item/index.ts. */
function resolveLookupQuery(listing: {
  title?: string | null;
  categoryQuery?: unknown;
}): { query: string | null | undefined; usedCategoryQuery: boolean } {
  const categoryQuery =
    typeof listing.categoryQuery === "string" &&
    listing.categoryQuery.trim().length > 2
      ? listing.categoryQuery.trim()
      : null;
  return {
    query: categoryQuery ?? listing.title,
    usedCategoryQuery: categoryQuery !== null,
  };
}

describe("categoryQuery selection", () => {
  it("prefers categoryQuery over the keyword-stuffed sales title", () => {
    const { query, usedCategoryQuery } = resolveLookupQuery({
      title: "RARE!! 1883 Shield Nickel PCGS MS-65 GEM BU L@@K NR",
      categoryQuery: "1883 Shield Nickel five cent coin",
    });
    expect(usedCategoryQuery).toBe(true);
    expect(query).toBe("1883 Shield Nickel five cent coin");
    // The grading/marketing noise must not reach eBay.
    expect(query).not.toMatch(/PCGS|GEM|RARE|L@@K|MS-65/i);
  });

  it("falls back to the title when categoryQuery is absent", () => {
    const { query, usedCategoryQuery } = resolveLookupQuery({
      title: "1921 Morgan Silver Dollar",
    });
    expect(usedCategoryQuery).toBe(false);
    expect(query).toBe("1921 Morgan Silver Dollar");
  });

  it("falls back when categoryQuery is empty, blank, or too short", () => {
    for (const bad of ["", "   ", "ab"]) {
      const { query, usedCategoryQuery } = resolveLookupQuery({
        title: "1921 Morgan Silver Dollar",
        categoryQuery: bad,
      });
      expect(usedCategoryQuery).toBe(false);
      expect(query).toBe("1921 Morgan Silver Dollar");
    }
  });

  it("falls back when categoryQuery is a non-string (model returned junk)", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      const { query, usedCategoryQuery } = resolveLookupQuery({
        title: "1oz Silver Bar",
        categoryQuery: bad,
      });
      expect(usedCategoryQuery).toBe(false);
      expect(query).toBe("1oz Silver Bar");
    }
  });

  it("trims surrounding whitespace", () => {
    const { query } = resolveLookupQuery({
      title: "fallback",
      categoryQuery: "  1oz silver bullion bar  ",
    });
    expect(query).toBe("1oz silver bullion bar");
  });

  it("never returns a query when both title and categoryQuery are missing", () => {
    const { query } = resolveLookupQuery({});
    expect(query).toBeFalsy();
  });
});

describe("categoryQuery must not leak to the client", () => {
  /** Mirrors the scrub in analyze-item/index.ts. */
  function buildResponsePayload(
    listing: Record<string, unknown>,
    tier: "starter" | "pro",
    allowed: Set<string>,
  ): Record<string, unknown> {
    let payload: Record<string, unknown> = { ...listing, meltValue: 1 };
    delete payload.categoryQuery;
    if (tier === "starter") {
      payload = Object.fromEntries(
        Object.entries(payload).filter(([k]) => allowed.has(k)),
      );
    }
    return payload;
  }

  const ALLOWED = new Set(["title", "ebayCategoryId", "coinConditionDetail"]);

  it("is stripped on paid tiers, which spread ...listing wholesale", () => {
    const payload = buildResponsePayload(
      {
        title: "x",
        ebayCategoryId: "11952",
        categoryQuery: "1883 Shield Nickel coin",
      },
      "pro",
      ALLOWED,
    );
    expect(payload).not.toHaveProperty("categoryQuery");
    expect(payload.ebayCategoryId).toBe("11952");
    expect(payload.meltValue).toBe(1); // paid-only field still present
  });

  it("is stripped on the starter tier", () => {
    const payload = buildResponsePayload(
      {
        title: "x",
        ebayCategoryId: "11952",
        categoryQuery: "1883 Shield Nickel coin",
      },
      "starter",
      ALLOWED,
    );
    expect(payload).not.toHaveProperty("categoryQuery");
    expect(payload).not.toHaveProperty("meltValue"); // paid-only field removed
  });
});

// ── 2. categoryTreeVersion drift detection ────────────────────────────────

/** Mirrors the drift logic in sync-ebay-taxonomy/index.ts. */
function evaluateTreeVersion(
  current: string | null,
  previous: string | null,
  upserted: number,
): { changed: boolean; shouldPersist: boolean } {
  const changed = !!current && !!previous && previous !== current;
  return { changed, shouldPersist: !!current && upserted > 0 };
}

describe("categoryTreeVersion drift detection", () => {
  it("flags a restructure when the version changes", () => {
    const { changed, shouldPersist } = evaluateTreeVersion("138", "137", 20000);
    expect(changed).toBe(true);
    expect(shouldPersist).toBe(true);
  });

  it("does not flag drift when the version is unchanged", () => {
    expect(evaluateTreeVersion("137", "137", 20000).changed).toBe(false);
  });

  it("does not flag drift on the first observation", () => {
    // No previous value recorded yet — that is not a restructure.
    const { changed, shouldPersist } = evaluateTreeVersion("137", null, 20000);
    expect(changed).toBe(false);
    expect(shouldPersist).toBe(true);
  });

  it("does NOT persist after a failed sync, so real drift is caught next run", () => {
    // upserted === 0 means nothing was written; persisting the new version
    // here would mask the restructure on the following run.
    const { changed, shouldPersist } = evaluateTreeVersion("138", "137", 0);
    expect(changed).toBe(true);
    expect(shouldPersist).toBe(false);
  });

  it("handles eBay omitting categoryTreeVersion entirely", () => {
    const { changed, shouldPersist } = evaluateTreeVersion(null, "137", 20000);
    expect(changed).toBe(false);
    expect(shouldPersist).toBe(false);
  });
});
