import { useConvex, useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { usePasscode } from "@/components/PasscodeProvider";
import { processInChunks } from "@/utils/chunk-processor";
import { MAX_CREDENTIALS_PER_RECORD } from "@/utils/schemas";

export type DiffAction = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface RecordCreatePayload {
  title: string;
  titleReading?: string;
  url?: string;
  ogpImage?: string;
  ogpDescription?: string;
  memo?: string;
  ownerType?: "user" | "family";
  adminEmails?: string[];
  tags: string[];
  credentials: Array<{
    id?: string;
    label?: string;
    loginId?: string;
    passwordHint?: string;
    passwordHintIv?: string;
    passwordHintDekEncrypted?: string;
    passwordHintDekIv?: string;
  }>;
}

export interface RecordUpdatePayload {
  stableId: string;
  title?: string;
  titleReading?: string;
  url?: string;
  memo?: string;
  ownerType?: "user" | "family";
  adminEmails?: string[];
  tags?: string[];
  credentials: Array<{
    stableId?: string;
    label?: string;
    loginId?: string;
    passwordHint?: string;
    passwordHintIv?: string;
    passwordHintDekEncrypted?: string;
    passwordHintDekIv?: string;
  }>;
}

export interface DiffItem {
  index: number;
  csvRow: number;
  action: DiffAction;
  title: string;
  stableId?: string;
  changedFields: string[];
  changes: FieldChange[];
  errorReason?: string;
  warnings?: string[];
  createPayload?: RecordCreatePayload;
  updatePayload?: RecordUpdatePayload;
}

export interface UseImportCsvDiffOptions {
  accountId?: Id<"users">;
}

const IMPORT_TOAST_ID = "csv-import-progress";
const APPLY_TOAST_ID = "csv-apply-progress";

export function useImportCsvDiff(options?: UseImportCsvDiffOptions) {
  const accountId = options?.accountId;
  const convex = useConvex();
  const applyImportDiffMutation = useMutation(api.records.applyImportDiff);
  const { masterKey, requireUnlock, encryptHint } = usePasscode();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [progress, setProgress] = useState<{
    stage: string;
    current: number;
    total: number;
  }>({
    stage: "",
    current: 0,
    total: 0,
  });
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const reset = useCallback(() => {
    setDiffItems([]);
    setIsAnalyzing(false);
    setIsApplying(false);
    setProgress({ stage: "", current: 0, total: 0 });
    setIsPreviewOpen(false);
  }, []);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setIsAnalyzing(true);
      setProgress({ stage: "CSVをパース中...", current: 0, total: 0 });
      toast.loading("CSVファイルを解析中...", { id: IMPORT_TOAST_ID });

      try {
        const Papa = (await import("papaparse")).default;
        const parseResult = await new Promise<
          Papa.ParseResult<Record<string, string>>
        >((resolve, reject) => {
          Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: resolve,
            error: reject,
          });
        });

        const data = parseResult.data;
        const fatalParseError = parseResult.errors?.find(
          (error) => error.type === "Quotes" || error.type === "FieldMismatch",
        );
        if (fatalParseError) {
          toast.error(`CSVの形式が不正です: ${fatalParseError.message}`, {
            id: IMPORT_TOAST_ID,
          });
          setIsAnalyzing(false);
          return;
        }

        if (!data || data.length === 0) {
          toast.error("CSVファイルにデータが含まれていません。", {
            id: IMPORT_TOAST_ID,
          });
          setIsAnalyzing(false);
          return;
        }

        if (data.length > 500) {
          toast.error(
            "一度にインポートできるデータは最大500行までです。ファイルを分割して再度お試しください。",
            { id: IMPORT_TOAST_ID },
          );
          setIsAnalyzing(false);
          return;
        }

        // 早期バリデーション (Fail Fast)
        const isOversized = data.some((row) =>
          Object.values(row).some((val) => val && val.length > 10000),
        );
        if (isOversized) {
          toast.error(
            "文字数が上限（10,000文字）を超えているフィールドが含まれています。",
            { id: IMPORT_TOAST_ID },
          );
          setIsAnalyzing(false);
          return;
        }

        // 必須列の検証
        const headers = parseResult.meta.fields || [];
        if (!headers.includes("Title")) {
          toast.error(
            "必須列「Title」が見つかりません。ヘッダー名を確認してください。",
            { id: IMPORT_TOAST_ID },
          );
          setIsAnalyzing(false);
          return;
        }

        setProgress({
          stage: "データベースと突合中...",
          current: 0,
          total: data.length,
        });
        toast.loading("既存データと照合中...", { id: IMPORT_TOAST_ID });

        // 既存レコードの軽量一覧を取得
        const existingRecords = await convex.query(
          api.records.getRecordsForDiffImport,
          accountId ? { accountId } : {},
        );
        const recordByStableId = new Map(
          existingRecords
            .filter((r) => !!r.stableId)
            .map((r) => [r.stableId, r]),
        );

        // 家族メンバー一覧を取得（共有レコードの管理者メール照合用）
        const familyInfo = await convex.query(
          api.families.getFamilyMembers,
          {},
        );
        const familyMemberEmails = new Set(
          (familyInfo?.users || [])
            .map((u) => u.email?.toLowerCase().trim())
            .filter((e): e is string => !!e),
        );

        const checkAdminWarnings = (rawAdmins?: string): string[] => {
          if (!rawAdmins || familyMemberEmails.size === 0) return [];
          const emails = rawAdmins
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
          const invalidEmails = emails.filter(
            (e) => !familyMemberEmails.has(e.toLowerCase()),
          );
          if (invalidEmails.length > 0) {
            return [
              `家族外メンバー (${invalidEmails.join(", ")}) は管理者から除外され、あなたが管理者として登録されます`,
            ];
          }
          return [];
        };

        // RecordId 重複追跡用 Set
        const seenRecordIdsInCsv = new Map<string, number>(); // stableId -> firstCsvRow
        const preliminaryItems: DiffItem[] = [];

        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const csvRow = i + 2; // ヘッダー行を1行目としたときの行番号
          const recordId = (row.RecordId || "").trim();
          const title = (row.Title || "").trim();

          // 1. Title が空の場合はエラー
          if (!title && !recordId) {
            preliminaryItems.push({
              index: i,
              csvRow,
              action: "ERROR",
              title: "(タイトル未入力)",
              changedFields: [],
              changes: [],
              errorReason: "Title（サービス名）が入力されていません",
            });
            continue;
          }

          // 2. 新規作成 (CREATE)
          if (!recordId) {
            const isFamily =
              (row.OwnerType || "").trim().toLowerCase() === "family";
            const warnings = isFamily ? checkAdminWarnings(row.Admins) : [];
            preliminaryItems.push({
              index: i,
              csvRow,
              action: "CREATE",
              title: title || "(無題)",
              changedFields: ["Title"],
              changes: [
                {
                  field: "title",
                  label: "新規作成",
                  before: "(未登録)",
                  after: title,
                },
              ],
              warnings: warnings.length > 0 ? warnings : undefined,
            });
            continue;
          }

          // 3. 重複チェック
          const prevRow = seenRecordIdsInCsv.get(recordId);
          if (prevRow !== undefined) {
            preliminaryItems.push({
              index: i,
              csvRow,
              action: "ERROR",
              title: title || "(無題)",
              stableId: recordId,
              changedFields: [],
              changes: [],
              errorReason: `CSV内で RecordId が重複しています（行 ${prevRow} と重複）`,
            });
            continue;
          }
          seenRecordIdsInCsv.set(recordId, csvRow);

          // 4. DB存在チェック
          const existing = recordByStableId.get(recordId);
          if (!existing) {
            preliminaryItems.push({
              index: i,
              csvRow,
              action: "ERROR",
              title: title || "(無題)",
              stableId: recordId,
              changedFields: [],
              changes: [],
              errorReason: `指定された RecordId (${recordId}) のデータが見つかりません`,
            });
            continue;
          }

          // 5. クレデンシャル整合性チェック & 差分比較
          const credByStableId = new Map(
            existing.credentials
              .filter((c) => !!c.stableId)
              .map((c) => [c.stableId, c]),
          );

          let credError: string | undefined;
          let newCredCount = 0;
          for (let cIdx = 1; cIdx <= MAX_CREDENTIALS_PER_RECORD; cIdx++) {
            const credId = (row[`CredentialId${cIdx}`] || "").trim();
            if (credId && !credByStableId.has(credId)) {
              credError = `CredentialId${cIdx} (${credId}) がこのレコードに属していません`;
              break;
            }
            if (!credId) {
              const label = (row[`Label${cIdx}`] || "").trim();
              const loginId = (row[`LoginID${cIdx}`] || "").trim();
              const hint = (row[`PasswordHint${cIdx}`] || "").trim();
              if (label || loginId || hint) {
                newCredCount++;
              }
            }
          }

          if (
            !credError &&
            existing.credentials.length + newCredCount >
              MAX_CREDENTIALS_PER_RECORD
          ) {
            credError = `アカウント情報は最大${MAX_CREDENTIALS_PER_RECORD}件までです（既存 ${existing.credentials.length} 件 + 新規 ${newCredCount} 件）`;
          }

          if (credError) {
            preliminaryItems.push({
              index: i,
              csvRow,
              action: "ERROR",
              title: title || existing.title,
              stableId: recordId,
              changedFields: [],
              changes: [],
              errorReason: credError,
            });
            continue;
          }

          // 6. 各フィールドの差分抽出 (空セルは既存維持)
          const changes: FieldChange[] = [];
          const changedFields: string[] = [];

          if (title && title !== existing.title) {
            changes.push({
              field: "title",
              label: "タイトル",
              before: existing.title,
              after: title,
            });
            changedFields.push("Title");
          }

          const url = (row.URL || "").trim();
          if (url && url !== (existing.url || "")) {
            changes.push({
              field: "url",
              label: "URL",
              before: existing.url || "(空)",
              after: url,
            });
            changedFields.push("URL");
          }

          const memo = (row.Memo || "").trim();
          if (memo && memo !== (existing.memo || "")) {
            changes.push({
              field: "memo",
              label: "メモ",
              before: existing.memo || "(空)",
              after: memo,
            });
            changedFields.push("Memo");
          }

          const ownerType = (row.OwnerType || "").trim().toLowerCase();
          if (
            (ownerType === "user" || ownerType === "family") &&
            ownerType !== (existing.ownerType || "user")
          ) {
            changes.push({
              field: "ownerType",
              label: "管理タイプ",
              before: existing.ownerType || "user",
              after: ownerType,
            });
            changedFields.push("OwnerType");
          }

          const tagsStr = (row.Tags || "").trim();
          if (tagsStr) {
            const newTags = tagsStr
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            const currentTags = existing.tags || [];
            if (newTags.join(",") !== currentTags.join(",")) {
              changes.push({
                field: "tags",
                label: "タグ",
                before: currentTags.join(", ") || "(なし)",
                after: newTags.join(", "),
              });
              changedFields.push("Tags");
            }
          }

          const adminsStr = (row.Admins || "").trim();
          if (adminsStr) {
            const newAdmins = adminsStr
              .split(",")
              .map((a) => a.trim().toLowerCase())
              .filter(Boolean);
            const currentAdmins = (existing.adminEmails || []).map((a) =>
              a.toLowerCase(),
            );
            if (newAdmins.sort().join(",") !== currentAdmins.sort().join(",")) {
              changes.push({
                field: "adminEmails",
                label: "管理者",
                before: currentAdmins.join(", ") || "(なし)",
                after: newAdmins.join(", "),
              });
              changedFields.push("Admins");
            }
          }

          // クレデンシャルの差分
          for (let cIdx = 1; cIdx <= MAX_CREDENTIALS_PER_RECORD; cIdx++) {
            const credId = (row[`CredentialId${cIdx}`] || "").trim();
            const label = (row[`Label${cIdx}`] || "").trim();
            const loginId = (row[`LoginID${cIdx}`] || "").trim();
            const hint = (row[`PasswordHint${cIdx}`] || "").trim();

            if (credId) {
              const existingCred = credByStableId.get(credId);
              if (!existingCred) continue;
              if (label && label !== (existingCred.label || "")) {
                changes.push({
                  field: `label_${cIdx}`,
                  label: `アカウント${cIdx} ラベル`,
                  before: existingCred.label || "(空)",
                  after: label,
                });
                changedFields.push(`Label${cIdx}`);
              }
              if (loginId && loginId !== (existingCred.loginId || "")) {
                changes.push({
                  field: `loginId_${cIdx}`,
                  label: `アカウント${cIdx} ログインID`,
                  before: existingCred.loginId || "(空)",
                  after: loginId,
                });
                changedFields.push(`LoginID${cIdx}`);
              }
              if (hint) {
                changes.push({
                  field: `hint_${cIdx}`,
                  label: `アカウント${cIdx} ヒント`,
                  before: existingCred.hasPasswordHint
                    ? "(登録済み)"
                    : "(未設定)",
                  after: "(更新・再暗号化)",
                });
                changedFields.push(`PasswordHint${cIdx}`);
              }
            } else if (label || loginId || hint) {
              // 新規クレデンシャル追加
              changes.push({
                field: `cred_new_${cIdx}`,
                label: `アカウント${cIdx} 新規追加`,
                before: "(未登録)",
                after: `${label || "アカウント"} (${loginId || "ID未設定"})`,
              });
              changedFields.push(`Credential${cIdx}`);
            }
          }

          const isFamily = (ownerType || existing.ownerType) === "family";
          const warnings = isFamily ? checkAdminWarnings(row.Admins) : [];
          preliminaryItems.push({
            index: i,
            csvRow,
            action: changes.length > 0 ? "UPDATE" : "SKIP",
            title: existing.title,
            stableId: recordId,
            changedFields,
            changes,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        }

        // 7. パスコードアンロックの確認（ヒント暗号化が必要な行がある場合）
        const needsEncryption = data.some((row, i) => {
          const item = preliminaryItems[i];
          if (item.action !== "CREATE" && item.action !== "UPDATE")
            return false;
          for (let cIdx = 1; cIdx <= MAX_CREDENTIALS_PER_RECORD; cIdx++) {
            if ((row[`PasswordHint${cIdx}`] || "").trim()) return true;
          }
          return false;
        });

        if (needsEncryption && !masterKey) {
          setProgress({
            stage: "パスコード解除を待機中...",
            current: 0,
            total: 0,
          });
          const unlocked = await requireUnlock();
          if (!unlocked) {
            toast.error("暗号化に必要なパスコードが解除されませんでした。");
            setIsAnalyzing(false);
            return;
          }
        }

        // 8. OGP取得 + ルビ取得 + 暗号化処理（processInChunks で分割処理）
        setProgress({
          stage: "データ処理および暗号化中...",
          current: 0,
          total: data.length,
        });

        const finalItems = await processInChunks(
          preliminaryItems,
          async (item) => {
            const row = data[item.index];

            if (item.action === "CREATE") {
              const credentials = [];
              for (let cIdx = 1; cIdx <= MAX_CREDENTIALS_PER_RECORD; cIdx++) {
                const label = (row[`Label${cIdx}`] || "").trim();
                const loginId = (row[`LoginID${cIdx}`] || "").trim();
                const hint = (row[`PasswordHint${cIdx}`] || "").trim();

                if (label || loginId || hint) {
                  let encryptedHint: string | undefined;
                  let iv: string | undefined;
                  let dekEncrypted: string | undefined;
                  let dekIv: string | undefined;

                  if (hint) {
                    const enc = await encryptHint(hint);
                    encryptedHint = enc.encrypted;
                    iv = enc.iv;
                    dekEncrypted = enc.dekEncrypted;
                    dekIv = enc.dekIv;
                  }

                  credentials.push({
                    label: label || undefined,
                    loginId: loginId || undefined,
                    passwordHint: encryptedHint,
                    passwordHintIv: iv,
                    passwordHintDekEncrypted: dekEncrypted,
                    passwordHintDekIv: dekIv,
                  });
                }
              }

              // OGP情報取得
              let ogpImage: string | undefined;
              let ogpDescription: string | undefined;
              const url = (row.URL || "").trim();
              if (url) {
                try {
                  const ogp = await convex.action(api.actions.getOgpInfo, {
                    url,
                  });
                  if (ogp.image) ogpImage = ogp.image;
                  if (ogp.description) ogpDescription = ogp.description;
                } catch {
                  // OGP取得失敗は無視
                }
              }

              // ルビ取得
              let titleReading: string | undefined;
              if (item.title) {
                try {
                  const reading = await convex.action(api.actions.getFurigana, {
                    text: item.title,
                  });
                  if (reading && reading !== item.title) {
                    titleReading = reading;
                  }
                } catch {
                  // ルビ取得失敗は無視
                }
              }

              const tags = (row.Tags || "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              const admins = (row.Admins || "")
                .split(",")
                .map((a) => a.trim().toLowerCase())
                .filter(Boolean);
              const ownerType =
                (row.OwnerType || "").trim().toLowerCase() === "family"
                  ? "family"
                  : "user";

              item.createPayload = {
                title: item.title,
                titleReading,
                url: url || undefined,
                ogpImage,
                ogpDescription,
                memo: (row.Memo || "").trim() || undefined,
                ownerType,
                adminEmails: admins.length > 0 ? admins : undefined,
                tags,
                credentials,
              };
            } else if (item.action === "UPDATE") {
              const updatedTitle = (row.Title || "").trim();
              let updatedTitleReading: string | undefined;
              if (updatedTitle && item.changedFields.includes("Title")) {
                try {
                  const reading = await convex.action(api.actions.getFurigana, {
                    text: updatedTitle,
                  });
                  if (reading && reading !== updatedTitle) {
                    updatedTitleReading = reading;
                  }
                } catch {
                  // ルビ取得失敗は無視
                }
              }

              const credentials = [];
              for (let cIdx = 1; cIdx <= MAX_CREDENTIALS_PER_RECORD; cIdx++) {
                const credId = (row[`CredentialId${cIdx}`] || "").trim();
                const label = (row[`Label${cIdx}`] || "").trim();
                const loginId = (row[`LoginID${cIdx}`] || "").trim();
                const hint = (row[`PasswordHint${cIdx}`] || "").trim();

                if (credId || label || loginId || hint) {
                  let encryptedHint: string | undefined;
                  let iv: string | undefined;
                  let dekEncrypted: string | undefined;
                  let dekIv: string | undefined;

                  if (hint) {
                    const enc = await encryptHint(hint);
                    encryptedHint = enc.encrypted;
                    iv = enc.iv;
                    dekEncrypted = enc.dekEncrypted;
                    dekIv = enc.dekIv;
                  }

                  credentials.push({
                    stableId: credId || undefined,
                    label: label || undefined,
                    loginId: loginId || undefined,
                    passwordHint: encryptedHint,
                    passwordHintIv: iv,
                    passwordHintDekEncrypted: dekEncrypted,
                    passwordHintDekIv: dekIv,
                  });
                }
              }

              const trimmedTags = (row.Tags || "").trim();
              const parsedTags = trimmedTags
                ? trimmedTags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                : undefined;
              const tags =
                parsedTags && parsedTags.length > 0 ? parsedTags : undefined;

              const trimmedAdmins = (row.Admins || "").trim();
              const parsedAdmins = trimmedAdmins
                ? trimmedAdmins
                    .split(",")
                    .map((a) => a.trim().toLowerCase())
                    .filter(Boolean)
                : undefined;
              const admins =
                parsedAdmins && parsedAdmins.length > 0
                  ? parsedAdmins
                  : undefined;

              const ownerTypeRaw = (row.OwnerType || "").trim().toLowerCase();
              const ownerType =
                ownerTypeRaw === "family" || ownerTypeRaw === "user"
                  ? ownerTypeRaw
                  : undefined;

              if (item.stableId) {
                item.updatePayload = {
                  stableId: item.stableId,
                  title: updatedTitle || undefined,
                  titleReading: item.changedFields.includes("Title")
                    ? updatedTitleReading
                    : undefined,
                  url: (row.URL || "").trim() || undefined,
                  memo: (row.Memo || "").trim() || undefined,
                  ownerType,
                  adminEmails: admins,
                  tags,
                  credentials,
                };
              }
            }

            return item;
          },
          10,
          (current, total) => {
            setProgress({
              stage: "データ処理および暗号化中...",
              current,
              total,
            });
            toast.loading(`データ解析・暗号化中... (${current}/${total} 件)`, {
              id: IMPORT_TOAST_ID,
            });
          },
        );

        toast.dismiss(IMPORT_TOAST_ID);
        setDiffItems(finalItems);
        setIsPreviewOpen(true);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "不明なエラー";
        toast.error(`CSV解析中にエラーが発生しました: ${message}`, {
          id: IMPORT_TOAST_ID,
        });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [convex, masterKey, requireUnlock, encryptHint, accountId],
  );

  const applyDiff = useCallback(
    async (
      selectedIndices: Set<number>,
    ): Promise<{ createdCount: number; updatedCount: number } | null> => {
      setIsApplying(true);
      toast.loading("変更内容をデータベースに反映中...", {
        id: APPLY_TOAST_ID,
      });

      try {
        const creates: RecordCreatePayload[] = [];
        const updates: RecordUpdatePayload[] = [];

        for (const item of diffItems) {
          if (!selectedIndices.has(item.index)) continue;

          if (item.action === "CREATE" && item.createPayload) {
            creates.push(item.createPayload);
          } else if (item.action === "UPDATE" && item.updatePayload) {
            updates.push(item.updatePayload);
          }
        }

        if (creates.length === 0 && updates.length === 0) {
          toast.info("反映対象のデータがありません。", { id: APPLY_TOAST_ID });
          return null;
        }

        const result = await applyImportDiffMutation({
          creates,
          updates,
          ...(accountId ? { accountId } : {}),
        });

        toast.success(
          `インポート完了: 新規 ${result.createdCount} 件、更新 ${result.updatedCount} 件のデータを反映しました`,
          { id: APPLY_TOAST_ID },
        );
        reset();
        return {
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "不明なエラー";
        toast.error(`反映処理中にエラーが発生しました: ${message}`, {
          id: APPLY_TOAST_ID,
        });
        return null;
      } finally {
        setIsApplying(false);
      }
    },
    [diffItems, applyImportDiffMutation, reset, accountId],
  );

  return {
    isAnalyzing,
    isApplying,
    progress,
    diffItems,
    isPreviewOpen,
    setIsPreviewOpen,
    handleFileSelect,
    applyDiff,
    reset,
  };
}
