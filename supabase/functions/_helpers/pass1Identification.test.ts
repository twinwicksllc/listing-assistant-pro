import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { unwrapIdentificationPayload } from "./pass1Identification.ts";

// Regression coverage for the Pass 1 array-wrapping bug (2026-09-14).
//
// Despite `response_format: { type: "json_object" }`, Gemini intermittently
// returns the identification wrapped in an array. Production logs caught it on
// a 1930-S Standing Liberty quarter:
//
//   PASS 1 raw response: [ { "domain": "coins_bullion", "itemName": "1930-S ..." } ]
//   ⚠️ Pass 1 JSON missing domain or itemName
//   Controller: Stage 1 Complete. Domain=general        <-- wrong
//
// Both parse paths checked `parsed.domain && parsed.itemName`, which is
// undefined on an array, so a perfectly correct identification silently
// degraded to domain="general". That misroutes RAG category selection, the
// domain prompt, Slab OCR eligibility and category resolution -- the whole
// downstream pipeline runs as the wrong vertical.

const IDENT = {
  domain: "coins_bullion",
  itemName: "1930-S Standing Liberty Quarter 90% Silver",
  keywords: ["1930-S", "Standing Liberty"],
  isMetal: true,
  metalType: "silver",
};

Deno.test("unwraps the exact array payload seen in production", () => {
  assertEquals(unwrapIdentificationPayload([IDENT]), IDENT);
});

Deno.test("passes a plain object through untouched (the normal path)", () => {
  assertEquals(unwrapIdentificationPayload(IDENT), IDENT);
});

Deno.test("picks the identification-shaped element, not blindly index 0", () => {
  assertEquals(unwrapIdentificationPayload([null, IDENT]), IDENT);
  assertEquals(unwrapIdentificationPayload(["preamble", IDENT]), IDENT);
});

Deno.test("prefers the first fully-shaped element among several", () => {
  const partial = { domain: "general" }; // missing itemName
  assertEquals(unwrapIdentificationPayload([partial, IDENT]), IDENT);
});

Deno.test("falls back to index 0 when nothing is identification-shaped", () => {
  // Preserves the previous end state (the caller's domain/itemName check then
  // fails and DEFAULT_IDENTIFICATION applies) rather than throwing.
  const junk = { unexpected: true };
  assertEquals(unwrapIdentificationPayload([junk]), junk);
});

Deno.test("an empty array yields undefined rather than throwing", () => {
  assertEquals(unwrapIdentificationPayload([]), undefined);
});

Deno.test("non-object scalars pass through unchanged", () => {
  assertEquals(unwrapIdentificationPayload(null), null);
  assertEquals(unwrapIdentificationPayload("text"), "text");
  assertEquals(unwrapIdentificationPayload(42), 42);
});

Deno.test("does not recurse into doubly-nested arrays", () => {
  // Not observed in production; documents the boundary rather than guessing.
  assertEquals(unwrapIdentificationPayload([[IDENT]]), [IDENT]);
});
