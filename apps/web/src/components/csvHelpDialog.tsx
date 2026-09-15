import { Download, FileText, Info, ShieldCheck } from "lucide-react";
import type React from "react";
import { JpText } from "@/components/JpText";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MAX_CREDENTIALS_PER_RECORD } from "@/utils/schemas";

interface CsvHelpDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const IMPORT_RULES = [
  {
    recordId: "空欄 または 列なし",
    badgeText: "新規追加",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80",
    dotClass: "bg-emerald-500 dark:bg-emerald-400",
    description: "新しいサービスとして新しく登録されます",
  },
  {
    recordId: "登録済みの番号と同じ",
    badgeText: "内容を変更",
    badgeClass:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80",
    dotClass: "bg-sky-500 dark:bg-sky-400",
    description: "変更があった項目だけが更新されます（空欄は元のまま残ります）",
  },
  {
    recordId: "存在しない番号",
    badgeText: "エラー",
    badgeClass:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-200 dark:border-red-800",
    dotClass: "bg-red-500 dark:bg-red-400",
    description: "登録されていない番号のため、この行は反映されません",
  },
] as const;

function RuleBadge({
  text,
  badgeClass,
  dotClass,
}: {
  text: string;
  badgeClass: string;
  dotClass: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border shadow-xs shrink-0 ${badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      {text}
    </span>
  );
}

export function CsvHelpDialog({
  trigger,
  open,
  onOpenChange,
}: CsvHelpDialogProps) {
  const handleDownloadSample = () => {
    const columns = [
      "RecordId",
      "Title",
      "URL",
      "Memo",
      "OwnerType",
      "Admins",
      "Tags",
    ];
    for (let i = 1; i <= MAX_CREDENTIALS_PER_RECORD; i++) {
      columns.push(
        `CredentialId${i}`,
        `Label${i}`,
        `LoginID${i}`,
        `PasswordHint${i}`,
      );
    }

    // サンプル行データの構築
    const sampleRow1: Record<string, string> = {
      RecordId: "", // 空の場合は新規登録 (CREATE)
      Title: "サンプルサービス (新規追加例)",
      URL: "https://example.com/login",
      Memo: "月額サブスクリプション",
      OwnerType: "family",
      Admins: "admin@example.com",
      Tags: "生活,サブスク",
      CredentialId1: "",
      Label1: "メインアカウント",
      LoginID1: "sample_user@example.com",
      PasswordHint1: "ペットの名前と誕生年",
      CredentialId2: "",
      Label2: "予備アカウント",
      LoginID2: "sub_user@example.com",
      PasswordHint2: "初恋の人のイニシャル",
    };

    const sampleRow2: Record<string, string> = {
      RecordId: "550e8400-e29b-41d4-a716-446655440000", // 既存ID指定で更新 (UPDATE)
      Title: "サンプルサービス (差分更新例)",
      URL: "https://example.com/updated",
      Memo: "プラン変更済み",
      OwnerType: "user",
      Admins: "",
      Tags: "個人,金融",
      CredentialId1: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      Label1: "更新後ラベル",
      LoginID1: "updated_login@example.com",
      PasswordHint1: "", // 空文字の場合は既存のパスワードヒントを維持 (SKIP)
    };

    const buildCsvLine = (row: Record<string, string>) => {
      return columns
        .map((col) => {
          const val = row[col] || "";
          if (val.includes(",") || val.includes('"') || val.includes("\n")) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(",");
    };

    const csvContent = [
      columns.join(","),
      buildCsvLine(sampleRow1),
      buildCsvLine(sampleRow2),
    ].join("\r\n");

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "poohma_sample_full.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="w-[95vw] sm:max-w-3xl md:max-w-4xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-orange-500 shrink-0" />
            <DialogTitle className="text-base sm:text-lg font-bold">
              CSVファイルの使い方とルール
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <JpText as="p" className="text-xs sm:text-sm text-muted-foreground">
              ファイルを保存して編集する際のルールや、登録・更新の仕組みについて確認できます。
            </JpText>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-xs sm:text-sm pt-2">
          {/* サンプルダウンロードボタン */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-orange-500" />
                <span>全項目対応のサンプルCSV</span>
              </div>
              <JpText
                as="p"
                className="text-[11px] sm:text-xs text-muted-foreground"
              >
                最大10個までのアカウント情報を記入できるテンプレートファイル
              </JpText>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadSample}
              className="gap-1.5 border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 shrink-0 w-full sm:w-auto"
            >
              <Download className="h-3.5 w-3.5" />
              <span>サンプルCSVをダウンロード</span>
            </Button>
          </div>

          {/* 差分判定ルール */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground flex items-center gap-1.5 text-xs sm:text-sm">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              <span>取り込み時の判定ルール</span>
            </h4>

            {/* モバイル向けカード表示 (sm:hidden) */}
            <div className="space-y-2 sm:hidden">
              {IMPORT_RULES.map((rule) => (
                <div
                  key={rule.recordId}
                  className="p-3 rounded-xl border border-border bg-muted/30 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                        RecordId:
                      </span>
                      <span className="font-mono text-[11px] font-medium text-foreground truncate">
                        {rule.recordId}
                      </span>
                    </div>
                    <RuleBadge
                      text={rule.badgeText}
                      badgeClass={rule.badgeClass}
                      dotClass={rule.dotClass}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground pt-0.5">
                    <JpText>{rule.description}</JpText>
                  </p>
                </div>
              ))}
            </div>

            {/* デスクトップ向けテーブル表示 (hidden sm:block) */}
            <div className="hidden sm:block rounded-lg border border-border overflow-x-auto text-xs">
              <table className="w-full border-collapse min-w-[500px]">
                <thead>
                  <tr className="bg-muted/60 border-b border-border text-left">
                    <th className="p-2.5 sm:p-3 font-medium">
                      RecordId（識別番号）
                    </th>
                    <th className="p-2.5 sm:p-3 font-medium w-28 sm:w-32">
                      判定
                    </th>
                    <th className="p-2.5 sm:p-3 font-medium">どうなるか</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {IMPORT_RULES.map((rule) => (
                    <tr key={rule.recordId}>
                      <td className="p-2.5 sm:p-3 font-mono text-[11px]">
                        {rule.recordId}
                      </td>
                      <td className="p-2.5 sm:p-3">
                        <RuleBadge
                          text={rule.badgeText}
                          badgeClass={rule.badgeClass}
                          dotClass={rule.dotClass}
                        />
                      </td>
                      <td className="p-2.5 sm:p-3 text-muted-foreground">
                        <JpText>{rule.description}</JpText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 重要注意事項 */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground text-xs sm:text-sm">
              大切なデータ保護の仕組み
            </h4>
            <ul className="list-disc list-outside pl-4 space-y-1 text-muted-foreground text-[11px] sm:text-xs">
              <li>
                <strong className="text-foreground">
                  空欄の項目はそのまま残ります:
                </strong>{" "}
                <JpText>
                  CSVで空欄になっている項目は、今登録されている情報が消えることなくそのまま維持されます。
                </JpText>
              </li>
              <li>
                <strong className="text-foreground">
                  パスワードのヒントの保護:
                </strong>{" "}
                <JpText>
                  CSVにヒントを入力すると、お使いの端末内で自動的に暗号化されて安全に保存されます。空欄にしておけば現在のヒントが維持されます。
                </JpText>
              </li>
              <li>
                <strong className="text-foreground">列の順番は自由です:</strong>{" "}
                <JpText>
                  1行目の項目名で自動判別するため、表計算ソフト等で列の順番が入れ替わっていても問題なく読み込めます。
                </JpText>
              </li>
              <li>
                <strong className="text-foreground">
                  行を消しても削除はされません:
                </strong>{" "}
                <JpText>
                  誤って大切なデータを消してしまうのを防ぐため、CSV上から行やアカウントを消しても、アプリ内のデータは削除されません。削除はアプリ画面から個別に行ってください。
                </JpText>
              </li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
