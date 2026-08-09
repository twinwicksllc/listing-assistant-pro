export interface PackageDimensionsInput {
  weightLb?: number | null;
  weightOz?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
}

export interface PackageWeightAndSizePayload {
  weight?: { value: number; unit: "POUND" };
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
    unit: "INCH";
  };
}

/**
 * Builds the packageWeightAndSize payload sent to the ebay-publish edge function.
 *
 * Weight and dimensions are independent shipping attributes. Previously this logic
 * (duplicated in useAnalyzePublishPayload and usePublishDraft) returned `undefined`
 * entirely whenever weight was 0/blank, silently discarding any dimensions the user
 * had entered. It also required all three dimensions (length/width/height) to be
 * present, discarding partial dimensions (e.g. an envelope where only height and
 * width are known).
 *
 * Fix: forward whatever the user actually entered.
 *  - weight is included if lb and/or oz sum to > 0
 *  - if the user entered nothing at all, returns undefined (server may fall back to an inferred weight)
 *
 * Note: the server-side ebay-publish implementation must preserve dimensions when inferring weight; otherwise a dimensions-only payload will be overwritten.
 */
export function buildPackageWeightAndSizePayload(
  input: PackageDimensionsInput,
): PackageWeightAndSizePayload | undefined {
  const lb = input.weightLb || 0;
  const oz = input.weightOz || 0;
  const totalLb = lb + oz / 16;
  const hasWeight = totalLb > 0;

  const l = input.lengthIn || 0;
  const w = input.widthIn || 0;
  const h = input.heightIn || 0;
  const hasAnyDim = l > 0 || w > 0 || h > 0;

  if (!hasWeight && !hasAnyDim) return undefined;

  return {
    ...(hasWeight
      ? {
          weight: { value: Number(totalLb.toFixed(4)), unit: "POUND" as const },
        }
      : {}),
    ...(hasAnyDim
      ? {
          dimensions: {
            ...(l > 0 ? { length: l } : {}),
            ...(w > 0 ? { width: w } : {}),
            ...(h > 0 ? { height: h } : {}),
            unit: "INCH" as const,
          },
        }
      : {}),
  };
}
