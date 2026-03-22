import { useRef, useState, useCallback } from "react";
import { Upload, FileText, X, FileSpreadsheet } from "lucide-react";
import { parseListingFile, type ParsedFile } from "@/lib/bulkCsvParser";
import { toast } from "sonner";

interface BulkUploadZoneProps {
  onFileParsed: (result: ParsedFile) => void;
  disabled?: boolean;
}

export default function BulkUploadZone({ onFileParsed, disabled = false }: BulkUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["csv", "xlsx", "xls"].includes(ext)) {
        toast.error("Please upload a .csv or .xlsx file");
        return;
      }
      setParsing(true);
      try {
        const result = await parseListingFile(file);
        if (result.rowCount === 0) {
          toast.error("File appears to be empty — no data rows found");
          return;
        }
        setParsedFile(result);
        onFileParsed(result);
        toast.success(`Loaded ${result.rowCount} rows from ${result.fileName}`);
      } catch (err: any) {
        toast.error(err.message || "Failed to parse file");
      } finally {
        setParsing(false);
      }
    },
    [onFileParsed]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const clearFile = () => {
    setParsedFile(null);
  };

  if (parsedFile) {
    const isExcel = parsedFile.fileType === "excel";
    return (
      <div className="flex items-center gap-3 p-4 bg-card border border-primary/30 rounded-xl">
        {isExcel ? (
          <FileSpreadsheet className="w-8 h-8 text-green-500 flex-shrink-0" />
        ) : (
          <FileText className="w-8 h-8 text-primary flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{parsedFile.fileName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {parsedFile.rowCount} rows · {parsedFile.headers.length} columns detected
          </p>
        </div>
        <button
          onClick={clearFile}
          disabled={disabled}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none
        ${dragging
          ? "border-primary bg-primary/5 scale-[0.99]"
          : "border-border hover:border-primary/50 hover:bg-secondary/50"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={onInputChange}
        className="hidden"
        disabled={disabled}
      />

      {parsing ? (
        <>
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Parsing file...</p>
        </>
      ) : (
        <>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-primary/20" : "bg-secondary"}`}>
            <Upload className={`w-7 h-7 transition-colors ${dragging ? "text-primary" : "text-muted-foreground"}`} />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {dragging ? "Drop your file here" : "Upload CSV or Excel file"}
            </p>
            <p className="text-xs text-muted-foreground">
              Drag & drop or click to browse · .csv or .xlsx
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60 mt-1">
            <FileText className="w-3 h-3" />
            <span>.csv</span>
            <span>·</span>
            <FileSpreadsheet className="w-3 h-3" />
            <span>.xlsx</span>
          </div>
        </>
      )}
    </div>
  );
}