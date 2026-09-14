import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { decideSlabOcr, SLAB_GATE_MIN_CONFIDENCE, type SlabOcrGateEvidence } from "./slabOcrGate.ts";

// Regression coverage for the Slab OCR cost/latency gate (2026-09-14).
//
// Production logs showed Slab OCR running unconditionally on every
// coins_bullion/general item: on a raw 1930-S Standing Liberty quarter it spent
// 9.8s and ~$0.038 to return `isSlabbed: false`, whose result was then
// discarded ("Slab OCR context not injected"). The gate skips that call when
// the VisualAgent has POSITIVELY established the coin is raw.
//
// The bias is the whole point: Slab OCR exists because Gemini misreads slab
// labels, so a Gemini-sourced "no slab" is only trusted when explicit AND
// high-confidence. Every ambiguous case must fail OPEN (run OCR). A needless
// call costs ~4 cents; a missed slab label corrupts year/grade/cert on a graded
// coin, which is the highest-value listing in this vertical.

const RAW_FINDINGS = "The coin is a raw, ungraded specimen with no holder present. Obverse shows " +
  "clear Standing Liberty design with visible date 1930 and S mint mark below.";

function ev(over: Partial<SlabOcrGateEvidence> = {}): SlabOcrGateEvidence {
  return { keyFindings: RAW_FINDINGS, confidenceBoost: 85, ...over };
}

// ── The one and only skip path ────────────────────────────────────────────────

Deno.test("skips OCR on explicit raw + high confidence (the 2026-09-14 waste case)", () => {
  const d = decideSlabOcr(ev());
  assertEquals(d.runOcr, false);
});

Deno.test("skip reason names the matched raw phrase and the confidence", () => {
  const d = decideSlabOcr(ev());
  assertEquals(d.reason.includes("raw"), true);
  assertEquals(d.reason.includes("85"), true);
});

// ── Fail-open: absent or weak evidence ────────────────────────────────────────

Deno.test("runs OCR when there is no VisualAgent evidence at all", () => {
  assertEquals(decideSlabOcr(null).runOcr, true);
  assertEquals(decideSlabOcr(undefined).runOcr, true);
});

Deno.test("runs OCR when the VisualAgent failed and returned its empty fallback", () => {
  // visual-agent.ts's catch path returns exactly this shape.
  const d = decideSlabOcr({
    keyFindings: "Visual inspection failed to run.",
    confidenceBoost: 0,
  });
  assertEquals(d.runOcr, true);
});

Deno.test("runs OCR when findings are too thin to rule out a slab", () => {
  const d = decideSlabOcr({ keyFindings: "raw coin", confidenceBoost: 99 });
  assertEquals(d.runOcr, true);
  assertEquals(d.reason.includes("thin"), true);
});

Deno.test("runs OCR when confidence is below the trust threshold", () => {
  const d = decideSlabOcr(ev({ confidenceBoost: SLAB_GATE_MIN_CONFIDENCE - 1 }));
  assertEquals(d.runOcr, true);
});

Deno.test("threshold is inclusive — exactly at the bar is trusted", () => {
  const d = decideSlabOcr(ev({ confidenceBoost: SLAB_GATE_MIN_CONFIDENCE }));
  assertEquals(d.runOcr, false);
});

Deno.test("runs OCR when confidenceBoost is missing entirely", () => {
  const d = decideSlabOcr({ keyFindings: RAW_FINDINGS });
  assertEquals(d.runOcr, true);
});

// ── Fail-open: slab cues override a raw claim ─────────────────────────────────

Deno.test("grader names force OCR even alongside the word 'raw'", () => {
  for (const g of ["PCGS", "NGC", "ANACS", "ICG", "PMG", "CAC"]) {
    const d = decideSlabOcr(
      ev({
        keyFindings: `Appears raw and ungraded, though a ${g} holder edge may be visible in frame 3. ` +
          `Date and mint mark are legible on the obverse of the coin.`,
      }),
    );
    assertEquals(d.runOcr, true, `${g} should force OCR`);
    assertEquals(d.reason.includes(g), true, `${g} should be named in reason`);
  }
});

Deno.test("grade notation (MS 65) forces OCR — implies a graded holder", () => {
  const d = decideSlabOcr(
    ev({
      keyFindings: "Coin described as raw but surfaces appear consistent with MS 65 quality. " +
        "Full head detail is present on the Standing Liberty obverse device.",
    }),
  );
  assertEquals(d.runOcr, true);
});

Deno.test("holder/encapsulation words force OCR", () => {
  for (const cue of ["slabbed", "graded", "encapsulated", "certified", "holder"]) {
    const d = decideSlabOcr(
      ev({
        keyFindings: `The item is ${cue} according to the inspection of all provided images. ` +
          `Obverse and reverse are both clearly visible for assessment.`,
      }),
    );
    assertEquals(d.runOcr, true, `"${cue}" should force OCR`);
  }
});

Deno.test("a cert number reference forces OCR", () => {
  const d = decideSlabOcr(
    ev({
      keyFindings: "Possibly raw, but a partial cert number is visible along the label edge. " +
        "Further inspection of the holder text is warranted for this item.",
    }),
  );
  assertEquals(d.runOcr, true);
});

// ── Fail-open: silence is not a negative ──────────────────────────────────────

Deno.test("runs OCR when findings simply never mention holder state", () => {
  const d = decideSlabOcr(
    ev({
      keyFindings: "Obverse shows the Standing Liberty design with clear drapery detail. " +
        "Reverse eagle is well struck with full feather separation visible.",
    }),
  );
  assertEquals(d.runOcr, true);
  assertEquals(d.reason.includes("fail open"), true);
});

// ── capturedAttributes participate in the decision ────────────────────────────

Deno.test("a Certification attribute forces OCR despite a raw claim", () => {
  const d = decideSlabOcr(
    ev({
      capturedAttributes: { Certification: "PCGS", Grade: "MS 64" },
    }),
  );
  assertEquals(d.runOcr, true);
});

Deno.test("attribute text counts toward the evidence-thickness check", () => {
  // Thin keyFindings alone would fail open; rich attributes make it decidable.
  const d = decideSlabOcr({
    keyFindings: "raw",
    confidenceBoost: 90,
    capturedAttributes: {
      Year: "1930",
      "Mint Mark": "S",
      Denomination: "25C",
      Composition: "90% Silver",
      "Strike Type": "Business",
    },
  });
  assertEquals(d.runOcr, false);
});

Deno.test("every decision carries a non-empty reason for log auditing", () => {
  const cases: (SlabOcrGateEvidence | null)[] = [
    null,
    ev(),
    ev({ confidenceBoost: 10 }),
    { keyFindings: "", confidenceBoost: 0 },
  ];
  for (const c of cases) {
    assertEquals(decideSlabOcr(c).reason.length > 0, true);
  }
});
