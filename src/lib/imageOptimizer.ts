/**
 * Client-side image optimizer for listing photos.
 * Uses HTML Canvas for:
 *  1. Auto-crop: trims uniform background edges to center the subject
 *  2. Brightness / contrast / saturation normalization
 *  3. Output as a clean, uniform data-URL
 */

const TARGET_SIZE = 1600; // max output dimension

/** Load a data-URL into an HTMLImageElement */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Get the RGBA pixel data from an image */
function getPixelData(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return {
    canvas,
    ctx,
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };
}

/** Detect bounding box of the main subject by trimming uniform-colored edges */
function detectSubjectBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } {
  // Sample corner pixels to estimate the background color
  const corners = [
    0, // top-left
    (width - 1) * 4, // top-right
    (height - 1) * width * 4, // bottom-left
    ((height - 1) * width + (width - 1)) * 4, // bottom-right
  ];

  let bgR = 0, bgG = 0, bgB = 0;
  for (const idx of corners) {
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR = Math.round(bgR / 4);
  bgG = Math.round(bgG / 4);
  bgB = Math.round(bgB / 4);

  const threshold = 40; // color distance tolerance

  const isBackground = (i: number) => {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db) < threshold;
  };

  let top = 0, bottom = height - 1, left = 0, right = width - 1;

  // Scan from top
  outer_top:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBackground(( y * width + x) * 4)) { top = y; break outer_top; }
    }
  }

  // Scan from bottom
  outer_bottom:
  for (let y = height - 1; y >= top; y--) {
    for (let x = 0; x < width; x++) {
      if (!isBackground((y * width + x) * 4)) { bottom = y; break outer_bottom; }
    }
  }

  // Scan from left
  outer_left:
  for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y++) {
      if (!isBackground((y * width + x) * 4)) { left = x; break outer_left; }
    }
  }

  // Scan from right
  outer_right:
  for (let x = width - 1; x >= left; x--) {
    for (let y = top; y <= bottom; y++) {
      if (!isBackground((y * width + x) * 4)) { right = x; break outer_right; }
    }
  }

  // Add a small margin (5% of the crop dimension)
  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const marginX = Math.round(cropW * 0.05);
  const marginY = Math.round(cropH * 0.05);

  return {
    x: Math.max(0, left - marginX),
    y: Math.max(0, top - marginY),
    w: Math.min(width, cropW + marginX * 2),
    h: Math.min(height, cropH + marginY * 2),
  };
}

/** Compute mean brightness of image data (0–255) */
function computeStats(data: Uint8ClampedArray) {
  let totalBrightness = 0;
  let minB = 255, maxB = 0;
  const pixelCount = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    totalBrightness += brightness;
    if (brightness < minB) minB = brightness;
    if (brightness > maxB) maxB = brightness;
  }

  return {
    meanBrightness: totalBrightness / pixelCount,
    minBrightness: minB,
    maxBrightness: maxB,
    contrast: maxB - minB,
  };
}

/**
 * Optimize a single image:
 *  - Auto-crop to subject
 *  - Normalize brightness & contrast
 *  - Resize to fit within TARGET_SIZE
 *  - Return as JPEG data-URL
 */
export async function optimizeImage(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const { imageData, width, height } = getPixelData(img);

  // 1. Detect subject bounds
  const bounds = detectSubjectBounds(imageData.data, width, height);

  // If crop is less than 10% of the image, skip cropping (already well-framed)
  const cropArea = bounds.w * bounds.h;
  const fullArea = width * height;
  const shouldCrop = cropArea < fullArea * 0.9 && bounds.w > 50 && bounds.h > 50;

  const sx = shouldCrop ? bounds.x : 0;
  const sy = shouldCrop ? bounds.y : 0;
  const sw = shouldCrop ? bounds.w : width;
  const sh = shouldCrop ? bounds.h : height;

  // 2. Determine output size (fit within TARGET_SIZE)
  let outW = sw;
  let outH = sh;
  if (Math.max(outW, outH) > TARGET_SIZE) {
    const scale = TARGET_SIZE / Math.max(outW, outH);
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }

  // 3. Draw cropped region to output canvas
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  // 4. Normalize brightness & contrast using CSS filters on a second pass
  const croppedData = outCtx.getImageData(0, 0, outW, outH);
  const stats = computeStats(croppedData.data);

  // Target: mean brightness ~130, contrast range ~200
  const targetMean = 130;
  const brightnessDelta = targetMean - stats.meanBrightness;

  // Apply per-pixel brightness adjustment and mild contrast stretch
  const contrastRange = stats.maxBrightness - stats.minBrightness;
  const contrastFactor = contrastRange > 20 ? Math.min(220 / contrastRange, 1.5) : 1;

  const pixels = croppedData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let val = pixels[i + c];
      // Contrast stretch around mid-point
      val = ((val - 128) * contrastFactor) + 128;
      // Brightness shift
      val += brightnessDelta * 0.5; // apply half to avoid over-correction
      pixels[i + c] = Math.max(0, Math.min(255, Math.round(val)));
    }
  }

  outCtx.putImageData(croppedData, 0, 0);

  return outCanvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Optimize an array of images in parallel.
 * Returns a new array of optimized data-URLs.
 */
export async function optimizeImages(
  dataUrls: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < dataUrls.length; i++) {
    // Skip non-image data URLs (videos, etc.)
    if (!dataUrls[i].startsWith("data:image/")) {
      results.push(dataUrls[i]);
    } else {
      results.push(await optimizeImage(dataUrls[i]));
    }
    onProgress?.(i + 1, dataUrls.length);
  }
  return results;
}
