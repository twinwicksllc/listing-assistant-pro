export interface ParsedImagePayloads {
  base64List: string[];
  mimeList: string[];
}

export function parseImageDataUrl(dataUrl: string): {
  base64Data: string;
  mimeType: string;
} {
  const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  return { base64Data, mimeType };
}

export function extractImagePayloads(imageList: string[]): ParsedImagePayloads {
  const base64List: string[] = [];
  const mimeList: string[] = [];

  for (const img of imageList) {
    const { base64Data, mimeType } = parseImageDataUrl(img);
    base64List.push(base64Data);
    mimeList.push(mimeType);
  }

  return { base64List, mimeList };
}

export function toOpenAiImageContentParts(imageList: string[]): any[] {
  return imageList.map((img) => {
    const { base64Data, mimeType } = parseImageDataUrl(img);
    return {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64Data}` },
    };
  });
}
