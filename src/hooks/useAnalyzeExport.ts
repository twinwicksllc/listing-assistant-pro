import { useMemo } from "react";
import { toast } from "sonner";
import { exportListing, type ExportFormat, type ExportPlatform } from "@/lib/exportCSV";
import type { ItemSpecifics } from "@/types/listing";
import type { SelectedPolicies } from "@/types/ebay-policies";

interface UseAnalyzeExportParams {
  exportPlatform: ExportPlatform;
  exportFormat: ExportFormat;
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  imageUrls: string[];
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  condition: string;
  selectedPolicies: SelectedPolicies;
  recordUsage: (feature: string) => Promise<void> | void;
}

export function useAnalyzeExport({
  exportPlatform,
  exportFormat,
  title,
  description,
  priceMin,
  priceMax,
  imageUrls,
  ebayCategoryId,
  itemSpecifics,
  condition,
  selectedPolicies,
  recordUsage,
}: UseAnalyzeExportParams) {
  const downloadLabel = useMemo(
    () => exportFormat === "csv" ? "CSV" : exportFormat === "excel" ? "Excel" : "Sheets",
    [exportFormat],
  );

  const handleExport = async () => {
    await exportListing(exportPlatform, exportFormat, {
      title,
      description,
      priceMin,
      priceMax,
      imageUrls,
      ebayCategoryId,
      itemSpecifics,
      condition,
      fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId ?? undefined,
      paymentPolicyId: selectedPolicies.paymentPolicyId ?? undefined,
      returnPolicyId: selectedPolicies.returnPolicyId ?? undefined,
    });

    await recordUsage("export");

    const platformLabel = exportPlatform === "ebay_file_exchange" ? "eBay" : "Facebook";
    const formatLabel = exportFormat === "csv"
      ? "CSV"
      : exportFormat === "excel"
      ? "Excel"
      : "Google Sheets";

    toast.success(`${platformLabel} listing exported as ${formatLabel}`);
  };

  return {
    downloadLabel,
    handleExport,
  };
}
