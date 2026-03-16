export async function buildSuggestedCategories(listing: any, svc: any) {
  const normalizeId = (id: any) => (id ? String(id).trim() : "");
  const seen = new Set<string>();
  const finalSuggestions: any[] = [];

  // Start with AI-provided primary category (ebayCategoryId)
  if (listing.ebayCategoryId) {
    const cid = normalizeId(listing.ebayCategoryId);
    seen.add(cid);
    finalSuggestions.push({ categoryId: cid, categoryName: listing.suggestedCategories?.[0]?.categoryName || null, reason: "Primary category from AI" });
  }

  // Add AI suggestions while deduping
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

  // If we still have fewer than 3 suggestions, do NOT perform fuzzy lookup (by design)
  // but try to backfill missing categoryName for the first suggestion via exact lookup
  if (finalSuggestions.length > 0 && finalSuggestions[0].categoryName === null && svc) {
    try {
      const { data: exact } = await svc
        .from("category_mappings")
        .select("category_name")
        .eq("ebay_category_id", finalSuggestions[0].categoryId)
        .single();
      if (exact && exact.category_name) finalSuggestions[0].categoryName = exact.category_name;
    } catch (e) {
      // ignore lookup failures
    }
  }

  // Limit to up to 3
  return finalSuggestions.slice(0, 3);
}

export default buildSuggestedCategories;
