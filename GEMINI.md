# Project Rules & System Instructions

## 0. Core Guardrails & Production Protection (最重要不変原則)

- **テスト・CI失敗時のプロダクションコード改変禁止**:
  - CI やテスト（E2E、ユニットテスト等）が失敗した際、**テストを通すためだけにプロダクションコード（`apps/web/src/` や `apps/web/convex/` 等）のタグ、DOM構造、挙動を独断で改変することは固く禁ずる**。
  - テストが失敗した場合は、まずテスト自体のセレクタ、待機処理、前提データ（家族所属状態、認証状態など）の不備を疑い、テストコード側の改善で解決を試みること。
  - テスト失敗の根本原因がプロダクションコード側の不具合であり修正が必要と判断した場合（アクセシビリティ対応や `data-testid` 付与などを含む）でも、**手を動かす前に必ずユーザーへ「事象・原因・修正案」を報告し、合意を得てから変更する**こと。
  - ※ ユーザーから明示的に依頼された新機能実装や機能改善、仕様変更等に伴うプロダクションコード変更は通常通り進めて良い。
- **コミット前のローカル動的検証（`pnpm test:e2e`）の義務**:
  - UI、認証、E2EE暗号処理、Convexバックエンド連携、データ移行やインポート/エクスポート等、フロントエンドまたは結合動作に影響を与える変更を行った際は、コミット前に必ずローカルで `pnpm test:e2e` を実行し、全テスト合格を確認してからコミットすること。静的チェック（`pnpm verify`）のみで済ませてはならない。
- **外部 AI / 静的レビュー指摘（CodeRabbit 等）の審査原則（盲目的追従の禁止）**:
  - CodeRabbit 等の外部 AI レビュアーの指摘をそのまま鵜呑みにしてプロダクションコードに適用してはならない。
  - 特に「フロントエンドへの生エラーメッセージ（`error.message`）露出」「運用方針を無視した過剰なクライアントサイドガードコード」など、PoohMa の不変条件（[`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md)）やシンプル設計方針（KISS原則）に反する提案は、盲目的に従わず根拠を示して毅然と却下すること。
- **フロントエンドにおける内部エラー・生ログ露出の完全禁止（情報漏洩防止・CWE-209・暗号鍵保護）**:
  - `toast.error(error.message)` やモーダルでの内部スタックトレース表示は厳禁。また、E2EE暗号処理のスタックやコンテキストに暗号鍵・パスコードが含まれ漏洩するリスクを防ぐため、ブラウザ側（components, hooks, routes）で `console.error(error)` や `console.log` 等による生例外オブジェクトの垂れ流しも禁止する（[`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) 第5節）。
  - 例外発生時は `catch (_error) {}` 等で安全に握るか、ユーザー向けに設計された親切で安全な固定日本語メッセージ（例: `「インポートに失敗しました」`）のみをトースト等で表示すること。
- **マイグレーション過剰防衛コードの禁止（KISS原則）**:
  - スキーマ変更やデータ移行時、Hooks や UI 側で「未移行データを検知して操作を拒否・例外スローする」過剰なガードを入れない。移行はマイグレーションスクリプト（ワンショット実行）の責務とし、アプリ側コードはフォールバック（デフォルト値）で自然に吸収すること。
- **`.ai/` Knowledge Base の事前参照（Read）と事後還元（Write）の義務**:
  - 実装・調査・テスト・レビュー作業に着手する前に、必ず「8. 作業種別ごとの事前参照マトリクス」に従って関連するドキュメント（特に [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) や [`.ai/pitfalls/`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/)）を確認し、不変条件に抵触しないかを事前審査すること。
  - また、ユーザーからの指摘やレビュー対応、試行錯誤を通じて得られた知見は、コミット前に必ず [`.ai/pitfalls/`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/) や [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) に還元・蓄積すること。

---

## 1. Environment & Shell Context

