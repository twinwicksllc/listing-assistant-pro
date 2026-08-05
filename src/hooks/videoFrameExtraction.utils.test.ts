import { describe, expect, it } from "vitest";
import { computeFrameQualityScore, selectBestFrames } from "./videoFrameExtraction.utils";

describe("video frame extraction helpers", () => {
  it("scores sharper images higher than blurry ones", () => {
    const sharp = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const idx = (i * 64 + j) * 4;
        const value = j < 32 ? 240 : 20;
        sharp[idx] = value;
        sharp[idx + 1] = value;
        sharp[idx + 2] = value;
        sharp[idx + 3] = 255;
      }
    }

    const blurry = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const idx = (i * 64 + j) * 4;
        const value = 120;
        blurry[idx] = value;
        blurry[idx + 1] = value;
        blurry[idx + 2] = value;
        blurry[idx + 3] = 255;
      }
    }

    expect(computeFrameQualityScore(sharp, 64, 64)).toBeGreaterThan(computeFrameQualityScore(blurry, 64, 64));
  });

  it("filters duplicate frames and keeps the strongest candidates", () => {
    const candidates = [
      { timestampSec: 0.5, qualityScore: 0.91 },
      { timestampSec: 1.0, qualityScore: 0.88 },
      { timestampSec: 1.1, qualityScore: 0.86 },
      { timestampSec: 3.5, qualityScore: 0.84 },
    ];

    const selected = selectBestFrames(candidates, 2);

    expect(selected).toHaveLength(2);
    expect(selected[0].timestampSec).toBe(0.5);
    expect(selected[1].timestampSec).toBe(3.5);
  });
});
