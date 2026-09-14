/**
 * slabOcrGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Decides whether the GPT-4o slab-label OCR pre-pass is worth running.
 *
 * Slab OCR exists because Gemini misreads small printed digits on grading
 * labels ("2026" -> "2020"), so its result is authoritative ground truth when a
 * slab IS present. But it costs ~$0.038 and ~10s per call, and it previously ran
 * on EVERY coins_bullion/general item. On a raw coin that is pure waste: the
 * 2026-09-14 logs show it returning `isSlabbed: false` after 9.8s, with the
 * result then explicitly discarded ("Slab OCR context not injected").
 *
 * ── Why this gate is deliberately biased toward RUNNING ────────────────────
 * The VisualAgent that supplies our evidence uses the very model whose label
 * misreads Slab OCR was built to correct. Trusting a Gemini "no slab here"
 * too readily would reintroduce the original bug through the back door. So
 * this gate only skips OCR on a POSITIVE, high-confidence statement that the
 * item is raw -- never on missing, thin, or ambiguous evidence. Anything
 * unclear fails OPEN and runs OCR.
 *
 * Cost asymmetry drives that choice: a needless OCR call costs ~$0.038 and
 * ~10s, while a missed slab label corrupts the year/grade/cert on a listing
 * for a graded coin -- exactly the high-value item where accuracy matters most.
 */

export interface SlabOcrGateEvidence {
  /** Free-text findings from the VisualAgent's precision inspection. */
  keyFindings?: string | null;
  /** Attributes the VisualAgent was >=90% confident in. */
  capturedAttributes?: Record<string, string> | null;
  /**
   * VisualAgent self-reported confidence (0-100). Typed loosely on purpose --
   * this arrives from a model, and visual-agent.ts passes `parsed.confidenceBoost`
   * through with only a `|| 50` fallback, so a non-numeric value like "high"
   * reaches us intact. See coerceConfidence().
   */
  confidenceBoost?: unknown;
}

export interface SlabOcrGateDecision {
  runOcr: boolean;
  /** Human-readable justification, logged verbatim for later auditing. */
  reason: string;
}

/**
 * Minimum VisualAgent confidence before a "no slab" claim is trusted at all.
 * Mirrors the >=70 threshold controller.ts already uses before acting on the
 * agent's identificationCorrection, so the pipeline applies one standard for
 * "this agent's assertion is strong enough to change behavior".
 */
export const SLAB_GATE_MIN_CONFIDENCE = 70;

/** Graders whose names appearing anywhere in the findings imply a slab/holder. */
const GRADER_RE = /\b(PCGS|NGC|ANACS|ICG|CAC|PMG|SEGS|NNC|Legacy Currency Grading)\b/i;

/**
 * Physical-holder and grade-notation cues. Any of these means "treat as
 * potentially slabbed" regardless of what else the findings say.
 */
const SLAB_CUE_RE =
  /\b(slab|slabbed|graded|holder|encapsulat\w*|certif\w*|cert\s*(?:no|number|#)|MS\s?\d{2}|PR\s?\d{2}|PF\s?\d{2}|AU\s?\d{2}|VF\s?\d{2}|XF\s?\d{2}|EF\s?\d{2}|G\s?\d{2}|EPQ|DCAM|Cameo|First\s+Strike|First\s+Day\s+of\s+Issue)\b/i;

/**
 * Explicit statements that the item is NOT in a holder. Deliberately narrow --
 * these are the only phrasings that earn a skip.
 */
const EXPLICIT_RAW_RE =
  /\b(raw|ungraded|not\s+(?:graded|slabbed|certified|encapsulated)|no\s+(?:slab|holder|grading\s+label|certification)|loose\s+coin|without\s+(?:a\s+)?(?:slab|holder))\b/i;

/**
 * Normalize the model-supplied confidence to a trustworthy number.
 *
 * This is a fail-open guard, not tidying. `confidenceBoost` is model-derived
 * and reaches us unvalidated, and JavaScript's relational operators return
 * false for NaN: a string like "high" makes `confidence < SLAB_GATE_MIN_CONFIDENCE`
 * evaluate to false, silently skipping the low-confidence check and letting an
 * explicit "raw" claim skip OCR on confidence we never actually established.
 * That inverts the gate's whole bias. Anything not a finite number is therefore
 * treated as zero confidence, which routes to RUN.
 */
export function coerceConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Decide whether to run the Slab OCR pre-pass.
 *
 * Precedence is intentional and ordered strongest-evidence-first:
 *   1. No/low-confidence/thin evidence       -> RUN (fail open)
 *   2. Any grader name or slab/grade cue     -> RUN (possible slab)
 *   3. Explicit "raw"/"ungraded" statement   -> SKIP (the only skip path)
 *   4. Anything else                         -> RUN (fail open)
 *
 * Negation handling matters at step 2. A phrase like "no holder present" or
 * "not slabbed" contains the literal cue words ("holder", "slabbed") while
 * asserting the opposite, so scanning raw text would let every clear negative
 * masquerade as a slab cue and the skip path would be unreachable. Explicit
 * negation phrases are therefore removed from the text BEFORE the cue scan;
 * only cues surviving outside a negation count as evidence of a holder.
 */
export function decideSlabOcr(
  evidence: SlabOcrGateEvidence | null | undefined,
): SlabOcrGateDecision {
  if (!evidence) {
    return {
      runOcr: true,
      reason: "no VisualAgent evidence available (fail open)",
    };
  }

  const confidence = coerceConfidence(evidence.confidenceBoost);
  const findings = (evidence.keyFindings ?? "").trim();
  const attrs = evidence.capturedAttributes ?? {};
  const attrText = Object.entries(attrs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
  const haystack = `${findings} ${attrText}`.trim();

  // 1. Thin or low-confidence evidence is not grounds to skip an accuracy pass.
  if (haystack.length < 40) {
    return {
      runOcr: true,
      reason: `VisualAgent findings too thin to rule out a slab (${haystack.length} chars, fail open)`,
    };
  }
  if (confidence < SLAB_GATE_MIN_CONFIDENCE) {
    return {
      runOcr: true,
      reason:
        `VisualAgent confidence ${confidence} < ${SLAB_GATE_MIN_CONFIDENCE} — not trusted to rule out a slab (fail open)`,
    };
  }

  // Find the explicit-raw claim on the original text, then blank those phrases
  // out so their own cue words ("no holder", "not slabbed") cannot be
  // misread as positive slab evidence by the scan below.
  const rawHit = haystack.match(EXPLICIT_RAW_RE);
  const cueHaystack = haystack.replace(
    new RegExp(EXPLICIT_RAW_RE.source, "gi"),
    " ",
  );

  // 2. A grading-service name or any holder/grade notation means treat as slabbed.
  const graderHit = cueHaystack.match(GRADER_RE);
  if (graderHit) {
    return {
      runOcr: true,
      reason: `grading service "${graderHit[0]}" referenced in visual findings`,
    };
  }
  const cueHit = cueHaystack.match(SLAB_CUE_RE);
  if (cueHit) {
    return {
      runOcr: true,
      reason: `slab/grade cue "${cueHit[0]}" present in visual findings`,
    };
  }

  // 3. Only an explicit, confident "this is raw" earns a skip.
  if (rawHit) {
    return {
      runOcr: false,
      reason: `VisualAgent explicitly reports "${rawHit[0]}" at confidence ${confidence} with no slab cues`,
    };
  }

  // 4. Silence is not a negative.
  return {
    runOcr: true,
    reason: "no explicit raw/ungraded statement in visual findings (fail open)",
  };
}