- **OS / Shell**: Windows (PowerShell)
  - Windows PowerShell 7未満では `&&` 演算子が構文エラーになるため使用禁止。連続実行が必要な場合は `$ErrorActionPreference = "Stop"; cmd1; cmd2` を使用する。
  - パスに丸括弧 `()` や `$` が含まれる場合は必ずシングルクォート等で囲む（例: `'src/routes/(app)/records/$id.tsx'`）。
  - パイプライン（`|`）や引数直接渡しによる日本語文字化けを防ぐため、コミットや PR 作成は必ず **UTF-8 一時ファイルを経由** すること（詳細は [`.ai/workflows/git-workflow.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/workflows/git-workflow.md) 参照）。
- **Package Manager**: `pnpm`（`npm`, `yarn` は使用禁止）。

---

## 2. Quality Assurance & Verification Commands

1. **Type Check**: `pnpm typecheck`
2. **Static Check / Lint / Format**: `pnpm check`
3. **Test (Unit / Integration)**: `pnpm test`
4. **Build Check**: `pnpm build`
5. **E2E Test (Dynamic Verification)**: `pnpm test:e2e`
6. **Full Pipeline**: `pnpm verify`（上記1〜4を一括順次実行）

> **Important (動的テスト事前検証義務)**:
> UI、認証、E2EE暗号化、Convex、CSV等の変更時は、静的チェックのみでコミットせず、必ずローカルで `pnpm test:e2e` を合格させてからコミットすること。Convex 変更時は事前に `pnpm convex:dev:once` を実行すること。

---

## 3. Convex Workflow & Code Generation

- **開発環境へのワンショット反映（ローカル開発・E2Eテスト前）**:
  `pnpm convex:dev:once`（または `pnpm -F @poohma/web exec convex dev --once`）
  - 常駐プロセス化（watch モード）を回避し、開発環境への反映と型生成をワンショットで実行。
- **本番・プレビュー環境への一括同期**: `pnpm convex:sync`
- **個別に実行する場合**: `pnpm convex:deploy` / `pnpm convex:codegen`

---

## 4. Git Commit & GitHub CLI Guidelines

- **Format**: Conventional Commits 形式に従う（`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`）。
- **Body**: 必ず日本語で「なぜこの変更を行ったか」「どのような影響があるか」を明記。
- **PowerShell 実行手順**: 日本語文字化けおよびエスケープ破壊防止のため、必ず UTF-8 一時ファイルを経由する。具体的なテンプレートスクリプトは [`.ai/workflows/git-workflow.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/workflows/git-workflow.md) を参照。

---

## 5. Documentation Update Check Before Commit

- コード変更や機能追加時、関連ドキュメント（要件定義、詳細設計、デザイン、脅威モデル、セキュリティモデル、`.ai/`）の更新要否を必ず確認する。
- 複数ファイル・セクションへの波及確認手順およびマトリクス表は [`.ai/workflows/doc-sync.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/workflows/doc-sync.md) を参照。

---

## 6. Monorepo Structure

```text
poohma/                    # ルート（Turborepo）
├── apps/web/              # TanStack Start + Convex（@poohma/web）
│   ├── convex/            # Convex バックエンド（schema, functions, _generated）
│   ├── src/               # フロントエンド（@/* エイリアス）
│   └── tests/             # ユニット / 結合 / E2E テスト
├── workers/backup/        # Cloudflare Workers バックアップ（@poohma/backup）
├── .ai/                   # AI Knowledge Base（ドメイン、不変条件、落とし穴）
└── .agents/skills/        # Antigravity 専門スキル
```

---

## 7. Working with `.ai/`（事前参照マトリクス）

タスク着手時は、以下のマトリクスに従って関連ドキュメント（ピンポイントな小ファイル）を必ず事前に参照し、不変条件に抵触しないかを事前審査してください。詳細な設計思想は [`.ai/README.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/README.md) を参照。

| 作業フェーズ / タスク種別 | 必須事前参照ファイル | 特に確認すべき項目・不変条件 |
| :--- | :--- | :--- |
| **外部レビュー（CodeRabbit等）対応** | [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md)<br>[`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md) | ・トースト/UIへの生エラー非露出<br>・過剰防衛コードの排除（KISS原則）<br>・PoohMa固有の不変条件を優先 |
| **エラーハンドリング・例外処理実装** | [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) (第5節) | ・`toast.error(固定メッセージ)` 徹底<br>・ブラウザ側 `console.error` 等への生例外オブジェクト非露出（CWE-209、暗号鍵保護） |
| **スキーマ変更・DBマイグレーション** | [`.ai/domain.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/domain.md)<br>[`.ai/patterns.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/patterns.md)<br>[`.ai/pitfalls/review-and-guardrails.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/review-and-guardrails.md) | ・手動ワンショット移行（CLI）運用<br>・アプリ側に未バックフィル検査ガードを混入させない（自然なフォールバック） |
| **E2E / ユニットテスト作成・改修** | [`.ai/testing.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/testing.md)<br>[`.ai/pitfalls/e2e-testing.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/e2e-testing.md) | ・テスト失敗時のプロダクションコード改変禁止<br>・`convex dev --once` のワンショット実行<br>・家族状態によるUI分岐やAdminフォールバック |
| **認証・セッション・暗号(E2EE)** | [`.ai/invariants.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/invariants.md) (1〜4節)<br>[`.ai/pitfalls/auth-session.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/auth-session.md)<br>[`.ai/pitfalls/crypto-e2ee.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/pitfalls/crypto-e2ee.md) | ・長期セッションの Single Source of Truth（Firebase Auth）<br>・Session Cookie の位置付け<br>・鍵階層（DEK / MasterKey / PRF）の破壊防止 |
