import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  HelpCircle,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { CsvExportSection } from "@/components/bulk/CsvExportSection";
import { CsvImportDropZone } from "@/components/bulk/CsvImportDropZone";
import { CsvImportPreviewTable } from "@/components/bulk/CsvImportPreviewTable";
import { CsvHelpDialog } from "@/components/csvHelpDialog";
import { JpText } from "@/components/JpText";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { useImportCsvDiff } from "@/hooks/useImportCsvDiff";

export const Route = createFileRoute("/(app)/settings/bulk")({
  component: BulkSettingsPage,
});

function BulkSettingsPage() {
  const router = useRouter();
  const { activeAccountId } = useAccount();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [completedStats, setCompletedStats] = useState<{
    created: number;
    updated: number;
  } | null>(null);

  const {
    isAnalyzing,
    isApplying,
    progress,
    diffItems,
    handleFileSelect,
    applyDiff,
    reset,
  } = useImportCsvDiff({
    accountId: activeAccountId || undefined,
  });

  const handleApplyWithStats = async (selectedIndices: Set<number>) => {
    const result = await applyDiff(selectedIndices);
    if (result) {
      setCompletedStats({
        created: result.createdCount,
        updated: result.updatedCount,
      });
    }
  };

  const handleResetAll = () => {
    reset();
    setCompletedStats(null);
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8 space-y-6">
      {/* ナビゲーションバー & パンくず */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
          <Link
            to="/settings"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            設定へ戻る
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">データ管理</span>
        </div>

        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-8 text-xs font-medium"
        >
          <Link to="/dashboard">ダッシュボードへ</Link>
        </Button>
      </div>

      {/* ページタイトル & ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Database className="h-5 w-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              データ管理（CSV）
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            登録されているサービス情報の手元への保存（CSVダウンロード）や、ファイルを使った一括登録・更新が行えます。
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsHelpOpen(true)}
          className="self-start sm:self-auto gap-1.5 text-xs h-9"
        >
          <HelpCircle className="h-4 w-4 text-orange-500" />
          書き方の説明・サンプル
        </Button>
      </div>

      {/* 完了画面 */}
      {completedStats ? (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-8 text-center space-y-5">
          <div className="h-16 w-16 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-lg sm:text-xl font-bold text-foreground">
              インポートが完了しました
            </h2>
            <JpText as="p" className="text-xs sm:text-sm text-muted-foreground">
              新しく <strong>{completedStats.created}</strong> 件を追加し、
              <strong>{completedStats.updated}</strong>{" "}
              件の登録内容を更新しました。
            </JpText>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              onClick={() => router.navigate({ to: "/dashboard" })}
              className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-5 h-9"
            >
              ダッシュボードで確認する
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleResetAll}
              className="text-xs h-9 gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              続けて取り込む
            </Button>
          </div>
        </div>
      ) : diffItems.length > 0 ? (
        /* 差分プレビュー画面 */
        <CsvImportPreviewTable
          diffItems={diffItems}
          isApplying={isApplying}
          onApply={handleApplyWithStats}
          onCancel={handleResetAll}
        />
      ) : (
        /* 通常画面: エクスポートセクション ＆ インポートドロップゾーン */
        <div className="space-y-8">
          {/* 1. エクスポートセクション */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground tracking-wider">
              1. ファイルへの書き出し（ダウンロード）
            </h2>
            <CsvExportSection />
          </section>

          {/* 2. インポートセクション */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground tracking-wider">
              2. ファイルの取り込み（まとめて登録・更新）
            </h2>
            <CsvImportDropZone
              isAnalyzing={isAnalyzing}
              progress={progress}
              onFileSelected={handleFileSelect}
              onOpenHelp={() => setIsHelpOpen(true)}
            />
          </section>
        </div>
      )}

      {/* CSV仕様ヘルプダイアログ */}
      <CsvHelpDialog open={isHelpOpen} onOpenChange={setIsHelpOpen} />
    </div>
  );
}
