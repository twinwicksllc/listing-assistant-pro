import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { validateLlmCategoryPicks } from "./index.ts";

function shortlistRow(
  categoryId: string,
  overrides: Partial<{ categoryName: string; breadcrumb: string; similarity: number }> = {},
) {
  return {
    categoryId,
    categoryName: overrides.categoryName ?? `Category ${categoryId}`,
    breadcrumb: overrides.breadcrumb ?? `Domain > Category ${categoryId}`,
    similarity: overrides.similarity ?? 0.9,
  };
}

Deno.test("validateLlmCategoryPicks: a valid subset passes through unchanged", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222"), shortlistRow("333")];
  const picks = [{ categoryId: "222", categoryName: "Category 222" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 1);
  assertEquals(result[0].categoryId, "222");
});

Deno.test("validateLlmCategoryPicks: a hallucinated ID not in the shortlist is dropped", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222")];
  const picks = [{ categoryId: "999", categoryName: "Invented Category" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: all-hallucinated picks yield zero candidates", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222")];
  const picks = [
    { categoryId: "888", categoryName: "Fake A" },
    { categoryId: "999", categoryName: "Fake B" },
  ];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: ordering is preserved as rank 1-3, hallucinations skipped in place", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222"), shortlistRow("333")];
  const picks = [
    { categoryId: "333", categoryName: "Category 333" },
    { categoryId: "999", categoryName: "Invented" }, // dropped, does not shift ranks of survivors
    { categoryId: "111", categoryName: "Category 111" },
  ];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 2);
  assertEquals(result[0].categoryId, "333");
  assertEquals(result[1].categoryId, "111");
});

Deno.test("validateLlmCategoryPicks: empty picks list returns empty", () => {
  const shortlist = [shortlistRow("111")];
  const result = validateLlmCategoryPicks([], shortlist);
  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: empty shortlist drops every pick", () => {
  const picks = [{ categoryId: "111", categoryName: "Category 111" }];
  const result = validateLlmCategoryPicks(picks, []);
  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: returned rows come from the shortlist, not the LLM's own text", () => {
  // The LLM's self-reported categoryName is discarded in favor of the
  // shortlist's real categoryName/breadcrumb/similarity -- this is what
  // "selected only from the supplied list" actually enforces end-to-end.
  const shortlist = [
    shortlistRow("111", { categoryName: "Real Name", breadcrumb: "Real > Breadcrumb", similarity: 0.77 }),
  ];
  const picks = [{ categoryId: "111", categoryName: "LLM's made-up name" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 1);
  assertEquals(result[0].categoryName, "Real Name");
  assertEquals(result[0].breadcrumb, "Real > Breadcrumb");
  assertEquals(result[0].similarity, 0.77);
});
