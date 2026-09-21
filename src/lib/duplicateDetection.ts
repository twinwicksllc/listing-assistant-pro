export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

export function tokenizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of a) {
    if (b.has(token)) intersectionSize++;
  }
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

export function findDuplicateTitles(
  listings: { id: string; title: string }[],
): Map<string, string[]> {
  const tokensById = new Map(
    listings.map((listing) => [listing.id, tokenizeTitle(listing.title)]),
  );
  const duplicates = new Map<string, string[]>();

  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const a = listings[i];
      const b = listings[j];
      const similarity = jaccardSimilarity(
        tokensById.get(a.id)!,
        tokensById.get(b.id)!,
      );
      if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
        duplicates.set(a.id, [...(duplicates.get(a.id) ?? []), b.id]);
        duplicates.set(b.id, [...(duplicates.get(b.id) ?? []), a.id]);
      }
    }
  }

  return duplicates;
}
