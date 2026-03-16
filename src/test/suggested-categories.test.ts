import { describe, it, expect } from "vitest";
import buildSuggestedCategories from "../../supabase/functions/_helpers/suggestedCategories";

// Mock svc that simulates Supabase client .from(...).select(...).eq(...).single()
function makeSvcWithMappings(mappings: Record<string, string>) {
  return {
    from: (table: string) => {
      return {
        select: (_cols: string) => ({
          eq: (col: string, value: string) => ({
            single: async () => {
              // only support lookup by ebay_category_id
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
});
