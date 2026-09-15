import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { JpText } from "@/components/JpText";
import { Button } from "@/components/ui/button";
import { useExportCsv } from "@/hooks/useExportCsv";

export function CsvExportSection() {
  const { handleExport, isExporting } = useExportCsv();

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-orange-500 shrink-0" />
            <h3 className="text-base font-bold text-foreground">
              ファイルへの保存（エクスポート）
            </h3>
          </div>
          <JpText
            as="p"
            className="text-xs sm:text-sm text-muted-foreground leading-relaxed"
          >
            登録されているサービス名やログインIDなどの情報を、CSVファイルとして手元に保存できます。
            出力されたファイルには管理用の識別コード（RecordId,
            CredentialId）が含まれており、手元で編集して取り込むことで登録内容を一括更新できます。
          </JpText>
        </div>

        <Button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="bg-foreground text-background hover:bg-foreground/90 font-semibold text-xs px-5 h-9 shrink-0 gap-2 cursor-pointer shadow"
        >
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              CSVをダウンロード
            </>
          )}
        </Button>
      </div>

      <div className="rounded-xl bg-muted/60 p-3 text-[11px] text-muted-foreground space-y-1 border border-border/50">
        <p className="font-semibold text-foreground">
          ※ ご利用にあたっての確認事項
        </p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <JpText>
              「パスワードのヒント」もダウンロードファイルに含まれますので、取り扱いにはご注意ください。
            </JpText>
          </li>
          <li>
            <JpText>
              RecordId 列や CredentialId
              列の番号をそのまま残して編集することで、登録済みのサービス名やメモなどの内容をスムーズに更新できます。
            </JpText>
          </li>
        </ul>
      </div>
    </div>
  );
}
