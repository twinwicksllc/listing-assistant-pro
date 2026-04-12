import { supabase } from "@/integrations/supabase/client";

// eBay recommends 1600px on the longest side to enable their zoom feature.
// Below 800px disables zoom entirely; 1600px is the sweet spot for quality + file size.
// Target file size: ~300-600KB which is well within eBay's 12MB limit.
const STORAGE_MAX_SIZE = 1600;
const STORAGE_JPEG_QUALITY = 0.85;

/**
 * Resizes and compresses a base64 data URL image using Canvas before upload.
 * - Resizes to fit within STORAGE_MAX_SIZE (maintains aspect ratio)
 * - Outputs as JPEG at STORAGE_JPEG_QUALITY
 * - Skips resize if image is already small enough
 */
async function compressForStorage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;

      // Skip compression if already small enough
      if (Math.max(w, h) <= STORAGE_MAX_SIZE) {
        // Still re-encode as JPEG to normalize format and reduce size
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", STORAGE_JPEG_QUALITY));
        return;
      }

      // Scale down to fit within STORAGE_MAX_SIZE
      const scale = STORAGE_MAX_SIZE / Math.max(w, h);
      const outW = Math.round(w * scale);
      const outH = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, outW, outH);
      resolve(canvas.toDataURL("image/jpeg", STORAGE_JPEG_QUALITY));
    };
    img.onerror = () => resolve(dataUrl); // fallback: return original
    img.src = dataUrl;
  });
}

/**
 * Converts a base64 data URL to a Blob
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

/**
 * Uploads a base64 data URL image to Supabase Storage.
 * Automatically compresses/resizes the image before uploading.
 * Returns the public URL of the uploaded image.
 * Falls back to returning the original data URL if upload fails.
 */
export async function uploadListingImage(
  dataUrl: string,
  userId: string
): Promise<string> {
  // If it's already a remote URL (not a data URL), return as-is
  if (!dataUrl.startsWith("data:")) {
    return dataUrl;
  }

  try {
    // Compress and resize before uploading to keep storage usage low
    const compressed = await compressForStorage(dataUrl);
    const blob = dataUrlToBlob(compressed);

    // Always store as JPEG after compression
    const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const { error } = await supabase.storage
      .from("listing-images")
      .upload(filename, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (error) {
      console.error("Image upload error:", error);
      // Fall back to compressed data URL (not original) to avoid large payloads
      return compressed;
    }

    const { data: urlData } = supabase.storage
      .from("listing-images")
      .getPublicUrl(filename);

    return urlData.publicUrl;
  } catch (err) {
    console.error("Image upload failed, using data URL fallback:", err);
    return dataUrl;
  }
}

/**
 * Uploads multiple images and returns their public URLs.
 * Each image is automatically compressed before upload.
 * Falls back to data URLs for any that fail.
 */
export async function uploadListingImages(
  dataUrls: string[],
  userId: string
): Promise<string[]> {
  return Promise.all(dataUrls.map((url) => uploadListingImage(url, userId)));
}