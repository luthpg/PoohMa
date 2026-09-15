import {
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  UploadCloud,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { JpText } from "@/components/JpText";

interface CsvImportDropZoneProps {
  isAnalyzing: boolean;
  progress: { stage: string; current: number; total: number };
  onFileSelected: (file: File) => void;
  onOpenHelp: () => void;
}

export function CsvImportDropZone({
  isAnalyzing,
  progress,
  onFileSelected,
  onOpenHelp,
}: CsvImportDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAnalyzing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isAnalyzing) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        onFileSelected(file);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      onFileSelected(file);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* 隠しファイルインプット */}
      <input
        ref={fileInputRef}
        id="csv-bulk-file-input"
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        data-testid="csv-bulk-file-input"
        onChange={handleFileChange}
      />

      {/* ドロップゾーン（ネイティブ label によりクリックでファイル選択が自動起動） */}
      <label
        htmlFor="csv-bulk-file-input"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center p-8 sm:p-12 rounded-2xl border-2 border-dashed transition-all cursor-pointer select-none text-center ${
          isDragging
            ? "border-orange-500 bg-orange-500/10 scale-[1.01]"
            : "border-border/80 hover:border-orange-500/60 hover:bg-muted/40 bg-card"
        } ${isAnalyzing ? "opacity-75 pointer-events-none" : ""}`}
      >
        {isAnalyzing ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {progress.stage || "CSVファイルを解析中..."}
              </p>
              {progress.total > 0 && (
                <p className="text-xs text-muted-foreground font-mono">
                  {progress.current} / {progress.total} 件処理中
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 shadow-inner">
              <UploadCloud className="h-7 w-7" />
            </div>

            <div className="space-y-1.5 max-w-md">
              <h3 className="text-base sm:text-lg font-bold text-foreground">
                CSVファイルをドラッグ＆ドロップ
              </h3>
              <JpText
                as="p"
                className="text-xs sm:text-sm text-muted-foreground leading-relaxed"
              >
                または
                <span className="underline text-orange-500">
                  ここをクリックしてファイルを選択
                </span>
                <br />
                保存したCSVファイルを編集して、まとめて更新したり新しく登録できます。
              </JpText>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="inline-flex items-center justify-center rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs px-4 py-2 shadow-sm pointer-events-none">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                ファイルを選択する
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenHelp();
                }}
                className="inline-flex items-center justify-center rounded-md border border-border/80 bg-background hover:bg-accent text-xs px-3 py-2 cursor-pointer transition-colors"
              >
                <HelpCircle className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                書き方の説明・サンプル
              </button>
            </div>

            <JpText
              as="p"
              className="text-[11px] text-muted-foreground/80 mt-1"
            >
              ※
              1回につき最大500件まで取り込めます。空欄の項目は現在の登録内容がそのまま残ります。
            </JpText>
          </div>
        )}
      </label>
    </div>
  );
}
