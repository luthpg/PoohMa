import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Gavel,
  HelpCircle,
  Laptop,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Moon,
  Plus,
  ScrollText,
  Sun,
  UserCog,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { UserAvatar } from "@/components/UserAvatar";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAccount } from "@/hooks/useAccount";
import { LOGOUT_FLAG_KEY } from "@/hooks/useConvexFirebaseAuth";
import { clearQueryCache } from "@/hooks/usePersistentQuery";
import { cn } from "@/lib/utils";
import { logout } from "@/services/auth.functions";
import { auth } from "@/utils/firebase";
import { CreateAccountDialog } from "./CreateAccountDialog";

export function UserMenu({
  user,
}: {
  user: {
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  // マルチアカウント管理
  const { accounts, activeAccount, activeAccountId, switchAccount } =
    useAccount();

  // 新規アカウント作成モーダル用ステート
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // モバイルSheet用ステート
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isMobileThemeOpen, setIsMobileThemeOpen] = useState(false);
  // モバイルでの表示ビュー ("main" = 通常メニュー, "accounts" = アカウント切り替えドリルダウン)
  const [mobileView, setMobileView] = useState<"main" | "accounts">("main");

  const displayName =
    activeAccount?.displayName || user?.displayName || "ユーザー";
  const photoURL = activeAccount?.photoURL || user?.photoURL || undefined;
  const email = user?.email || activeAccount?.email || "";
  const familyName = activeAccount?.family?.name || "家族未所属";

  const handleLogout = async () => {
    try {
      localStorage.setItem(LOGOUT_FLAG_KEY, String(Date.now()));
      await logout();
      if (auth) await signOut(auth);
      clearQueryCache();
      queryClient.clear();
      window.location.href = "/";
    } catch {
      window.location.href = "/";
    }
  };

  const avatarButton = (
    <button
      type="button"
      data-testid="user-menu-trigger"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary shadow-border outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
    >
      <UserAvatar
        displayName={displayName}
        email={email}
        photoURL={photoURL}
        className="h-8 w-8"
      />
    </button>
  );

  return (
    <>
      {/* ========================================================= */}
      {/* モバイル表示 (Sheet)        */}
      {/* ========================================================= */}
      <div className="block sm:hidden">
        <Sheet
          open={isSheetOpen}
          onOpenChange={(open) => {
            setIsSheetOpen(open);
            if (!open) {
              // 閉じたときは初期ビューに戻す
              setTimeout(() => setMobileView("main"), 200);
            }
          }}
        >
          <SheetTrigger asChild>{avatarButton}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl max-h-[90vh] overflow-y-auto p-6"
          >
            {mobileView === "main" ? (
              /* ----------------- 通常メニュービュー ----------------- */
              <div className="space-y-4">
                <SheetHeader className="text-left p-0 pb-1">
                  <SheetTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    アカウントメニュー
                  </SheetTitle>
                </SheetHeader>

                {/* クリッカブルなGoogle/PoohMaアカウントカード */}
                <button
                  type="button"
                  onClick={() => setMobileView("accounts")}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted transition text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      displayName={displayName}
                      email={email}
                      photoURL={photoURL}
                      className="h-10 w-10 shrink-0"
                      fallbackClassName="bg-orange-500 text-white text-sm font-semibold"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {displayName}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {email}
                      </div>
                      <div className="text-[10px] text-orange-600 dark:text-orange-400 font-medium truncate mt-0.5">
                        {familyName}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium shrink-0 ml-2 group-hover:text-foreground">
                    <span>切替</span>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </button>

                <div className="h-[1px] bg-border/50" />

                {/* メインリンク */}
                <div className="space-y-1">
                  <Link
                    to="/dashboard"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-accent/40 hover:bg-accent hover:border-orange-500/40 text-sm font-medium transition cursor-pointer"
                  >
                    <LayoutDashboard className="h-5 w-5 text-orange-500 shrink-0" />
                    <span className="font-semibold text-foreground">
                      ダッシュボード
                    </span>
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent text-sm font-medium transition cursor-pointer"
                  >
                    <UserCog className="h-5 w-5 text-orange-500" />
                    <span>アカウント設定</span>
                  </Link>
                  <Link
                    to="/family"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent text-sm font-medium transition cursor-pointer"
                  >
                    <Users className="h-5 w-5 text-orange-500" />
                    <span>家族管理</span>
                  </Link>
                </div>

                <div className="h-[1px] bg-border/50" />

                {/* データ管理 */}
                <div>
                  <Link
                    to="/settings/bulk"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-accent text-sm font-medium transition cursor-pointer"
                  >
                    <Database className="h-5 w-5 text-orange-500" />
                    <span>データ管理（CSV）</span>
                  </Link>
                </div>

                <div className="h-[1px] bg-border/50" />

                {/* テーマ切り替え (折りたたみ) */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setIsMobileThemeOpen(!isMobileThemeOpen)}
                    className="flex w-full items-center justify-between px-1 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span>テーマ</span>
                      <span className="text-[11px] font-normal text-muted-foreground/80">
                        (
                        {theme === "light"
                          ? "ライト"
                          : theme === "dark"
                            ? "ダーク"
                            : "自動"}
                        )
                      </span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform duration-200",
                        isMobileThemeOpen ? "rotate-180" : "",
                      )}
                    />
                  </button>
                  {isMobileThemeOpen && (
                    <div className="grid grid-cols-3 gap-2 bg-muted/50 p-1 rounded-xl pt-1 animate-in fade-in-50 duration-200">
                      <button
                        type="button"
                        onClick={() => {
                          setTheme("light");
                          setIsSheetOpen(false);
                        }}
                        className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                          theme === "light"
                            ? "bg-card text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Sun className="h-4 w-4 text-amber-500" />
                        <span>ライト</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTheme("dark");
                          setIsSheetOpen(false);
                        }}
                        className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                          theme === "dark"
                            ? "bg-card text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Moon className="h-4 w-4 text-indigo-400" />
                        <span>ダーク</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTheme("system");
                          setIsSheetOpen(false);
                        }}
                        className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                          theme === "system"
                            ? "bg-card text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Laptop className="h-4 w-4 text-gray-400" />
                        <span>自動</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="h-[1px] bg-border/50" />

                {/* ヘルプ & 規約 & お知らせ */}
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <Link
                    to="/usage"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <BookOpen className="h-4 w-4" />
                    <span>使い方</span>
                  </Link>
                  <Link
                    to="/news"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <Megaphone className="h-4 w-4" />
                    <span>お知らせ</span>
                  </Link>
                  <Link
                    to="/faq"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <HelpCircle className="h-4 w-4" />
                    <span>FAQ</span>
                  </Link>
                  <Link
                    to="/contact"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <Mail className="h-4 w-4" />
                    <span>お問い合わせ</span>
                  </Link>
                  <Link
                    to="/terms-of-service"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <Gavel className="h-4 w-4" />
                    <span>利用規約</span>
                  </Link>
                  <Link
                    to="/privacy-policy"
                    onClick={() => setIsSheetOpen(false)}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition"
                  >
                    <ScrollText className="h-4 w-4" />
                    <span>プライバシー</span>
                  </Link>
                </div>

                <div className="h-[1px] bg-border/50" />

                {/* ログアウト */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-medium transition cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>ログアウト</span>
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ログアウトしますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        ログアウトしてログイン画面に戻ります。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleLogout}
                        className="text-white bg-red-500 hover:bg-red-600 focus:ring-red-500"
                      >
                        ログアウト
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              /* ----------------- アカウント切り替えビュー (ドリルダウン) ----------------- */
              <div className="space-y-4 animate-in slide-in-from-right duration-200">
                <div className="flex items-center justify-between pb-2 border-b border-border/50">
                  <button
                    type="button"
                    onClick={() => setMobileView("main")}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition cursor-pointer py-1"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>メニューに戻る</span>
                  </button>
                  <span className="text-xs font-semibold text-foreground">
                    アカウント切り替え
                  </span>
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {accounts.map((acc) => {
                    const isSelected = acc._id === activeAccountId;
                    const accName =
                      acc.displayName || acc.name || "名無しアカウント";
                    const famName = acc.family?.name || "家族未所属";

                    return (
                      <button
                        key={acc._id}
                        type="button"
                        onClick={() => {
                          switchAccount(acc._id);
                          setIsSheetOpen(false);
                          setTimeout(() => setMobileView("main"), 200);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs transition cursor-pointer",
                          isSelected
                            ? "border-orange-500/50 bg-orange-500/10 text-foreground font-medium"
                            : "border-border/70 bg-card hover:bg-accent text-muted-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-xs">
                            {accName.charAt(0).toUpperCase()}
                          </div>
                          <div className="truncate">
                            <div className="truncate font-semibold text-foreground">
                              {accName}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {famName}
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-orange-500 shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsSheetOpen(false);
                    setIsCreateOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-orange-500/40 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/5 transition cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>新しいアカウントを作成</span>
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>

      {/* ========================================================= */}
      {/* デスクトップ表示 (DropdownMenu): SubMenuで横にポップアップ  */}
      {/* ========================================================= */}
      <div className="hidden sm:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{avatarButton}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-1">
            {/* Googleアカウントヘッダー 兼 アカウント切替サブメニュー */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer p-2.5 rounded-md hover:bg-accent data-[state=open]:bg-accent">
                <div className="flex items-center gap-2.5 overflow-hidden w-full text-left">
                  <UserAvatar
                    displayName={displayName}
                    email={email}
                    photoURL={photoURL}
                    className="h-8 w-8 shrink-0"
                  />
                  <div className="flex flex-col overflow-hidden min-w-0 flex-1">
                    <span className="truncate text-xs font-semibold text-foreground leading-tight">
                      {displayName}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground leading-tight mt-0.5">
                      {email}
                    </span>
                    <span className="truncate text-[10px] text-orange-600 dark:text-orange-400 font-medium leading-tight">
                      {familyName}
                    </span>
                  </div>
                </div>
              </DropdownMenuSubTrigger>

              {/* 右側に浮き上がるアカウントスイッチ・ポップアップ */}
              <DropdownMenuSubContent className="w-64 p-1 shadow-xl">
                <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                  <span>アカウント切り替え</span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-normal">
                    {accounts.length} 件
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuGroup className="max-h-52 overflow-y-auto">
                  {accounts.map((acc) => {
                    const isSelected = acc._id === activeAccountId;
                    const accName =
                      acc.displayName || acc.name || "名無しアカウント";
                    const famName = acc.family?.name || "家族未所属";

                    return (
                      <DropdownMenuItem
                        key={acc._id}
                        onClick={() => switchAccount(acc._id)}
                        className={cn(
                          "flex items-center justify-between px-2 py-1.5 cursor-pointer rounded-md text-xs",
                          isSelected ? "bg-accent font-medium" : "",
                        )}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Avatar className="h-5 w-5">
                            {acc.photoURL && (
                              <AvatarImage src={acc.photoURL} alt={accName} />
                            )}
                            <AvatarFallback className="text-[9px] bg-muted font-semibold">
                              {accName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col text-left overflow-hidden">
                            <span className="truncate text-xs font-medium text-foreground leading-tight">
                              {accName}
                            </span>
                            <span className="truncate text-[10px] text-muted-foreground leading-tight">
                              {famName}
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-orange-500 shrink-0 ml-1.5" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => setIsCreateOpen(true)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400 cursor-pointer rounded-md focus:bg-orange-500/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>新しいアカウントを作成</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* メインメニュー項目 */}
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/dashboard" className="cursor-pointer">
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>ダッシュボード</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings" className="cursor-pointer">
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>アカウント設定</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/family" className="cursor-pointer">
                  <Users className="mr-2 h-4 w-4" />
                  <span>家族管理</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            {/* データ管理 */}
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/settings/bulk" className="cursor-pointer">
                  <Database className="mr-2 h-4 w-4 text-orange-500" />
                  <span>データ管理（CSV）</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            {/* テーマ切り替え (フラット配置) */}
            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal py-1">
              テーマ
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="mr-2 h-4 w-4 text-amber-500" />
                <span className={theme === "light" ? "font-semibold" : ""}>
                  ライト
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="mr-2 h-4 w-4 text-indigo-400" />
                <span className={theme === "dark" ? "font-semibold" : ""}>
                  ダーク
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Laptop className="mr-2 h-4 w-4 text-gray-400" />
                <span className={theme === "system" ? "font-semibold" : ""}>
                  システム設定
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/usage" className="cursor-pointer">
                  <BookOpen className="mr-2 h-4 w-4" />
                  <span>使い方</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/news" className="cursor-pointer">
                  <Megaphone className="mr-2 h-4 w-4" />
                  <span>お知らせ</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/faq" className="cursor-pointer">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>FAQ</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/contact" className="cursor-pointer">
                  <Mail className="mr-2 h-4 w-4" />
                  <span>お問い合わせ</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/terms-of-service" className="cursor-pointer">
                  <Gavel className="mr-2 h-4 w-4" />
                  <span>利用規約</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/privacy-policy" className="cursor-pointer">
                  <ScrollText className="mr-2 h-4 w-4" />
                  <span>プライバシーポリシー</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  className="text-red-500 focus:text-red-500 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>ログアウト</span>
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>ログアウトしますか？</AlertDialogTitle>
                  <AlertDialogDescription>
                    ログアウトしてログイン画面に戻ります。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleLogout}
                    className="text-white bg-red-500 hover:bg-red-600 focus:ring-red-500"
                  >
                    ログアウト
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ========================================================= */}
      {/* 新規アカウント作成モーダル (Menuの外側に配置して競合回避)   */}
      {/* ========================================================= */}
      <CreateAccountDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setMobileView("main");
        }}
      />
    </>
  );
}
