import { describe, it, expect } from "vitest";
import { buildPackageWeightAndSizePayload } from "../lib/packageWeightAndSize";

describe("buildPackageWeightAndSizePayload", () => {
  it("returns undefined when no weight or dimensions are provided", () => {
    expect(buildPackageWeightAndSizePayload({})).toBeUndefined();
    expect(
      buildPackageWeightAndSizePayload({
        weightLb: null,
        weightOz: null,
        lengthIn: null,
        widthIn: null,
        heightIn: null,
      }),
    ).toBeUndefined();
    expect(
      buildPackageWeightAndSizePayload({
        weightLb: 0,
        weightOz: 0,
        lengthIn: 0,
        widthIn: 0,
        heightIn: 0,
      }),
    ).toBeUndefined();
  });

  it("returns weight only when only weight fields are set", () => {
    expect(
      buildPackageWeightAndSizePayload({ weightLb: 2, weightOz: 8 }),
    ).toEqual({
      weight: { value: 2.5, unit: "POUND" },
    });
  });

  it("returns oz-based weight converted to pounds", () => {
    expect(buildPackageWeightAndSizePayload({ weightOz: 16 })).toEqual({
      weight: { value: 1, unit: "POUND" },
    });
  });

  it("returns dimensions only when only dimension fields are set", () => {
    expect(
      buildPackageWeightAndSizePayload({
        lengthIn: 10,
        widthIn: 5,
        heightIn: 3,
      }),
    ).toEqual({
      dimensions: { length: 10, width: 5, height: 3, unit: "INCH" },
    });
  });

  it("returns partial dimensions (only some fields present)", () => {
    expect(
      buildPackageWeightAndSizePayload({ widthIn: 6, heightIn: 2 }),
    ).toEqual({
      dimensions: { width: 6, height: 2, unit: "INCH" },
    });
  });

  it("returns both weight and dimensions when all fields are provided", () => {
    expect(
      buildPackageWeightAndSizePayload({
        weightLb: 1,
        weightOz: 0,
        lengthIn: 12,
        widthIn: 8,
        heightIn: 4,
      }),
    ).toEqual({
      weight: { value: 1, unit: "POUND" },
      dimensions: { length: 12, width: 8, height: 4, unit: "INCH" },
    });
  });

  it("does not include zero-value dimension fields", () => {
    const result = buildPackageWeightAndSizePayload({
      lengthIn: 0,
      widthIn: 4,
      heightIn: 0,
    });
    expect(result?.dimensions).toEqual({ width: 4, unit: "INCH" });
    expect(result?.dimensions).not.toHaveProperty("length");
    expect(result?.dimensions).not.toHaveProperty("height");
  });
});
