export async function buildSuggestedCategories(listing: any, svc: any) {
  const normalizeId = (id: any) => (id ? String(id).trim() : "");
  const seen = new Set<string>();
  const finalSuggestions: any[] = [];

  // Start with AI-provided primary category (ebayCategoryId)
  if (listing.ebayCategoryId) {
    const cid = normalizeId(listing.ebayCategoryId);
    seen.add(cid);
    finalSuggestions.push({ categoryId: cid, categoryName: null, reason: "Primary category from AI" });
  }

  // Add AI-provided alternative categories (from Gemini's alternativeCategoryIds)
  if (Array.isArray(listing.alternativeCategoryIds)) {
    for (const altId of listing.alternativeCategoryIds) {
      const cid = normalizeId(altId);
      if (!cid) continue;
      if (!seen.has(cid)) {
        seen.add(cid);
        finalSuggestions.push({ categoryId: cid, categoryName: null, reason: "Alternative from AI" });
      }
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Add any existing suggestions (legacy support)
  if (Array.isArray(listing.suggestedCategories)) {
    for (const s of listing.suggestedCategories) {
      const cid = normalizeId(s?.categoryId);
      if (!cid) continue;
      if (!seen.has(cid)) {
        seen.add(cid);
        finalSuggestions.push({ categoryId: cid, categoryName: s.categoryName || null, reason: s.reason || "AI suggestion" });
      }
      if (finalSuggestions.length >= 3) break;
    }
  }

  // Backfill missing category names via exact DB lookup for all suggestions
  if (svc) {
    for (let i = 0; i < finalSuggestions.length; i++) {
      if (!finalSuggestions[i].categoryName) {
        try {
          const { data: exact } = await svc
            .from("category_mappings")
            .select("category_name")
            .eq("ebay_category_id", finalSuggestions[i].categoryId)
            .single();
          if (exact && exact.category_name) {
            finalSuggestions[i].categoryName = exact.category_name;
          }
        } catch (e) {
          // ignore lookup failures - keep null
        }
      }
    }
  }

  // Limit to up to 3
  return finalSuggestions.slice(0, 3);
}

export default buildSuggestedCategories;
