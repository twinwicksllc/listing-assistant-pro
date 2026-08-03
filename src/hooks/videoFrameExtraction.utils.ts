export interface FrameQualityCandidate {
  timestampSec: number;
  qualityScore: number;
}

export function computeFrameQualityScore(imageData: Uint8ClampedArray, width: number, height: number): number {
  if (width <= 0 || height <= 0 || imageData.length < width * height * 4) {
    return 0;
  }

  let gradientSum = 0;
  let sampleCount = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 24));

  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const idx = (y * width + x) * 4;
      const nextIdx = ((y + step) * width + x) * 4;
      const r1 = imageData[idx];
      const g1 = imageData[idx + 1];
      const b1 = imageData[idx + 2];
      const r2 = imageData[nextIdx];
      const g2 = imageData[nextIdx + 1];
      const b2 = imageData[nextIdx + 2];

      const luminance1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const luminance2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
      gradientSum += Math.abs(luminance2 - luminance1);
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) return 0;
  const normalized = gradientSum / sampleCount / 255;
  return Math.min(1, Math.max(0, normalized));
}

export function selectBestFrames(candidates: FrameQualityCandidate[], maxFrames: number): FrameQualityCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  const selected: FrameQualityCandidate[] = [];
  const selectedTimestamps: number[] = [];

  for (const candidate of sorted) {
    const alreadySelected = selectedTimestamps.some((timestamp) => Math.abs(timestamp - candidate.timestampSec) < 0.75);
    if (alreadySelected) continue;

    selected.push(candidate);
    selectedTimestamps.push(candidate.timestampSec);
    if (selected.length >= maxFrames) break;
  }

  return selected.sort((a, b) => a.timestampSec - b.timestampSec);
}
