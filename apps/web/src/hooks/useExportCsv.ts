import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/../convex/_generated/api";
import { usePasscode } from "@/components/PasscodeProvider";
import { useAccount } from "@/hooks/useAccount";
import { getClientRequestContext } from "@/services/security.functions";
import { sanitizeCsvValue } from "@/utils/csv-sanitize";
import { MAX_CREDENTIALS_PER_RECORD } from "@/utils/schemas";

export function useExportCsv() {
  const [isExporting, setIsExporting] = useState(false);
  const { masterKey, requireUnlock, decryptHint } = usePasscode();
  const { activeAccountId } = useAccount();
  const fetchRecordsForExport = useMutation(api.records.fetchRecordsForExport);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const context = await getClientRequestContext().catch(() => ({}));
      const records = await fetchRecordsForExport({
        accountId: activeAccountId || undefined,
        ...context,
      });

      // Convex レコードを CSV 行フォーマットに変換
      const data: Record<string, string>[] = records.map((record) => {
        const row: Record<string, string> = {
          Title: record.title,
          URL: record.url || "",
          Memo: record.memo || "",
          OwnerType: record.ownerType ?? "user",
          Admins: (record.adminEmails ?? []).join(", "),
          Tags: record.tags.join(","),
        };
        record.credentials.forEach((cred, i) => {
          const idx = i + 1;
          row[`Label${idx}`] = cred.label || "";
          row[`LoginID${idx}`] = cred.loginId || "";
          row[`PasswordHint${idx}`] = cred.passwordHint || "";
          row[`PasswordHintIv${idx}`] = cred.passwordHintIv || "";
          row[`PasswordHintDekEncrypted${idx}`] =
            cred.passwordHintDekEncrypted || "";
          row[`PasswordHintDekIv${idx}`] = cred.passwordHintDekIv || "";
        });
        return row;
      });

      // Check if there are any encrypted hints
      let hasEncryptedHints = false;
      for (const row of data) {
        for (let i = 1; i <= MAX_CREDENTIALS_PER_RECORD; i++) {
          if (row[`PasswordHint${i}`] && row[`PasswordHintIv${i}`]) {
            hasEncryptedHints = true;
            break;
          }
        }
        if (hasEncryptedHints) break;
      }

      if (hasEncryptedHints && !masterKey) {
        const unlocked = await requireUnlock();
        if (!unlocked) {
          setIsExporting(false);
          return;
        }
      }

      // Decrypt hints for export
      const decryptedData = await Promise.all(
        data.map(async (row) => {
          const newRow = { ...row };

          // サニタイズを適用
          for (const key of Object.keys(row)) {
            newRow[key] = sanitizeCsvValue(row[key]);
          }

          for (let i = 1; i <= MAX_CREDENTIALS_PER_RECORD; i++) {
            const hint = newRow[`PasswordHint${i}`];
            const iv = newRow[`PasswordHintIv${i}`];
            const dekEncrypted = newRow[`PasswordHintDekEncrypted${i}`];
            const dekIv = newRow[`PasswordHintDekIv${i}`];
            if (hint && iv) {
              try {
                const plainHint = await decryptHint(
                  hint,
                  iv,
                  dekEncrypted || undefined,
                  dekIv || undefined,
                );
                // サニタイズを適用
                newRow[`PasswordHint${i}`] = sanitizeCsvValue(plainHint);
              } catch (_e) {
                newRow[`PasswordHint${i}`] = "";
              }
            }
            // Remove IV and DEK fields from export
            delete newRow[`PasswordHintIv${i}`];
            delete newRow[`PasswordHintDekEncrypted${i}`];
            delete newRow[`PasswordHintDekIv${i}`];
          }
          return newRow;
        }),
      );

      const columns = ["Title", "URL", "Memo", "OwnerType", "Admins", "Tags"];
      for (let i = 1; i <= MAX_CREDENTIALS_PER_RECORD; i++) {
        columns.push(`Label${i}`, `LoginID${i}`, `PasswordHint${i}`);
      }

      const Papa = (await import("papaparse")).default;
      const csv = Papa.unparse(decryptedData, { columns });
      // Excelの文字化け対策としてBOM (UTF-8) を付与
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const blob = new Blob([bom, csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `poohma_export_${new Date().toISOString().split("T")[0]}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("データをエクスポートしました");
    } catch (_error) {
      toast.error("エクスポートに失敗しました");
    } finally {
      setIsExporting(false);
    }
  };

  return { handleExport, isExporting };
}
