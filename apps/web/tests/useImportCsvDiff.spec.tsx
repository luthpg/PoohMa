// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportCsvDiff } from "@/hooks/useImportCsvDiff";

const mockQuery = vi.fn();
const mockMutation = vi.fn();

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: mockQuery,
  }),
  useMutation: () => mockMutation,
}));

vi.mock("@/components/PasscodeProvider", () => ({
  usePasscode: () => ({
    masterKey: {},
    requireUnlock: vi.fn().mockResolvedValue(true),
    encryptHint: vi.fn().mockResolvedValue({
      encrypted: "enc",
      iv: "iv",
      dekEncrypted: "dekEnc",
      dekIv: "dekIv",
    }),
  }),
}));

const mockToast = {
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
};

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToast.error(...args),
    success: (...args: unknown[]) => mockToast.success(...args),
    loading: (...args: unknown[]) => mockToast.loading(...args),
    dismiss: (...args: unknown[]) => mockToast.dismiss(...args),
    info: (...args: unknown[]) => mockToast.info(...args),
  },
}));

describe("useImportCsvDiff - パースエラー制御と生エラー非露出", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(() => {
      // getRecordsForDiffImport
      return Promise.resolve([]);
    });
  });

  it("FieldMismatch（列数不一致）の行があっても全体中断せず、該当行のみ ERROR に分類され正常行はプレビューされること", async () => {
    const { result } = renderHook(() => useImportCsvDiff());

    // 1行目は正常、2行目は列数不足（FieldMismatch）、3行目は正常
    const csvContent = [
      "Title,Url,LoginId,PasswordHint",
      "ServiceA,https://a.com,userA,hintA",
      "ServiceB,https://b.com", // 列数不足
      "ServiceC,https://c.com,userC,hintC",
    ].join("\n");

    const file = new File([csvContent], "test_mismatch.csv", {
      type: "text/csv",
    });

    await act(async () => {
      await result.current.handleFileSelect(file);
    });

    // 全体エラー中断されず、プレビューが開くこと
    expect(result.current.isPreviewOpen).toBe(true);
    expect(result.current.diffItems).toHaveLength(3);

    // 1行目: 正常に CREATE
    expect(result.current.diffItems[0].action).toBe("CREATE");
    expect(result.current.diffItems[0].title).toBe("ServiceA");

    // 2行目: FieldMismatch のため ERROR に分類されること
    expect(result.current.diffItems[1].action).toBe("ERROR");
    expect(result.current.diffItems[1].errorReason).toBe(
      "列の数がヘッダーと一致しません（不正な行）",
    );

    // 3行目: 正常に CREATE
    expect(result.current.diffItems[2].action).toBe("CREATE");
    expect(result.current.diffItems[2].title).toBe("ServiceC");

    // 生エラートーストが表示されていないこと
    expect(mockToast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Too few fields"),
    );
  });

  it("Quotes（ダブルクォート不整合）エラーの場合は安全のため全体中断し、固定日本語メッセージが表示されること", async () => {
    const { result } = renderHook(() => useImportCsvDiff());

    // 閉じられていないクォート
    const csvContent = [
      "Title,Url,LoginId,PasswordHint",
      'ServiceA,"https://a.com,userA,hintA',
    ].join("\n");

    const file = new File([csvContent], "test_quotes.csv", {
      type: "text/csv",
    });

    await act(async () => {
      await result.current.handleFileSelect(file);
    });

    // プレビューは開かない
    expect(result.current.isPreviewOpen).toBe(false);

    // 安全な固定日本語メッセージが表示され、生の例外文字列は露出しないこと
    expect(mockToast.error).toHaveBeenCalledWith(
      "CSVファイルの形式が不正です。ダブルクォートの対応関係を確認してください。",
      expect.anything(),
    );
  });

  it("解析処理で予期しない例外が発生した場合も、生の例外メッセージを露出せず固定メッセージを表示すること", async () => {
    mockQuery.mockRejectedValueOnce(
      new Error("Convex connection lost: secret_internal_db_error_12345"),
    );

    const { result } = renderHook(() => useImportCsvDiff());

    const csvContent = [
      "Title,Url,LoginId,PasswordHint",
      "ServiceA,https://a.com,userA,hintA",
    ].join("\n");

    const file = new File([csvContent], "valid.csv", { type: "text/csv" });

    await act(async () => {
      await result.current.handleFileSelect(file);
    });

    // 生のエラーメッセージ（secret_internal_db_error_12345）が露出していないこと
    expect(mockToast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("secret_internal_db_error_12345"),
      expect.anything(),
    );
    // 安全な固定メッセージが表示されること
    expect(mockToast.error).toHaveBeenCalledWith(
      "CSV解析中にエラーが発生しました。ファイル形式をご確認ください。",
      expect.anything(),
    );
  });
});
