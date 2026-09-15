import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JpText } from "@/components/JpText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DiffItem } from "@/hooks/useImportCsvDiff";

interface CsvImportPreviewTableProps {
  diffItems: DiffItem[];
  isApplying: boolean;
  onApply: (selectedIndices: Set<number>) => Promise<void>;
  onCancel: () => void;
}

type FilterTab = "ALL" | "CREATE" | "UPDATE" | "SKIP" | "ERROR";

export function CsvImportPreviewTable({
  diffItems,
  isApplying,
  onApply,
  onCancel,
}: CsvImportPreviewTableProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");
  const [skipErrorsToggle, setSkipErrorsToggle] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // 行単位の選択状態（初期値: CREATE/UPDATEはON、SKIP/ERRORはOFF）
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    for (const item of diffItems) {
      if (item.action === "CREATE" || item.action === "UPDATE") {
        initial.add(item.index);
      }
    }
    return initial;
  });

  // diffItems が更新された場合に選択状態を再初期化
  useEffect(() => {
    const initial = new Set<number>();
    for (const item of diffItems) {
      if (item.action === "CREATE" || item.action === "UPDATE") {
        initial.add(item.index);
      }
    }
    setSelectedIndices(initial);
  }, [diffItems]);

  // 集計カウント
  const counts = useMemo(() => {
    let create = 0;
    let update = 0;
    let skip = 0;
    let error = 0;
    for (const item of diffItems) {
      if (item.action === "CREATE") create++;
      else if (item.action === "UPDATE") update++;
      else if (item.action === "SKIP") skip++;
      else if (item.action === "ERROR") error++;
    }
    return { create, update, skip, error, total: diffItems.length };
  }, [diffItems]);

  // タブ別フィルタリング
  const filteredItems = useMemo(() => {
    if (activeTab === "ALL") return diffItems;
    return diffItems.filter((item) => item.action === activeTab);
  }, [diffItems, activeTab]);

  // 仮想スクロール設定
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = filteredItems[index];
      if (item && expandedRows.has(item.index)) {
        const changeCount = item.changes?.length ?? 0;
        // 基本行: 41px, 展開コンテナ: 17px, 各変更行: 26px - 最終行マージン: 6px
        return 41 + 17 + Math.max(1, changeCount) * 26 - 6;
      }
      return 42;
    },
    overscan: 10,
    getItemKey: (index) => {
      const item = filteredItems[index];
      if (!item) return index;
      const isExpanded = expandedRows.has(item.index);
      return `${item.action}-${item.index}-${isExpanded ? "open" : "closed"}`;
    },
    initialRect: { width: 1000, height: 500 },
  });

  // 初回マウント時、アイテム変更時、および展開状態変更時にサイズを再測定
  useEffect(() => {
    void filteredItems;
    void expandedRows;
    virtualizer.measure();
  }, [virtualizer, filteredItems, expandedRows]);

  // フィルタタブ切り替え時にスクロール位置をリセット
  const handleTabChange = (tab: FilterTab) => {
    setActiveTab(tab);
    virtualizer.scrollToOffset(0);
    requestAnimationFrame(() => {
      virtualizer.measure();
    });
  };

  const toggleSelect = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback(
    (index: number) => {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
      requestAnimationFrame(() => {
        virtualizer.measure();
      });
    },
    [virtualizer],
  );

  // 一括選択 / 一括解除
  const handleSelectAll = () => {
    const next = new Set<number>();
    for (const item of diffItems) {
      if (item.action === "CREATE" || item.action === "UPDATE") {
        next.add(item.index);
      }
    }
    setSelectedIndices(next);
  };

  const handleDeselectAll = () => {
    setSelectedIndices(new Set());
  };

  // 反映可能かどうかの判定
  const hasErrors = counts.error > 0;
  const canApply =
    selectedIndices.size > 0 && (!hasErrors || skipErrorsToggle) && !isApplying;

  const handleApplyClick = async () => {
    if (!canApply) return;
    // エラートグルONの場合は、選択されているインデックスのうちERROR行を除外
    const finalIndices = new Set<number>();
    for (const idx of selectedIndices) {
      const item = diffItems[idx];
      if (item && item.action !== "ERROR") {
        finalIndices.add(idx);
      }
    }
    await onApply(finalIndices);
  };

  return (
    <div
      data-testid="csv-import-preview-container"
      className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-4"
    >
      {/* プレビューヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-orange-500 shrink-0" />
            <h3 className="text-base sm:text-lg font-bold text-foreground">
              取り込み内容の確認
            </h3>
          </div>
          <JpText
            as="p"
            className="text-xs sm:text-sm text-muted-foreground mt-0.5"
          >
            ファイルの内容を確認しました。更新または新しく追加する内容を確認して、反映してください。
          </JpText>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isApplying}
            className="text-xs h-9"
          >
            やり直す
          </Button>
          <Button
            type="button"
            data-testid="apply-import-diff-button"
            disabled={!canApply}
            onClick={handleApplyClick}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs font-semibold px-5 h-9 cursor-pointer shadow"
          >
            {isApplying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                選択した {selectedIndices.size} 件を登録・更新する
              </>
            )}
          </Button>
        </div>
      </div>

      {/* サマリーカード & カテゴリフィルタ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 py-1">
        {/* モバイルで横スクロール、PCで通常表示 */}
        <div className="flex items-center gap-1.5 text-xs overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1 scrollbar-none">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleTabChange("ALL")}
            className={`h-7 text-xs px-3 rounded-full cursor-pointer transition-colors shrink-0 ${
              activeTab === "ALL"
                ? "bg-foreground text-background hover:bg-foreground/90 font-semibold border-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            すべて ({counts.total})
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleTabChange("CREATE")}
            className={`h-7 text-xs px-3 rounded-full cursor-pointer transition-colors shrink-0 ${
              activeTab === "CREATE"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-sm font-semibold"
                : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50"
            }`}
          >
            新規追加 ({counts.create})
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleTabChange("UPDATE")}
            className={`h-7 text-xs px-3 rounded-full cursor-pointer transition-colors shrink-0 ${
              activeTab === "UPDATE"
                ? "bg-sky-600 hover:bg-sky-700 text-white border-sky-600 shadow-sm font-semibold"
                : "border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:bg-sky-950/30 dark:hover:bg-sky-900/50"
            }`}
          >
            内容を変更 ({counts.update})
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleTabChange("SKIP")}
            className={`h-7 text-xs px-3 rounded-full cursor-pointer transition-colors shrink-0 ${
              activeTab === "SKIP"
                ? "bg-muted-foreground text-background hover:bg-muted-foreground/90 font-semibold border-muted-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            変更なし ({counts.skip})
          </Button>
          {counts.error > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleTabChange("ERROR")}
              className={`h-7 text-xs px-3 rounded-full cursor-pointer transition-colors shrink-0 ${
                activeTab === "ERROR"
                  ? "bg-red-600 hover:bg-red-700 text-white border-red-600 dark:bg-red-600 dark:hover:bg-red-500 shadow-sm font-semibold"
                  : "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:bg-red-950/50 dark:hover:bg-red-900/70"
              }`}
            >
              エラー ({counts.error})
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground shrink-0 sm:ml-auto">
          <span>
            反映対象: <strong>{selectedIndices.size}</strong> 件
          </span>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={handleSelectAll}
            className="hover:text-foreground text-xs underline cursor-pointer"
          >
            全選択
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={handleDeselectAll}
            className="hover:text-foreground text-xs underline cursor-pointer"
          >
            全解除
          </button>
        </div>
      </div>

      {/* エラーアラート & スキップトグル */}
      {hasErrors && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 dark:bg-red-950/30 dark:border-red-800/60 shrink-0 space-y-2 text-xs">
          <div className="flex items-start gap-2 text-red-700 dark:text-red-300 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <div className="flex-1">
              <span>{counts.error} 件のエラー行が見つかりました。</span>
              <JpText
                as="p"
                className="text-[11px] text-red-600/90 dark:text-red-300/80 font-normal mt-0.5"
              >
                識別番号が重複している、または登録が見つからない行は反映できません。
              </JpText>
            </div>
          </div>
          <label className="flex items-center gap-2 pt-1 border-t border-red-500/15 dark:border-red-800/40 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipErrorsToggle}
              onChange={(e) => setSkipErrorsToggle(e.target.checked)}
              className="h-4 w-4 rounded border-red-400 text-red-600 focus:ring-red-500/30 dark:border-red-700 cursor-pointer"
            />
            <span className="font-semibold text-foreground text-xs">
              エラーの行を除いて、正常な項目だけを登録・更新する
            </span>
          </label>
        </div>
      )}

      {/* 単一スクロールコンテナ: ヘッダーと行が完全同一の横スクロール軸を共有 */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div
          ref={parentRef}
          className="overflow-x-auto overflow-y-auto min-h-[400px] h-[520px] max-h-[64vh] relative"
        >
          {/* minWidth を設定した一体型ラッパー */}
          <div className="min-w-[850px] w-full relative">
            {/* sticky top-0 ヘッダー（横スクロール時はボディと完全に一致してスクロール） */}
            <div className="sticky top-0 z-10 flex items-center px-4 py-3 bg-muted/95 backdrop-blur border-b border-border text-xs font-semibold text-muted-foreground shadow-sm select-none">
              <div className="w-12 text-center shrink-0">反映</div>
              <div className="w-16 text-center shrink-0">行</div>
              <div className="w-28 shrink-0">状態</div>
              <div className="w-60 shrink-0">サービス名</div>
              <div className="flex-1 min-w-[280px]">変更内容</div>
            </div>

            {/* 仮想スクロール行リスト */}
            {filteredItems.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                表示対象の項目はありません
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const item = filteredItems[virtualRow.index];
                  const isSelected = selectedIndices.has(item.index);
                  const isExpanded = expandedRows.has(item.index);

                  return (
                    <div
                      key={virtualRow.key}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <DiffRow
                        item={item}
                        isSelected={isSelected}
                        isExpanded={isExpanded}
                        onToggleSelect={toggleSelect}
                        onToggleExpand={toggleExpand}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DiffRowProps {
  item: DiffItem;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: (index: number) => void;
  onToggleExpand: (index: number) => void;
}

const DiffRow = memo(function DiffRow({
  item,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: DiffRowProps) {
  const isError = item.action === "ERROR";
  const isSkip = item.action === "SKIP";
  const hasWarnings = item.warnings && item.warnings.length > 0;
  const hasChanges = (item.changes && item.changes.length > 0) || hasWarnings;

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // チェックボックスやボタンのクリック時は行クリックのアコーディオン開閉を行わない
    if (target.closest('input[type="checkbox"]') || target.closest("button")) {
      return;
    }
    if (hasChanges) {
      onToggleExpand(item.index);
    }
  };

  return (
    <div
      className={`border-b border-border/60 transition-colors ${
        isSelected
          ? "bg-orange-500/5 dark:bg-orange-500/10"
          : isError
            ? "bg-red-500/5 dark:bg-red-950/20"
            : "hover:bg-muted/30"
      }`}
    >
      {/* 行ヘッダーサマリー: チェックボックス以外のクリックで詳細開閉 */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 行全体をクリック可能にするプログレッシブエンハンスメント */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: キーボード操作は右端のボタンおよびチェックボックスで担保 */}
      <div
        className={`flex items-center px-4 py-2.5 text-xs select-none transition-colors ${
          hasChanges ? "cursor-pointer hover:bg-muted/40" : ""
        }`}
        onClick={handleRowClick}
      >
        {/* 反映チェックボックス */}
        <div className="w-12 text-center shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={isError || isSkip}
            onChange={() => onToggleSelect(item.index)}
            aria-label={`行 ${item.csvRow} を反映対象に含める`}
            className="h-4 w-4 rounded border-border/80 text-orange-500 focus:ring-orange-500/30 disabled:opacity-30 cursor-pointer"
          />
        </div>

        {/* 行番号 */}
        <div className="w-16 text-center shrink-0 font-mono text-[11px] text-muted-foreground">
          #{item.csvRow}
        </div>

        {/* 判定バッジ */}
        <div className="w-28 shrink-0">
          <DiffBadge action={item.action} />
        </div>

        {/* サービス名 */}
        <div
          className="w-60 shrink-0 font-medium truncate pr-3"
          title={item.title}
        >
          {item.title}
        </div>

        {/* 変更サマリー or エラー理由 */}
        <div className="flex-1 min-w-[280px] flex items-center justify-between gap-2">
          {isError ? (
            <span className="text-red-600 dark:text-red-300 font-medium flex items-center gap-1 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
              {item.errorReason}
            </span>
          ) : isSkip && !hasWarnings ? (
            <span className="text-muted-foreground text-[11px]">変更なし</span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasWarnings && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-center gap-1"
                >
                  <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                  警告あり
                </Badge>
              )}
              {item.changedFields.map((field) => (
                <Badge
                  key={field}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 font-normal bg-muted text-muted-foreground"
                >
                  {field}
                </Badge>
              ))}
            </div>
          )}

          {/* アコーディオン展開トグル */}
          {hasChanges && (
            <button
              type="button"
              onClick={() => onToggleExpand(item.index)}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
              aria-label="変更詳細を展開"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* 展開時: 警告コールアウト & Before / After 変更詳細リスト */}
      {isExpanded && hasChanges && (
        <div className="px-4 pb-3 pt-1 bg-muted/20 border-t border-border/40 text-xs space-y-2">
          {hasWarnings && (
            <div className="space-y-1 ml-28">
              {item.warnings?.map((warn) => (
                <div
                  key={warn}
                  className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-[11px] leading-relaxed"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}
          {item.changes && item.changes.length > 0 && (
            <div className="space-y-1.5 ml-28">
              {item.changes.map((change) => (
                <div
                  key={change.field}
                  className="flex items-center gap-2 text-[11px] py-0.5"
                >
                  <span className="w-32 text-muted-foreground font-mono truncate">
                    {change.field}:
                  </span>
                  <div className="flex items-center gap-2 flex-1">
                    <span
                      className="text-muted-foreground/80 line-through truncate max-w-[45%]"
                      title={change.before}
                    >
                      {change.before || "(未設定)"}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-orange-500" />
                    <span
                      className="font-semibold text-foreground truncate max-w-[45%]"
                      title={change.after}
                    >
                      {change.after || "(未設定)"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function DiffBadge({ action }: { action: DiffItem["action"] }) {
  switch (action) {
    case "CREATE":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
          新規追加
        </span>
      );
    case "UPDATE":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400 shrink-0" />
          内容を変更
        </span>
      );
    case "SKIP":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-muted/60 text-muted-foreground border-border/80 dark:bg-muted/40 dark:text-muted-foreground dark:border-border/80 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
          変更なし
        </span>
      );
    case "ERROR":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-200 dark:border-red-800 shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-red-400 shrink-0" />
          エラー
        </span>
      );
  }
}
