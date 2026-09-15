# PoohMa Pitfalls & Gotchas Index

AI Agent が誤りやすい点、過去に問題となった点、実装上の罠をドメイン別に管理しています。
**作業対象の領域に応じたファイルのみをピンポイントで参照（`view_file`）してください（トークン効率最大化のため）**。

---

## 1. ドメイン別 Pitfalls 一覧

| ドメイン / トピック | ファイル | 主な内容 |
| :--- | :--- | :--- |
| **PR レビュー & ガードレール** | [`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md) | 外部 AI（CodeRabbit等）審査原則、生エラー非露出却下、マイグレーション過剰防衛禁止、管理者フォールバック |
| **バックエンド & Convex** | [`.ai/pitfalls/backend-convex.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/backend-convex.md) | `convex dev --once` ワンショット反映、RLS ヘルパー、FunctionReference Proxy キャッシュ汚染、ID 混同、キック検証 |
| **認証 & セッション管理** | [`.ai/pitfalls/auth-session.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/auth-session.md) | Firebase Auth Single Source of Truth、Session Cookie 過剰依存、ログアウト競合、リカバリー失効検証、白画面バウンス |
| **暗号化 (E2EE) & WebAuthn** | [`.ai/pitfalls/crypto-e2ee.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/crypto-e2ee.md) | WebAuthn PRF の役割、CryptoKey `extractable`、`KDF_VERSIONS` 追記原則 |
| **E2E テスト & ルーティング** | [`.ai/pitfalls/e2e-testing.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/e2e-testing.md) | プロダクションコード改変禁止、Playwright CORS 拒否、ログアウト順序、家族状態 UI 分岐、暗号化タイムアウト |
| **実行環境 & PowerShell** | [`.ai/pitfalls/environment-shell.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/environment-shell.md) | Windows PowerShell `&&` 禁止、丸括弧パスのエスケープ、UTF-8 一時ファイル経由コミット |
| **UI・設定・モノレポ** | [`.ai/pitfalls/ui-and-misc.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/ui-and-misc.md) | CI ダミー環境変数、CSP 設定、Google Picker 制約、CSS ネガティブマージン横揺れ |

---

## 2. キーワード逆引き索引

- **CodeRabbit / 外部AI**: [`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md)
- **toast.error / 生エラー / CWE-209**: [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) 第5節、[`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md)
- **マイグレーション / バックフィル**: [`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md)
- **convex dev --once / スキーマ同期**: [`.ai/pitfalls/backend-convex.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/backend-convex.md)
- **Session Cookie / ログアウト**: [`.ai/pitfalls/auth-session.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/auth-session.md)
- **Playwright / E2E / テスト失敗**: [`.ai/pitfalls/e2e-testing.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/e2e-testing.md)
- **PowerShell / 文字化け / コミット**: [`.ai/pitfalls/environment-shell.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/environment-shell.md)、[`.ai/workflows/git-workflow.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/workflows/git-workflow.md)
