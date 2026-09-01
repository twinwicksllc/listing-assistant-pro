import { describe, it, expect } from "vitest";
import buildSuggestedCategories from "../../supabase/functions/_helpers/suggestedCategories";

// Mock svc that simulates Supabase client .from(...).select(...).eq(...).maybeSingle()
function makeSvcWithMappings(mappings: Record<string, string>) {
  return {
    from: (table: string) => {
      return {
        select: (_cols: string) => ({
          eq: (col: string, value: string) => ({
            maybeSingle: async () => {
              // only support lookup by ebay_category_id
              if (col === "ebay_category_id") {
                const name = mappings[value];
                if (name) return { data: { category_name: name } };
                return { data: null };
              }
              return { data: null };
            },
            single: async () => {
              // Fallback for single() if needed
              if (col === "ebay_category_id") {
                const name = mappings[value];
                if (name) return { data: { category_name: name } };
                return { data: null };
              }
              return { data: null };
            },
          }),
        }),
      };
    },
  };
}

describe("buildSuggestedCategories helper", () => {
  it("dedupes AI suggestions and preserves primary", async () => {
    const listing: any = {
      ebayCategoryId: "123",
      suggestedCategories: [
        { categoryId: "123", categoryName: null, reason: "AI" },
        { categoryId: "123", categoryName: "Some Cat", reason: "AI" },
        { categoryId: "456", categoryName: "Other Cat", reason: "AI" },
      ],
    };

    const svc = makeSvcWithMappings({ "123": "Verified Cat" });
    const out = await buildSuggestedCategories(listing, svc as any);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].categoryId).toBe("123");
    expect(out[0].categoryName).toBe("Verified Cat");
    // ensure no duplicates
    const ids = out.map((s: any) => s.categoryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("limits to 3 suggestions and keeps AI order", async () => {
    const listing: any = {
      ebayCategoryId: null,
      suggestedCategories: [
        { categoryId: "a", categoryName: "A" },
        { categoryId: "b", categoryName: "B" },
        { categoryId: "c", categoryName: "C" },
        { categoryId: "d", categoryName: "D" },
      ],
    };
    const svc = makeSvcWithMappings({});
    const out = await buildSuggestedCategories(listing, svc as any);
    expect(out.length).toBe(3);
    expect(out[0].categoryId).toBe("a");
    expect(out[1].categoryId).toBe("b");
    expect(out[2].categoryId).toBe("c");
  });

  it("returns empty array when no suggestions", async () => {
    const listing: any = { ebayCategoryId: null, suggestedCategories: [] };
    const svc = makeSvcWithMappings({});
    const out = await buildSuggestedCategories(listing, svc as any);
    expect(out).toEqual([]);
  });

  // Regression guard for the 2026-09-01 DB-persistence follow-up fix.
  // fromLegacyBootstrap distinguishes a fresh, higher-confidence Tier-1/2/3
  // breadcrumb from a Tier-4 _LEGACY_BOOTSTRAP_BREADCRUMBS emergency-fallback
  // guess, so analyze-item's auto-persist can skip writing the latter into
  // category_mappings (itself Tier 2 of this same lookup order) and never
  // let a possibly-wrong emergency value become self-perpetuating.
  it("marks a category_mappings-resolved (Tier 2) suggestion as NOT from the legacy bootstrap", async () => {
    const listing: any = { ebayCategoryId: "123", suggestedCategories: [] };
    const svc = makeSvcWithMappings({ "123": "Verified Cat" });
    const out = await buildSuggestedCategories(listing, svc as any);
    expect(out[0].categoryId).toBe("123");
    expect(out[0].fromLegacyBootstrap).toBe(false);
  });

  it("marks a legacy-bootstrap-resolved (Tier 4) suggestion as fromLegacyBootstrap", async () => {
    // "532" has no category_mappings entry in this mock (tier 1/2 miss), and
    // the live eBay API is unreachable in the vitest/Node environment
    // (tier 3 miss — see suggestedCategories.ts's getEbayAppToken), so this
    // falls all the way through to _LEGACY_BOOTSTRAP_BREADCRUMBS's own "532"
    // entry (tier 4) — confirmed still present in that map.
    const listing: any = { ebayCategoryId: "532", suggestedCategories: [] };
    const svc = makeSvcWithMappings({});
    const out = await buildSuggestedCategories(listing, svc as any);
    expect(out[0].categoryId).toBe("532");
    expect(out[0].breadcrumb).toBe("Coins & Paper Money > Coins: Ancient");
    expect(out[0].fromLegacyBootstrap).toBe(true);
  });
});
