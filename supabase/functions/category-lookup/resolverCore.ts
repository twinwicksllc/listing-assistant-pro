/**
 * resolverCore.ts — pure, dependency-free precedence + agreement logic for
 * the Category Resolver v2 filter-then-rank rewrite
 * (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md §2).
 *
 * This module intentionally contains NO network calls, NO Supabase client,
 * and NO eBay API access — everything here is a pure function over already
 * -gated candidates, so it can be unit tested with `deno test` in isolation
 * (same rationale as leafCategoryGuard.ts / suggestedCategories.ts).
 *
 * All of the I/O (querying `ebay_taxonomy_cache`, calling eBay's Taxonomy
 * and Metadata APIs) happens in index.ts, which builds `GatedCandidate[]`
 * and passes them here for the actual decision.
 *
 * ─── The model (no arithmetic, no score) ───────────────────────────────
 *
 * Layer 1 (hard gates, enforced by the CALLER before this module runs):
 *   1. Exists in ebay_taxonomy_cache AND is_leaf = true
 *   2. Category is ACTIVE (cache-fresh or live-confirmed)
 *   3. Accepts the item's condition (when a conditionId was supplied)
 *   Anything failing ANY of the above is marked `survived: false` with a
 *   `dropReason` — it never reaches the precedence logic below as a
 *   contender, but it IS still visible in `topCandidates` for
 *   NEEDS_CONFIRMATION responses so a human can see what was rejected and why.
 *
 * Layer 2 (precedence — first match wins, no arithmetic):
 *   1. user_verified survivor            → DONE, locked
 *   2. (identity/catalog match)          → out of scope for this repo today
 *      (no UPC/EAN/ISBN identity path exists yet; left as a documented gap,
 *      not implemented as a silent no-op)
 *   3. eBay rank #1 survivor             → candidate for Layer 3
 *   4. no survivors / no eBay #1 survivor → NEEDS_CONFIRMATION
 *
 * Layer 3 (agreement check — routing, not scoring):
 *   - Do ≥2 independent sources agree on the same leaf?
 *   - Is eBay's #1 clearly separated from #2 (different top-level subtree)?
 *   BOTH yes → auto-publish (winner = eBay #1)
 *   EITHER no → NEEDS_CONFIRMATION
 *
 * Gemini's suggestion is deliberately NEVER an outright winner in this
 * model — it can only (a) act as one of the "independent sources" in the
 * agreement check, or (b) appear in the NEEDS_CONFIRMATION candidate list.
 * This is a direct, intentional consequence of §5's "Gemini should never be
 * an oracle" principle, not an oversight.
 */

export type CandidateSource =
  | "user_verified"
  | "db_exact"
  | "ebay_api"
  | "db_fuzzy"
  | "gemini";

export interface GatedCandidate {
  categoryId: string;
  categoryName: string;
  breadcrumb: string;
  source: CandidateSource;
  /** 1-based rank within this candidate's own source (eBay rank #1, #2, ... independent of other sources). */
  rank: number;
  /** True only if this candidate passed every Layer-1 hard gate. */
  survived: boolean;
  /** Human-readable reason a candidate was dropped; null when survived. */
  dropReason: string | null;
  /** Gate 4 (aspect satisfiability) is warn-only — never causes a drop, only logged here. */
  gate4Warnings: string[];
  /** Free-text explanation of where this candidate came from (kept for audit logging). */
  reason: string;
}

export interface WinnerResult {
  winner: GatedCandidate | null;
  lockReason: string;
  needsConfirmation: boolean;
  agreementChecked: boolean;
  agreementSourcesMatched: CandidateSource[];
  subtreeSeparated: boolean | null;
}

/** First breadcrumb segment, lowercased/trimmed, used as a cheap "same subtree?" signal. */
function topLevelSegment(breadcrumb: string): string {
  return (breadcrumb || "").split(">")[0].trim().toLowerCase();
}

/**
 * Layer 2 + Layer 3: given ALL gathered candidates (survivors and
 * non-survivors alike, so callers can still show rejected ones in
 * NEEDS_CONFIRMATION), decide the winner with no arithmetic — precedence
 * and routing only.
 */
export function selectWinner(allCandidates: GatedCandidate[]): WinnerResult {
  const survivors = allCandidates.filter((c) => c.survived);

  // ── Layer 2, rule 1: user_verified survivor wins outright ──────────────
  // A human correction outranks every automated signal, regardless of what
  // eBay's own suggestion API says. (Preserves the precedence fix from PR #527.)
  const userVerified = survivors.find((c) => c.source === "user_verified");
  if (userVerified) {
    return {
      winner: userVerified,
      lockReason: "User-verified mapping — human correction outranks all other signals",
      needsConfirmation: false,
      agreementChecked: false,
      agreementSourcesMatched: [],
      subtreeSeparated: null,
    };
  }

  // ── Layer 2, rule 3: eBay rank #1 must itself have survived ─────────────
  // Note this is deliberately strict: if eBay's #1 suggestion was dropped by
  // a hard gate but rank #2 or #3 survived, that is NOT promoted to winner.
  // There is no "next best" consolation prize in this model — only
  // user_verified, identity match, or eBay's OWN #1 pick (agreement-checked)
  // can become winner. Anything else is NEEDS_CONFIRMATION.
  const ebayTop = survivors.find(
    (c) => c.source === "ebay_api" && c.rank === 1,
  );
  if (!ebayTop) {
    return {
      winner: null,
      lockReason: survivors.length > 0
        ? "NEEDS_CONFIRMATION: eBay's top suggestion did not survive the hard gates, and no user-verified mapping exists"
        : "NEEDS_CONFIRMATION: no candidate survived the hard gates",
      needsConfirmation: true,
      agreementChecked: false,
      agreementSourcesMatched: [],
      subtreeSeparated: null,
    };
  }

  // ── Layer 3: agreement check (routing, not scoring) ─────────────────────
  const agreeingSources = survivors
    .filter((c) => c !== ebayTop && c.categoryId === ebayTop.categoryId)
    .map((c) => c.source);
  const hasAgreement = agreeingSources.length > 0;

  const ebaySecond = allCandidates.find(
    (c) => c.source === "ebay_api" && c.rank === 2,
  );
  // No second eBay suggestion to be confused with → vacuously separated.
  const subtreeSeparated = !ebaySecond
    ? true
    : topLevelSegment(ebaySecond.breadcrumb) !== topLevelSegment(ebayTop.breadcrumb);

  if (hasAgreement && subtreeSeparated) {
    return {
      winner: ebayTop,
      lockReason: `eBay rank #1 confirmed by agreement with [${agreeingSources.join(", ")}] ` +
        `and clear subtree separation from rank #2`,
      needsConfirmation: false,
      agreementChecked: true,
      agreementSourcesMatched: agreeingSources,
      subtreeSeparated,
    };
  }

  return {
    winner: null,
    lockReason: `NEEDS_CONFIRMATION: eBay rank #1 survived the hard gates but ${
      !hasAgreement
        ? "no independent source agreed on the same category"
        : "was not clearly separated from rank #2 (same top-level subtree)"
    }`,
    needsConfirmation: true,
    agreementChecked: true,
    agreementSourcesMatched: agreeingSources,
    subtreeSeparated,
  };
}
