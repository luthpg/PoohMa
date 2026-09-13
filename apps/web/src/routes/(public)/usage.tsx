import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  HelpCircle,
  Lock,
  Play,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Share2,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { JpText } from "@/components/JpText";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/(public)/usage")({
  component: UsagePage,
});

function UsagePage() {
  const { isAuthenticated } = useAuth();
  const [mainTab, setMainTab] = useState<"basic" | "tips">("basic");
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [pendingTipTarget, setPendingTipTarget] = useState<
    "tip-role" | "tip-csv" | null
  >(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [familyFlowTab, setFamilyFlowTab] = useState<"creator" | "joiner">(
    "creator",
  );

  // カルーセルのスワイプ・ドラッグ切り替え時に mainTab を更新
  useEffect(() => {
    if (!carouselApi) return;

    const onSelect = () => {
      const selectedIndex = carouselApi.selectedScrollSnap();
      const nextTab = selectedIndex === 0 ? "basic" : "tips";
      setMainTab((prev) => (prev === nextTab ? prev : nextTab));
    };

    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  // タブボタンクリック時のハンドラー（カルーセルをスムーズにスクロール）
  const handleTabChange = (tab: "basic" | "tips") => {
    setMainTab(tab);
    if (!carouselApi) return;
    const targetIndex = tab === "basic" ? 0 : 1;
    if (carouselApi.selectedScrollSnap() !== targetIndex) {
      carouselApi.scrollTo(targetIndex);
    }
  };

  // カルーセルの settle イベントを監視し、スライド遷移完了後に対象 Tip へスクロール
  useEffect(() => {
    if (!carouselApi || !pendingTipTarget) return;

    const scrollToTarget = () => {
      // Tips タブ（index=1）でない場合は無視
      if (carouselApi.selectedScrollSnap() !== 1) return;

      const element = document.getElementById(pendingTipTarget);
      if (!element) return;

      // rAF を挟んでレイアウト確定後にスクロール実行
      // ※ scrollIntoView は Safari iOS で overflow:hidden 祖先コンテナも
      //    横スクロールさせてしまうため、window.scrollTo で縦方向のみ移動する
      requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        // 固定ヘッダー (64px) + sticky タブバーの高さ + 視認性のための余白 (16px) を加味
        const headerHeight = 64;
        const tabBarHeight = tabBarRef.current?.offsetHeight ?? 72;
        const buffer = 16;
        const totalOffset = headerHeight + tabBarHeight + buffer;
        const top = window.scrollY + rect.top - totalOffset;
        window.scrollTo({ top, behavior: "smooth" });
        setPendingTipTarget(null);
      });
    };

    // 既に Tips スライドに居る場合は即座に実行
    if (carouselApi.selectedScrollSnap() === 1) {
      scrollToTarget();
      return;
    }

    // スライドアニメーション完了時に一度だけ発火
    const onSettle = () => {
      scrollToTarget();
      carouselApi.off("settle", onSettle);
    };
    carouselApi.on("settle", onSettle);

    return () => {
      carouselApi.off("settle", onSettle);
    };
  }, [carouselApi, pendingTipTarget]);

  return (
    <div className="flex flex-col w-full overflow-x-clip">
      {/* ─── ① ヒーローセクション ─── */}
      <section className="border-b border-border/60 bg-gradient-to-b from-background via-muted/20 to-background py-10 sm:py-16 md:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 text-center">
          <Badge
            variant="secondary"
            className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted/80 text-foreground border border-border"
          >
            <Smartphone className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />
            <JpText>PoohMa はじめてガイド</JpText>
          </Badge>

          <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground leading-[1.3] sm:leading-[1.2]">
            <JpText>迷わずわかる、</JpText>
            <br className="block sm:hidden" />
            <span className="text-orange-500 dark:text-orange-400">
              <JpText>始め方</JpText>
            </span>
            <JpText>と</JpText>
            <span className="text-foreground">
              <JpText>いつもの使い方</JpText>
            </span>
          </h1>

          <p className="mt-4 max-w-2xl mx-auto text-sm sm:text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">
            <JpText>
              PoohMa（プーマ）は、実際のパスワードを1文字もサーバーに預けません。ご家族だけに伝わる「ヒント」で安全に共有するアカウント管理帳です。
            </JpText>
          </p>
        </div>
      </section>

      {/* ─── ② ガイドタブ＆コンテンツエリア（タブエリア内のみ固定） ─── */}
      <div className="relative w-full">
        {/* スクロール連動 sticky タブバー */}
        <div
          ref={tabBarRef}
          className="sticky top-16 z-40 w-full bg-background/85 backdrop-blur-md border-b border-border/60 py-3 shadow-xs"
        >
          <div className="mx-auto max-w-md px-4">
            <fieldset
              aria-label="ガイド表示の切り替え"
              className="grid grid-cols-2 p-1.5 rounded-2xl bg-muted/80 border border-border shadow-xs"
            >
              <button
                type="button"
                aria-pressed={mainTab === "basic"}
                onClick={() => handleTabChange("basic")}
                className={`py-2.5 sm:py-3 px-3 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mainTab === "basic"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="truncate">基本の使い方</span>
              </button>
              <button
                type="button"
                aria-pressed={mainTab === "tips"}
                onClick={() => handleTabChange("tips")}
                className={`py-2.5 sm:py-3 px-3 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mainTab === "tips"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="truncate">便利な機能・Tips</span>
              </button>
            </fieldset>
          </div>
        </div>

        {/* ─── ② メインコンテンツエリア（タブ切り替えカルーセル） ─── */}
        <div className="mx-auto max-w-[1200px] w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
          <Carousel
            setApi={setCarouselApi}
            opts={{
              watchDrag: true,
              duration: 25,
            }}
            className="w-full"
          >
            <CarouselContent className="-ml-0 items-start">
              <CarouselItem
                aria-label="基本の使い方"
                className="pl-0 basis-full min-w-full"
              >
                {/* ──────────────────────────────────────────────────────────
                 【基本の使い方タブ】初読者向け：これだけ覚えればOKの3ステップ
                 ────────────────────────────────────────────────────────── */}
                <div className="space-y-12 sm:space-y-16">
                  <div className="text-center max-w-2xl mx-auto">
                    <Badge
                      variant="outline"
                      className="mb-2 text-xs font-semibold tracking-wider text-orange-500 border-orange-500/30 bg-orange-500/5"
                    >
                      SIMPLE 3 STEPS
                    </Badge>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
                      <JpText>これだけ覚えればOK！基本の3ステップ</JpText>
                    </h2>
                    <p className="mt-2 text-sm sm:text-base text-muted-foreground whitespace-pre-wrap">
                      <JpText>
                        初期設定はわずか2分。普段の利用は「ヒントを見てログイン」するだけの簡単設計です。
                      </JpText>
                    </p>
                  </div>

                  {/* 3つのステップカード */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
                    {/* STEP 1 */}
                    <div className="relative flex flex-col rounded-2xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-white font-bold text-sm shadow-xs">
                          1
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                          所要時間 1分
                        </span>
                      </div>

                      <h3 className="text-base sm:text-lg font-bold text-foreground mb-2">
                        <JpText>家族グループを作る・参加する</JpText>
                      </h3>

                      <p className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-wrap">
                        <JpText>
                          Googleアカウントでログイン後、家族グループを「新しく作る」か「招待されて参加する」かを選びます。
                        </JpText>
                      </p>

                      {/* 作る人 / 参加する人 切替タブ */}
                      <div className="rounded-xl border border-border/80 bg-muted/40 p-1 mb-4 flex">
                        <button
                          type="button"
                          onClick={() => setFamilyFlowTab("creator")}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                            familyFlowTab === "creator"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          家族を作る人
                        </button>
                        <button
                          type="button"
                          onClick={() => setFamilyFlowTab("joiner")}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                            familyFlowTab === "joiner"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          招待される人
                        </button>
                      </div>

                      {/* 切替解説 ＆ ビジュアルモック */}
                      <div className="rounded-xl bg-muted/30 border border-border/60 p-4 text-xs sm:text-sm text-muted-foreground space-y-3 mb-4 flex-1">
                        {familyFlowTab === "creator" ? (
                          <>
                            <div className="space-y-1">
                              <p className="font-bold text-foreground text-sm">
                                <JpText>
                                  ① 家族名と「パスコード」を決める
                                </JpText>
                              </p>
                              <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                                <JpText>
                                  お好きな家族名と、忘れない家族共通のパスコードを決めるだけ。招待リンクやQRコードを発行してご家族に送りましょう。
                                </JpText>
                              </p>
                            </div>

                            <div className="rounded-lg bg-background border border-border p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs font-medium text-foreground">
                                <span className="flex items-center gap-1.5 font-bold">
                                  <QrCode className="h-4 w-4 text-orange-500" />
                                  招待リンク・QR発行
                                </span>
                                <span className="text-[11px] bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded font-medium">
                                  LINE等で共有可
                                </span>
                              </div>
                              <div className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5 text-xs text-muted-foreground font-mono truncate">
                                <span>poohma.app/invite/...</span>
                                <Share2 className="h-3.5 w-3.5 text-foreground shrink-0 ml-2" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="space-y-1">
                              <p className="font-bold text-foreground text-sm">
                                <JpText>
                                  ① 届いたリンクやQRコードで参加申請
                                </JpText>
                              </p>
                              <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                                <JpText>
                                  招待リンクを開いたり、QRコードを読み込んで、「参加申請」を押すだけ。管理者がワンタップで「承認」すればすぐにグループに合流できます。
                                </JpText>
                              </p>
                            </div>

                            <div className="rounded-lg bg-background border border-border p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-foreground">
                                  参加申請中: お母さん
                                </span>
                                <span className="text-[11px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded font-semibold">
                                  承認待ち
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                管理者が画面上で「承認」を押すと参加完了！
                              </p>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="pt-3 border-t border-border/60">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingTipTarget("tip-role");
                            handleTabChange("tips");
                          }}
                          className="text-xs text-primary hover:underline font-medium flex items-center justify-between w-full"
                        >
                          <span>
                            💡 共有レコードの誤操作を防ぐ「一般権限」とは？
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>

                    {/* STEP 2 */}
                    <div className="relative flex flex-col rounded-2xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-white font-bold text-sm shadow-xs">
                          2
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                          所要時間 1分
                        </span>
                      </div>

                      <h3 className="text-base sm:text-lg font-bold text-foreground mb-2">
                        <JpText>サービスと「ヒント」を登録する</JpText>
                      </h3>

                      <p className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-wrap">
                        <JpText>
                          NetflixやWi-Fiなど、共有したいアカウントを登録します。本物のパスワードは預からず、家族に伝わる「ヒント」を入力します。
                        </JpText>
                      </p>

                      {/* UIプレビュー風カード */}
                      <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3 mb-4 flex-1">
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground font-medium">
                            WebサイトのURLを入力:
                          </span>
                          <div className="font-mono text-xs text-foreground font-medium bg-background px-3 py-1.5 rounded-lg border border-border">
                            netflix.com
                          </div>
                        </div>

                        {/* 自動セットプレビュー */}
                        <div className="rounded-lg bg-background border border-border p-3 space-y-2 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-md bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold text-xs">
                                N
                              </div>
                              <span className="font-bold text-xs sm:text-sm text-foreground">
                                Netflix（ネットフリックス）
                              </span>
                            </div>
                            <span className="text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-medium">
                              家族共有
                            </span>
                          </div>

                          <div className="bg-muted/50 rounded-md p-2.5 text-xs space-y-1">
                            <p className="text-muted-foreground font-mono">
                              ログインID: kazoku@example.com
                            </p>
                            <p className="text-foreground font-semibold">
                              ヒント: 実家の愛犬の名前＋母の誕生月
                            </p>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          <JpText>
                            ※URLを入れるだけで、サービス名や画像、五十音用のふりがなが自動でセットされます。
                          </JpText>
                        </p>
                      </div>

                      <div className="pt-3 border-t border-border/60">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingTipTarget("tip-csv");
                            handleTabChange("tips");
                          }}
                          className="text-xs text-primary hover:underline font-medium flex items-center justify-between w-full"
                        >
                          <span>💡 CSVファイルで一括取り込み</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      </div>
                    </div>

                    {/* STEP 3 */}
                    <div className="relative flex flex-col rounded-2xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white font-bold text-sm shadow-xs">
                          3
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                          日常の操作
                        </span>
                      </div>

                      <h3 className="text-base sm:text-lg font-bold text-foreground mb-2">
                        <JpText>ヒントを見てログインする</JpText>
                      </h3>

                      <p className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-wrap">
                        <JpText>
                          普段の使い方はこれだけ！スマートフォンの指紋・顔認証でワンタップ解除し、ログインIDをコピーして使います。
                        </JpText>
                      </p>

                      {/* 3コマ操作フローの図解 */}
                      <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-3 mb-4 flex-1">
                        <div className="text-xs font-bold text-foreground pb-1 border-b border-border/60 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                          簡単3ステップのログイン手順
                        </div>

                        <div className="space-y-2.5 text-xs">
                          {/* コマ 1 */}
                          <div className="rounded-lg bg-background border border-border p-2.5 flex items-start gap-2.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[11px]">
                              1
                            </span>
                            <div>
                              <p className="font-bold text-foreground">
                                PoohMaでログインIDをコピー
                              </p>
                              <p className="text-muted-foreground text-[11px] leading-relaxed">
                                指紋・顔認証でサッと開き、1タップでIDをコピー。ヒントを見てパスワードを思い出します。
                              </p>
                            </div>
                          </div>

                          {/* コマ 2 */}
                          <div className="rounded-lg bg-background border border-border p-2.5 flex items-start gap-2.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[11px]">
                              2
                            </span>
                            <div>
                              <p className="font-bold text-foreground">
                                使いたいアプリやサイトを開く
                              </p>
                              <p className="text-muted-foreground text-[11px] leading-relaxed">
                                Netflix等のログイン画面へそのまま移動します。
                              </p>
                            </div>
                          </div>

                          {/* コマ 3 */}
                          <div className="rounded-lg bg-background border border-border p-2.5 flex items-start gap-2.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[11px]">
                              3
                            </span>
                            <div>
                              <p className="font-bold text-foreground">
                                IDを貼り付け・パスワード入力
                              </p>
                              <p className="text-muted-foreground text-[11px] leading-relaxed">
                                コピーしたIDを貼り付け、思い出したパスワードを入力してログイン完了！
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-border/60">
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Lock className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <span>画面を閉じると自動で鍵がかかる安全設計</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 家族パスコードによるヒント復号（ロック解除）体験デモエリア */}
                  <HintDecryptDemo />
                </div>
              </CarouselItem>

              <CarouselItem
                aria-label="便利な機能・Tips"
                className="pl-0 basis-full min-w-full"
              >
                {/* ──────────────────────────────────────────────────────────
             【便利な機能・Tipsタブ】応用編：使いこなすための安心・便利機能
             ────────────────────────────────────────────────────────── */}
                <div className="space-y-10">
                  <div className="text-center max-w-2xl mx-auto">
                    <Badge
                      variant="outline"
                      className="mb-2 text-xs font-semibold tracking-wider text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5"
                    >
                      PRO TIPS & ADVANCED
                    </Badge>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
                      <JpText>もっと便利に使いこなす Tips（応用編）</JpText>
                    </h2>
                    <p className="mt-2 text-sm sm:text-base text-muted-foreground whitespace-pre-wrap">
                      <JpText>
                        慣れてきたら知っておきたい、家族運用の安心設定や便利な機能をまとめました。
                      </JpText>
                    </p>
                  </div>

                  <div className="space-y-6">
                    {/* Tip 1: サブスク・Wi-Fiの家族共有 */}
                    <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xs">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-7 space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-600 dark:text-orange-400">
                            <Users className="h-4 w-4" />
                            活用シーン 01
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            <JpText>
                              サブスクや自宅Wi-Fiを家族みんなで共有する
                            </JpText>
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            <JpText>
                              動画配信サービスや音楽配信、自宅のWi-Fiルーター設定など、家族全員が使うアカウントを「家族共有」で登録しておけば、誰かがパスワードを変えてもヒントを更新するだけで家族全員に一瞬で同期されます。
                            </JpText>
                          </p>
                          <ul className="text-xs sm:text-sm text-muted-foreground space-y-2 pt-1">
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                同時編集検知により、家族同士の上書き事故をリアルタイムで防止
                              </span>
                            </li>
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                1つのサービスにプロファイル別など最大10件のアカウントを登録可能
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* UIモック */}
                        <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border/60">
                            <span className="text-xs font-bold text-foreground">
                              家族共有の登録例
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              リアルタイム同期中
                            </Badge>
                          </div>
                          <div className="rounded-lg bg-background border border-border p-3.5 space-y-2 shadow-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-foreground">
                                自宅 Wi-Fi ルーター
                              </span>
                              <span className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded font-semibold">
                                家族共有
                              </span>
                            </div>
                            <div className="bg-muted/50 rounded p-2.5 text-xs space-y-1">
                              <p className="text-muted-foreground">
                                SSID: Home_WiFi_5G
                              </p>
                              <p className="text-foreground font-semibold">
                                ヒント: 冷蔵庫のマグネット番号＋愛猫の誕生日
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tip 2: 自分専用の秘密メモ */}
                    <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xs">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-7 space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400">
                            <Lock className="h-4 w-4" />
                            活用シーン 02
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            <JpText>
                              家族に見られたくない「自分専用の秘密メモ」
                            </JpText>
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            <JpText>
                              家族グループに所属していても、登録時に所有設定を「自分のみ（個人用）」にするだけで、家族のメンバーであっても一覧にすら表示されません。完全に独立したプライベートなアカウント帳として安全に併用できます。
                            </JpText>
                          </p>
                          <ul className="text-xs sm:text-sm text-muted-foreground space-y-2 pt-1">
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                高度なセキュリティで保護され、あなた以外は閲覧不能
                              </span>
                            </li>
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                あとからいつでもワンタップで「家族共有」に変更可能
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* UIモック */}
                        <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border/60">
                            <span className="text-xs font-bold text-foreground">
                              公開範囲の切り替え
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ワンタップ切替
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-lg border border-border bg-background p-3 text-center opacity-60">
                              <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground font-medium">
                                家族共有
                              </span>
                            </div>
                            <div className="rounded-lg border-2 border-blue-500 bg-blue-500/5 p-3 text-center shadow-xs">
                              <Lock className="h-5 w-5 mx-auto mb-1 text-blue-600 dark:text-blue-400" />
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                自分のみ（個人用）
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground text-center">
                            家族の画面には一切表示されず、あなただけが見られます
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Tip 3: 実家の親・シニア見守り（一般権限と五十音順） */}
                    <div
                      id="tip-role"
                      className="scroll-mt-40 rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xs"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-7 space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            <UserCheck className="h-4 w-4" />
                            活用シーン 03
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            <JpText>
                              共有データの誤操作を防ぐ「一般権限」＆
                              五十音あ〜わ順
                            </JpText>
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            <JpText>
                              ITが苦手な親御さんでも迷わないよう、画面端の「あ〜わ」五十音順バーですぐに探せます。また、家族から共有されたレコードにはデフォルトで変更・削除権限がつかない「一般権限（メンバー）」として参加してもらうことで、大切な共有アカウントの誤操作事故を防止できます。（※メンバー自身による新規レコード作成や自分からの家族共有は通常通り自由に行えます）
                            </JpText>
                          </p>
                          <ul className="text-xs sm:text-sm text-muted-foreground space-y-2 pt-1">
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                五十音順で探すための「ふりがな」はURL入力時に自動入力
                              </span>
                            </li>
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                ファミリー管理者は招待承認や設定変更が可能。一般メンバーは共有されたデータを安全に利用
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* UIモック */}
                        <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border/60">
                            <span className="text-xs font-bold text-foreground">
                              メンバー権限一覧
                            </span>
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
                              2名所属中
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className="rounded-lg bg-background border border-border p-3 flex items-center justify-between">
                              <div>
                                <p className="text-xs sm:text-sm font-bold text-foreground">
                                  あなた（作成者）
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  管理・編集・招待承認が可能
                                </p>
                              </div>
                              <Badge variant="default" className="text-xs">
                                ファミリー管理者
                              </Badge>
                            </div>
                            <div className="rounded-lg bg-background border border-border p-3 flex items-center justify-between">
                              <div>
                                <p className="text-xs sm:text-sm font-bold text-foreground">
                                  お母さん
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  被共有データの誤変更を防止
                                </p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                メンバー（一般権限）
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tip 4: 実家と自宅の複数アカウント切替 */}
                    <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xs">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-7 space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-purple-500/10 px-3 py-1 text-xs font-bold text-purple-600 dark:text-purple-400">
                            <RefreshCw className="h-4 w-4" />
                            活用シーン 04
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            <JpText>
                              実家用・自分の家庭用など複数グループを使い分け
                            </JpText>
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            <JpText>
                              1つのGoogleアカウントで、実家用・自分の家庭用など複数のグループを保持できます。メニューからワンタップで切り替えられ、別のGoogleアカウントで入り直す手間が一切ありません。
                            </JpText>
                          </p>
                          <ul className="text-xs sm:text-sm text-muted-foreground space-y-2 pt-1">
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                切り替え時に直前のグループを自動で安全に再ロック
                              </span>
                            </li>
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                グループごとに異なる家族パスコードで安全に分離
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* UIモック */}
                        <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border/60">
                            <span className="text-xs font-bold text-foreground">
                              グループ切替メニュー
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ワンタップ
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className="rounded-lg bg-background border-2 border-purple-500/60 p-3 flex items-center justify-between shadow-xs">
                              <div>
                                <p className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5">
                                  <Check className="h-4 w-4 text-purple-600" />
                                  実家グループ
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  親と共有中（3名）
                                </p>
                              </div>
                              <span className="text-xs bg-purple-500/10 text-purple-600 px-2 py-0.5 rounded font-bold">
                                選択中
                              </span>
                            </div>
                            <div className="rounded-lg bg-background border border-border p-3 flex items-center justify-between opacity-70">
                              <div>
                                <p className="text-xs sm:text-sm font-medium text-foreground">
                                  マイファミリー
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  配偶者と共有中（2名）
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                切替可能
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Tip 5: CSVからの一括取り込み */}
                    <div
                      id="tip-csv"
                      className="scroll-mt-40 rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xs"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-7 space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                            <FileSpreadsheet className="h-4 w-4" />
                            活用シーン 05
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold text-foreground">
                            <JpText>
                              CSVやExcel・メモ帳からのアカウント一括取り込み
                            </JpText>
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            <JpText>
                              すでに表計算ソフトやメモ帳に記録していた大量のアカウント情報を、CSVインポートでまとめて取り込めます（最大500件）。既存データとの重複チェック、画像の自動取得、端末内での一括暗号化に対応しています。
                            </JpText>
                          </p>
                          <ul className="text-xs sm:text-sm text-muted-foreground space-y-2 pt-1">
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                既存データとの重複は「新規追加・上書き・スキップ」を選べる
                              </span>
                            </li>
                            <li className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>
                                CSV書き出し（エクスポート）にも対応し、いつでも手元に保管可能
                              </span>
                            </li>
                          </ul>
                        </div>

                        {/* UIモック */}
                        <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border/60">
                            <span className="text-xs font-bold text-foreground">
                              CSVインポートプレビュー
                            </span>
                            <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded font-medium">
                              24件検出
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div className="rounded bg-background border border-border p-2.5 flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">
                                Amazon Prime
                              </span>
                              <span className="text-[11px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded font-medium">
                                新規追加
                              </span>
                            </div>
                            <div className="rounded bg-background border border-border p-2.5 flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">
                                YouTube Premium
                              </span>
                              <span className="text-[11px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded font-medium">
                                上書き更新
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground text-center">
                            取り込みボタンを押すと、スマホ内で自動暗号化されて保存されます
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CarouselItem>
            </CarouselContent>
          </Carousel>
        </div>
      </div>

      {/* ─── ③ もしもの時の安心設計（トラブルシューティング） ─── */}
      <section
        id="recovery"
        className="scroll-mt-16 py-12 md:py-20 border-t border-b border-border/60 bg-muted/20"
      >
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center mb-10">
            <Badge
              variant="outline"
              className="mb-2 text-xs font-semibold tracking-wider text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/5"
            >
              TROUBLESHOOTING & RECOVERY
            </Badge>
            <h2 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
              <JpText>もしもの時も安心！トラブル・復元ガイド</JpText>
            </h2>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground whitespace-pre-wrap">
              <JpText>
                スマートフォンの買い替えや、万が一パスコードを忘れてしまった場合の対策を網羅しています。
              </JpText>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {/* 1. 機種変更のとき */}
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 flex flex-col shadow-xs">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-foreground">
                    <JpText>スマホを買い替えたとき（機種変更）</JpText>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    面倒なデータ移行作業は一切不要です
                  </p>
                </div>
              </div>

              <div className="space-y-3.5 text-xs sm:text-sm text-muted-foreground flex-1">
                <p className="leading-relaxed whitespace-pre-wrap">
                  <JpText>
                    新しいスマートフォンのブラウザでPoohMaを開き、同じGoogleアカウントでログインして、いつもの「家族パスコード」を入力するだけで完了です。
                  </JpText>
                </p>
                <div className="rounded-xl bg-muted/40 p-3.5 space-y-2 border border-border/60">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    引き継ぎの流れ（たったの2分）
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground pl-1">
                    <li>新しい端末でGoogleログイン</li>
                    <li>いつもの家族パスコードを入力して解除</li>
                    <li>新しい端末の指紋・顔認証を再登録</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* 2. パスコード忘却対策（A4印刷用リカバリーキット） */}
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 flex flex-col shadow-xs">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-foreground">
                    <JpText>紙で保管できるA4印刷用リカバリーキット</JpText>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    金庫や大切な書類入れに保管できます
                  </p>
                </div>
              </div>

              <div className="space-y-3.5 text-xs sm:text-sm text-muted-foreground flex-1">
                <p className="leading-relaxed whitespace-pre-wrap">
                  <JpText>
                    万が一家族パスコードを忘れた場合に備え、復元コードとQRコードが記載されたA4シート（PDF）を発行できます。紙に印刷して保管したり、Google
                    Driveへ安全に保存できます。
                  </JpText>
                </p>

                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs pb-1.5 border-b border-border/60">
                    <span className="font-bold text-foreground">
                      復元シートの記載内容
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      PDF形式
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                      <QrCode className="h-7 w-7 text-foreground" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <p className="text-muted-foreground">
                        復元用コード（24桁）
                      </p>
                      <p className="font-mono font-bold text-foreground tracking-wider">
                        XXXX-XXXX-XXXX-XXXX
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-blue-500 shrink-0" />
                    <span>
                      復元コード ＋ メール認証コードの二重確認で安全に再設定
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ④ よくある質問（FAQアコーディオン） ─── */}
      <section
        id="faq-preview"
        className="scroll-mt-16 py-12 md:py-20 border-b border-border/60 bg-background"
      >
        <div className="mx-auto max-w-[800px] px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <Badge
              variant="outline"
              className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground border-border bg-muted/50"
            >
              FAQ
            </Badge>
            <h2 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
              <JpText>よくあるご質問</JpText>
            </h2>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground whitespace-pre-wrap">
              <JpText>
                利用開始前によくいただく疑問にお答えします。タップして回答を開けます。
              </JpText>
            </p>
          </div>

          <Accordion type="single" collapsible className="w-full space-y-3">
            <AccordionItem
              value="q1"
              className="rounded-xl border border-border bg-card px-4 sm:px-6 shadow-xs"
            >
              <AccordionTrigger className="text-sm sm:text-base font-bold text-foreground py-4 hover:no-underline text-left">
                <JpText>
                  実際のパスワードを保存しなくて、本当にログインできますか？
                </JpText>
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-muted-foreground leading-relaxed pb-4 whitespace-pre-wrap">
                <JpText>
                  はい、十分にログインできます。日常のパスワードの多くは「家族の誕生日」「昔飼っていたペットの名前」など、本人や家族だけが思い当たるパターンで作られています。完全な文字列を預けず「ヒント」で管理することで、万が一の外部漏洩時も第三者に悪用されるリスクを劇的に抑えられます。
                </JpText>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem
              value="q2"
              className="rounded-xl border border-border bg-card px-4 sm:px-6 shadow-xs"
            >
              <AccordionTrigger className="text-sm sm:text-base font-semibold text-foreground py-4 hover:no-underline text-left">
                <JpText>
                  家族パスコードを忘れてしまった場合はどうすればいいですか？
                </JpText>
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-muted-foreground leading-relaxed pb-4 whitespace-pre-wrap">
                <JpText>
                  PoohMaはセキュリティのため、運営側でもパスコードをお調べすることはできません。ただし、事前に発行できる「印刷用リカバリーキット（復元コード）」があれば、登録メール宛に届く確認コードと組み合わせて安全に新しいパスコードを再設定できます。
                </JpText>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem
              value="q3"
              className="rounded-xl border border-border bg-card px-4 sm:px-6 shadow-xs"
            >
              <AccordionTrigger className="text-sm sm:text-base font-semibold text-foreground py-4 hover:no-underline text-left">
                <JpText>
                  家族に知られたくない個人的なアカウントも管理できますか？
                </JpText>
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-muted-foreground leading-relaxed pb-4 whitespace-pre-wrap">
                <JpText>
                  はい、管理できます。各アカウントの登録時に「自分のみ（個人用）」を選択すれば、家族グループのメンバーであっても一切閲覧できません。自分専用のプライベートなヒント帳として安心して併用いただけます。
                </JpText>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem
              value="q4"
              className="rounded-xl border border-border bg-card px-4 sm:px-6 shadow-xs"
            >
              <AccordionTrigger className="text-sm sm:text-base font-semibold text-foreground py-4 hover:no-underline text-left">
                <JpText>
                  スマートフォンを機種変更した時の引き継ぎ方法は？
                </JpText>
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-muted-foreground leading-relaxed pb-4 whitespace-pre-wrap">
                <JpText>
                  特別な移行作業は不要です。新しいスマートフォンのブラウザでPoohMaにアクセスし、同じGoogleアカウントでログイン後、いつもの家族パスコードを入力するだけで全データが復元されます。新しい端末で改めて生体認証（指紋・Face
                  ID）をご登録ください。
                </JpText>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem
              value="q5"
              className="rounded-xl border border-border bg-card px-4 sm:px-6 shadow-xs"
            >
              <AccordionTrigger className="text-sm sm:text-base font-semibold text-foreground py-4 hover:no-underline text-left">
                <JpText>生体認証（Touch ID / Face ID）は安全ですか？</JpText>
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-muted-foreground leading-relaxed pb-4 whitespace-pre-wrap">
                <JpText>
                  スマートフォンの標準規格（WebAuthn）による安全な生体認証を採用しています。生体情報そのものが外部やサーバーに送信されることは一切なく、端末内の安全なセキュア領域でのみ照合・認証代行が行われるため、極めて安全です。
                </JpText>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="mt-8 text-center">
            <Button
              asChild
              variant="outline"
              className="gap-2 text-xs sm:text-sm h-11 px-6 rounded-xl border-border bg-card hover:bg-accent shadow-xs"
            >
              <Link to="/faq">
                <HelpCircle className="h-4 w-4" />
                もっと詳しいFAQ（よくある質問一覧）を見る
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── ⑦ コンテキスト連動スマートCTA ─── */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-background to-muted/30 border-t border-border/60">
        <div className="mx-auto max-w-[800px] px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 mb-6">
            <ShieldCheck className="h-7 w-7" />
          </div>

          {isAuthenticated ? (
            /* ログイン済みユーザー向けCTA */
            <div className="space-y-4">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                <JpText>ダッシュボードへ戻りましょう</JpText>
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
                <JpText>
                  使い方の流れはバッチリです。さっそくサービスを登録したり、家族のアカウントを確認してみましょう。
                </JpText>
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <Button
                  asChild
                  className="w-full sm:w-auto h-12 px-8 text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 rounded-xl shadow-sm"
                >
                  <Link to="/dashboard">ダッシュボードを開く</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full sm:w-auto h-12 px-8 text-sm font-semibold rounded-xl border-border bg-card hover:bg-accent"
                >
                  <Link to="/family">家族管理を見る</Link>
                </Button>
              </div>
            </div>
          ) : (
            /* 未ログインユーザー向けCTA */
            <div className="space-y-4">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                <JpText>さあ、家族ではじめましょう</JpText>
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
                <JpText>
                  登録はわずか1分。パスワードを教え合う不安や、メモ紛失による漏洩リスクから家族を守ります。
                </JpText>
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <Button
                  asChild
                  className="w-full sm:w-auto h-12 px-8 text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 rounded-xl shadow-sm"
                >
                  <Link to="/login">ログインして始める</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full sm:w-auto h-12 px-8 text-sm font-semibold rounded-xl border-border bg-card hover:bg-accent"
                >
                  <Link to="/">トップページへ</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 家族パスコードによるヒント表示（ロック解除）体験シミュレーター
 * サービス詳細画面のUI構造を安全なモックデータで忠実に再現
 */
function HintDecryptDemo() {
  const [demoStatus, setDemoStatus] = useState<
    "locked" | "dialog" | "typing" | "submitting" | "unlocked"
  >("locked");
  const [typedCount, setTypedCount] = useState(0);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedHint, setCopiedHint] = useState(false);
  const [copyError, setCopyError] = useState<"id" | "hint" | null>(null);
  const maxChars = 8;
  const timerRefs = useRef<NodeJS.Timeout[]>([]);

  const clearTimers = () => {
    for (const t of timerRefs.current) {
      clearTimeout(t);
    }
    timerRefs.current = [];
  };

  const handleStartDemo = () => {
    clearTimers();
    setDemoStatus("dialog");
    setTypedCount(0);

    // 1. ダイアログ表示後、タイピング開始
    const t1 = setTimeout(() => {
      setDemoStatus("typing");
      for (let i = 1; i <= maxChars; i++) {
        const tTyping = setTimeout(() => {
          setTypedCount(i);
          if (i === maxChars) {
            // 2. 入力完了後、0.4秒後に「ロック解除」を押下
            const tSub = setTimeout(() => {
              setDemoStatus("submitting");
              // 3. スピナー回転後、0.7秒後に復号完了
              const tDone = setTimeout(() => {
                setDemoStatus("unlocked");
              }, 700);
              timerRefs.current.push(tDone);
            }, 400);
            timerRefs.current.push(tSub);
          }
        }, i * 110);
        timerRefs.current.push(tTyping);
      }
    }, 450);
    timerRefs.current.push(t1);
  };

  const handleReset = () => {
    clearTimers();
    setDemoStatus("locked");
    setTypedCount(0);
  };

  useEffect(() => {
    return () => {
      for (const t of timerRefs.current) {
        clearTimeout(t);
      }
      timerRefs.current = [];
    };
  }, []);

  const isDialogOpen =
    demoStatus === "dialog" ||
    demoStatus === "typing" ||
    demoStatus === "submitting";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-7 shadow-xs max-w-xl mx-auto space-y-5 text-left">
      <div className="text-center space-y-1.5">
        <Badge
          variant="outline"
          className="text-xs text-primary border-primary/20 bg-primary/5 inline-flex items-center gap-1 mb-1"
        >
          <Sparkles className="h-3 w-3" />
          <span>アプリの画面で体験</span>
        </Badge>
        <h3 className="text-base sm:text-lg font-bold text-foreground">
          <JpText>ヒントのロック解除体験</JpText>
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground whitespace-pre-wrap">
          <JpText>
            実際のアプリと同じ操作感を試せます。「🔒
            クリックして表示」を押すと、パスコードを入力して安全にヒントが表示されます。
          </JpText>
        </p>
      </div>

      {/* サービス詳細画面（実機スクショ IMG_9810.png 忠実再現フレーム） */}
      <div className="relative rounded-xl border border-border bg-card shadow-sm overflow-hidden space-y-4 p-4 sm:p-6">
        {/* ① 画面ヘッダーナビゲーション（戻るボタン & ページを共有） */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40 text-xs">
          <div className="text-[13px] font-medium text-muted-foreground flex items-center gap-1 select-none">
            <span className="text-[15px] leading-none mb-0.5">←</span>
            <span>ダッシュボードに戻る</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-xs select-none">
            <Share2 className="h-3.5 w-3.5" />
            <span>ページを共有</span>
          </div>
        </div>

        {/* ② OGP ヘッダー（画像未設定時の「サ」プレースホルダー） */}
        <div className="relative aspect-video w-full rounded-lg bg-muted flex items-center justify-center overflow-hidden">
          <div className="text-5xl font-bold text-muted-foreground/30 select-none">
            サ
          </div>
        </div>

        {/* ③ 基本情報（タイトル & バッジ & 作成者） */}
        <div className="space-y-3 pt-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            サクラ引越サービス
          </h1>

          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium tracking-wide bg-blue-100/50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              共有中 (2名管理)
            </span>
            <span className="rounded-full bg-secondary text-foreground px-3 py-1 text-[12px] font-medium flex items-center gap-1 select-none">
              <Users className="h-3 w-3" />
              <span>共有設定</span>
            </span>
          </div>

          <div className="space-y-1 text-[13px] text-muted-foreground pt-1">
            <div className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 font-medium text-muted-foreground">
                作成者:
              </span>
              <span className="min-w-0 flex-1 truncate">
                家族の管理者 (kazoku@example.com)
              </span>
            </div>
          </div>
        </div>

        {/* ④ アカウント情報セクション（CredentialCard 完全再現） */}
        <div className="space-y-2 pt-2">
          <h2 className="text-[16px] sm:text-[18px] font-semibold text-foreground tracking-tight border-b border-border pb-2">
            アカウント情報
          </h2>

          <div className="rounded-md bg-muted/50 p-4 sm:p-5 border border-border/50 relative space-y-4">
            {/* ログインID欄 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">
                  ログインID
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    setCopyError(null);
                    try {
                      if (!navigator.clipboard) {
                        throw new Error("Clipboard API is unavailable");
                      }
                      await navigator.clipboard.writeText("kazoku@example.com");
                      setCopiedId(true);
                      setTimeout(() => setCopiedId(false), 1500);
                    } catch {
                      setCopiedId(false);
                      setCopyError("id");
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copyError === "id" ? (
                    <span className="text-destructive font-medium">
                      コピー失敗
                    </span>
                  ) : copiedId ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-500" />
                      <span className="text-emerald-500 font-medium">
                        コピー完了
                      </span>
                    </>
                  ) : (
                    <span>コピー</span>
                  )}
                </button>
              </div>
              <div className="font-mono text-sm text-foreground select-all">
                kazoku@example.com
              </div>
            </div>

            {/* パスワードヒント欄 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">
                  パスワードヒント
                </span>
                {demoStatus === "unlocked" && (
                  <button
                    type="button"
                    onClick={async () => {
                      setCopyError(null);
                      try {
                        if (!navigator.clipboard) {
                          throw new Error("Clipboard API is unavailable");
                        }
                        await navigator.clipboard.writeText(
                          "実家の愛犬の名前＋母の誕生月",
                        );
                        setCopiedHint(true);
                        setTimeout(() => setCopiedHint(false), 1500);
                      } catch {
                        setCopiedHint(false);
                        setCopyError("hint");
                      }
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {copyError === "hint" ? (
                      <span className="text-destructive font-medium">
                        コピー失敗
                      </span>
                    ) : copiedHint ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500" />
                        <span className="text-emerald-500 font-medium">
                          コピー完了
                        </span>
                      </>
                    ) : (
                      <span>コピー</span>
                    )}
                  </button>
                )}
              </div>

              <div className="font-sans text-sm text-foreground whitespace-pre-wrap">
                {demoStatus === "unlocked" ? (
                  <div className="p-2.5 rounded bg-muted/40 border border-border text-foreground font-medium animate-in fade-in duration-300">
                    実家の愛犬の名前＋母の誕生月
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={handleStartDemo}
                      className="inline-flex items-center gap-1.5 rounded bg-orange-300/10 px-2.5 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition cursor-pointer active:scale-95"
                    >
                      <Lock className="h-3 w-3" />
                      <span>クリックして表示</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ⑤ 家族パスコード入力モーダル演出（PasscodeProvider完全再現） */}
        {isDialogOpen && (
          <div className="absolute inset-0 bg-background/85 backdrop-blur-xs flex items-center justify-center p-3 z-10 animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 sm:p-5 shadow-lg space-y-3.5 animate-in zoom-in-95 duration-200">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-4 w-4 text-primary" />
                    <h4 className="text-sm sm:text-base font-bold text-foreground">
                      家族パスコードの入力
                    </h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    ヒントを表示するには、家族パスコードを入力してください。
                  </p>
                </div>
              </div>

              {/* パスコード入力欄（自動タイピング） */}
              <div className="space-y-1.5">
                <div className="relative flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <div className="font-mono tracking-widest text-base sm:text-lg flex items-center min-h-[24px] text-foreground">
                    {"●".repeat(typedCount)}
                    {demoStatus === "typing" && (
                      <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary animate-pulse" />
                    )}
                  </div>
                  <div className="absolute right-3 flex items-center text-muted-foreground">
                    <Eye className="h-4 w-4 opacity-70" />
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground/80 flex items-center justify-between px-0.5">
                  <span>※ デモのため自動入力しています</span>
                  <span className="font-mono">
                    {typedCount} / {maxChars}文字
                  </span>
                </div>
              </div>

              {/* ダイアログボタン部 */}
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  className="flex-1 h-9 text-xs font-medium border-border opacity-50"
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    demoStatus !== "submitting" && typedCount < maxChars
                  }
                  className="flex-1 h-9 text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
                >
                  {demoStatus === "submitting" ? (
                    <>
                      <Spinner className="h-3.5 w-3.5 text-primary-foreground" />
                      <span>ロック解除中...</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5" />
                      <span>ロック解除</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* デモ操作バー（カード外） */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pt-0.5 text-xs">
        <div className="text-muted-foreground text-[11px] sm:text-xs">
          {demoStatus === "unlocked"
            ? "一時表示中（画面を離れると自動でロック）"
            : "※「クリックして表示」またはボタンを押すとデモが始まります"}
        </div>
        <div className="w-full sm:w-auto flex justify-end">
          {demoStatus === "unlocked" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="w-full sm:w-auto h-8 px-3 text-xs font-medium gap-1.5 rounded-lg border-border cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>もう一度見る</span>
            </Button>
          ) : !isDialogOpen ? (
            <Button
              type="button"
              size="sm"
              onClick={handleStartDemo}
              className="w-full sm:w-auto h-8 px-3.5 text-xs font-semibold gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>解除デモを再生する</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground space-y-1 leading-relaxed border border-border/50">
        <p className="font-semibold text-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>
            <JpText>
              一度パスコードを入力すれば、設定した無操作時間が経過するか、画面を閉じるまで有効
            </JpText>
          </span>
        </p>
        <p className="text-[11px] sm:text-xs">
          <JpText>
            実際のアプリでは、一度パスコードで解除すると、設定した無操作時間が経過するか画面を閉じるまで、すべてのヒントを閲覧できます。スマホの指紋認証・Face
            IDと連携すれば、ワンタッチで解除することも可能です。
          </JpText>
        </p>
      </div>
    </div>
  );
}
