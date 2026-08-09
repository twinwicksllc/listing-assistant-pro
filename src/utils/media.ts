export function getSupportedVideoMimeType(): string | null {
  // Prefer a modern webm/VP9/VP8 type first, then fall back to mp4 variants
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];

  if (typeof MediaRecorder === "undefined") return null;

  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

export default getSupportedVideoMimeType;
