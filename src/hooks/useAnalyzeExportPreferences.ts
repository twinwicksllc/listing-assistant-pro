import { useState } from "react";
import type { ExportPlatform, ExportFormat } from "@/lib/exportCSV";

export function useAnalyzeExportPreferences() {
  const [exportPlatform, setExportPlatform] =
    useState<ExportPlatform>("ebay_file_exchange");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");

  return {
    exportPlatform,
    exportFormat,
    setExportPlatform,
    setExportFormat,
  };
}
