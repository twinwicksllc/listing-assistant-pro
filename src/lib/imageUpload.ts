import { supabase } from "@/integrations/supabase/client";

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
    const blob = dataUrlToBlob(dataUrl);
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabase.storage
      .from("listing-images")
      .upload(filename, blob, {
        contentType: blob.type,
        upsert: false,
      });

    if (error) {
      console.error("Image upload error:", error);
      // Fall back to data URL if upload fails
      return dataUrl;
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
 * Falls back to data URLs for any that fail.
 */
export async function uploadListingImages(
  dataUrls: string[],
  userId: string
): Promise<string[]> {
  return Promise.all(dataUrls.map((url) => uploadListingImage(url, userId)));
}