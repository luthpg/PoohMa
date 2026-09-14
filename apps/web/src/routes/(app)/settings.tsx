import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import { AlertTriangle, Download } from "lucide-react";
import { type SubmitEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/../convex/_generated/api";
import { usePasscode } from "@/components/PasscodeProvider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAccount } from "@/hooks/useAccount";
import { useExportCsv } from "@/hooks/useExportCsv";
import { clearQueryCache } from "@/hooks/usePersistentQuery";
import { isBiometricEnabledForUser } from "@/lib/biometric";
import { auth } from "@/utils/firebase";

export const Route = createFileRoute("/(app)/settings")({
  loader: ({ context }) => {
    return { user: context.user ?? null };
  },
  component: SettingsComponent,
});

const routeApi = getRouteApi("/(app)/settings");

function SettingsComponent() {
  const { user } = routeApi.useLoaderData();
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  const {
    accounts,
    activeAccount,
    activeAccountId,
    deleteAccount: deletePoohMaAccount,
  } = useAccount();
  const { disableBiometric, lockTimeoutMinutes, setLockTimeoutMinutes } =
    usePasscode();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const currentAccount = activeAccount || user;
  const [displayName, setDisplayName] = useState(
    currentAccount?.displayName || "",
  );
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    const targetId = activeAccount?.id || user?.id;
    if (targetId) {
      isBiometricEnabledForUser(targetId).then(setHasBiometric);
    }
  }, [activeAccount?.id, user?.id]);

  const handleClearBiometric = async () => {
    try {
      await disableBiometric();
      setHasBiometric(false);
      toast.success("この端末の生体認証データを削除しました");
    } catch {
      toast.error("生体認証データの削除に失敗しました");
    }
  };

  // アクティブアカウントが変わった場合にフォームの値を同期
  useEffect(() => {
    setDisplayName(currentAccount?.displayName ?? "");
  }, [currentAccount?.displayName]);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingSubAccount, setIsDeletingSubAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const { handleExport, isExporting } = useExportCsv();

  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAllAccountsConvex = useMutation(api.users.deleteAllAccounts);

  if (!currentAccount) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-orange-500" />
      </div>
    );
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error("表示名を入力してください");
      return;
    }

    setIsSaving(true);
    try {
      // activeAccount が存在する場合はそのアカウント ID を渡し、
      // 存在しない場合は undefined（= デフォルトアカウントを更新）
      await updateProfile({
        accountId: activeAccount?._id || undefined,
        displayName: displayName.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["authUser"] });
      toast.success("プロフィールを更新しました");
      await router.invalidate();
    } catch {
      toast.error("プロフィールの更新に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSingleAccount = async () => {
    if (!activeAccountId) return;
    setIsDeletingSubAccount(true);
    try {
      await deletePoohMaAccount(activeAccountId);
      toast.success("アカウントを削除しました");
    } catch {
      toast.error("アカウントの削除に失敗しました");
    } finally {
      setIsDeletingSubAccount(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const currentUser = auth?.currentUser;
      if (!currentUser) {
        throw new Error("認証情報が見つかりません。再ログインしてください。");
      }

      // 1. Firebase 再認証を最初に実行（セキュリティ確認）
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({
          prompt: "select_account",
        });
        await reauthenticateWithPopup(currentUser, provider);
      } catch {
        throw new Error("再認証に失敗しました。操作をキャンセルします。");
      }

      // 2. 再認証成功後、Convexで全アカウント削除を実行
      await deleteAllAccountsConvex({});

      // 3. Convex削除成功後にFirebase Auth ユーザーの削除
      await currentUser.delete();

      // 4. キャッシュのクリア
      clearQueryCache();

      toast.success("退会処理が完了しました");
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "auth/requires-recent-login") {
        toast.error(
          "セキュリティ保護のため、最近ログインしていない場合はこの操作を実行できません。一度ログアウトし、再ログインしてからやり直してください。",
        );
      } else {
        toast.error(
          "退会処理に失敗しました。時間をおいてもう一度お試しください。",
        );
      }
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {/* 戻るボタン */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-6 bg-background/95 px-4 pb-4 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 2) {
              window.history.back();
            } else {
              router.navigate({ to: "/dashboard" });
            }
          }}
          className="text-[14px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          <span className="text-[16px] leading-none mb-0.5">←</span> 戻る
        </button>
      </div>

      <div className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-geist-h1 text-foreground mb-2">
          アカウント設定
        </h1>
        <p className="text-[14px] text-muted-foreground">
          プロフィールの情報を変更できます。
        </p>
      </div>

      <div className="rounded-lg bg-card p-6 shadow-card border border-border/50">
        <h2 className="text-[18px] font-semibold text-foreground tracking-geist-ui mb-6 border-b border-border pb-4">
          プロフィール
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="email-input"
              className="block text-[14px] font-medium text-muted-foreground mb-1"
            >
              メールアドレス
            </label>
            <input
              id="email-input"
              type="text"
              value={currentAccount.email}
              disabled
              className="w-full rounded-md bg-muted p-2.5 text-base md:text-[14px] text-muted-foreground shadow-sm focus:outline-none opacity-80 cursor-not-allowed"
            />
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              メールアドレスは変更できません。
            </p>
          </div>

          <div>
            <label
              htmlFor="display-name-input"
              className="block text-[14px] font-medium text-foreground mb-1"
            >
              表示名 <span className="text-red-500">*</span>
            </label>
            <input
              id="display-name-input"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-md bg-card p-2.5 text-base md:text-[14px] shadow-border focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="表示名を入力"
            />
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={
                isSaving || displayName.trim() === currentAccount.displayName
              }
              className="flex items-center rounded-md bg-foreground px-6 py-2.5 text-[14px] font-medium text-background shadow-lg transition hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  保存中...
                </>
              ) : (
                "保存する"
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-lg bg-card p-6 shadow-card border border-border/50 mt-8">
        <h2 className="text-[18px] font-semibold text-foreground tracking-geist-ui mb-2 border-b border-border pb-4">
          セキュリティ設定
        </h2>
        <div className="space-y-6 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-foreground">
                オートロック（無操作タイムアウト）
              </p>
              <p className="text-[12px] text-muted-foreground mt-1">
                一定時間操作がない場合、または設定時間以上バックグラウンドに置かれた状態からアプリに戻った際、自動で暗号化キーをロックします。
                <br />
                なお、この設定値は端末ごと（またはブラウザごと）に保存されます。
              </p>
            </div>
            <label htmlFor="autolock-timeout" className="sr-only">
              オートロック時間
            </label>
            <select
              id="autolock-timeout"
              value={lockTimeoutMinutes}
              onChange={(e) => {
                const val = Number(e.target.value);
                setLockTimeoutMinutes(val);
                toast.success(
                  val === 0
                    ? "オートロックを無効にしました"
                    : `オートロック時間を ${val} 分に設定しました`,
                );
              }}
              className="rounded-md border border-border/50 bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 w-full sm:w-auto shrink-0"
            >
              <option value={1}>1分</option>
              <option value={3}>3分</option>
              <option value={5}>5分（デフォルト）</option>
              <option value={10}>10分</option>
              <option value={15}>15分</option>
              <option value={30}>30分</option>
              <option value={0}>無効</option>
            </select>
          </div>

          {hasBiometric && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-border/40">
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  生体認証の解除
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  この端末に保存されている生体認証（FaceID/指紋）のロック解除設定を削除します。
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearBiometric}
                className="rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground shrink-0"
              >
                設定を削除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 rounded-lg border border-red-500/20 bg-red-500/5 p-6 shadow-sm">
        <h2 className="text-[18px] font-semibold text-red-600 dark:text-red-400 tracking-geist-ui mb-2 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Danger Zone
        </h2>
        <p className="text-[14px] text-muted-foreground mb-6">
          アカウントの削除を行います。この操作は取り消すことができません。
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          {accounts.length > 1 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="flex items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[14px] font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500/50 w-full sm:w-auto cursor-pointer"
                >
                  このアカウント（{currentAccount.displayName}）のみ削除
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-red-600 dark:text-red-400">
                    アカウント「{currentAccount.displayName}」を削除しますか？
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    このPoohMaアカウントおよび所属ファミリーのデータが削除されます。他のPoohMaアカウントやFirebaseログインはそのまま保持されます。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-4">
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteSingleAccount}
                    disabled={isDeletingSubAccount}
                    className="bg-red-500 hover:bg-red-600 focus:ring-red-500 text-white"
                  >
                    {isDeletingSubAccount ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        削除中...
                      </>
                    ) : (
                      "削除する"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 px-6 py-2.5 text-[14px] font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500/50 w-full sm:w-auto cursor-pointer"
              >
                PoohMa全体から退会する
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-red-600 dark:text-red-400">
                  本当に退会しますか？
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-4 pt-2 text-foreground">
                    <div className="rounded-md bg-muted p-3 text-[14px]">
                      <p className="font-semibold mb-2">退会時の注意事項</p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li>
                          あなたが登録したアカウント情報はすべて削除されます。
                        </li>
                        <li>
                          家族と「共有」に設定している情報も、他の家族から見られなくなります。
                        </li>
                        <li>
                          退会操作は取り消せません。事前にCSVファイルでの保存をおすすめします。
                        </li>
                      </ul>
                    </div>

                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={handleExport}
                        disabled={isExporting}
                        className="flex items-center justify-center w-full rounded-md border border-border bg-background px-4 py-2.5 text-[14px] font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      >
                        {isExporting ? (
                          <>
                            <Spinner className="mr-2 h-4 w-4" />
                            ダウンロード中...
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            CSVファイルをダウンロードする
                          </>
                        )}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="confirm-delete"
                        className="text-[14px] font-medium text-foreground"
                      >
                        確認のため、「
                        <span className="font-bold text-red-500">退会する</span>
                        」と入力してください
                      </label>
                      <input
                        id="confirm-delete"
                        type="text"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                        placeholder="退会する"
                        className="w-full rounded-md bg-card p-2.5 text-base md:text-[14px] border border-border shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      />
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-6">
                <AlertDialogCancel
                  onClick={() => setDeleteConfirmation("")}
                  className="mt-2 sm:mt-0"
                >
                  キャンセル
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    if (deleteConfirmation === "退会する") {
                      handleDeleteAccount();
                    }
                  }}
                  disabled={deleteConfirmation !== "退会する" || isDeleting}
                  className="bg-red-500 hover:bg-red-600 focus:ring-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                >
                  {isDeleting ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      退会処理中...
                    </>
                  ) : (
                    "理解した上で退会する"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
