# Project Rules & System Instructions

## 0. Testing Guardrails & Production Code Protection (最重要原則)

- **テスト・CI失敗時のプロダクションコード改変禁止**:
  - CI やテスト（E2E、ユニットテスト等）が失敗した際、**テストを通すためだけにプロダクションコード（`apps/web/src/` や `apps/web/convex/` 等）のタグ、DOM構造、挙動を独断で改変することは固く禁ずる**。
  - テストが失敗した場合は、まずテスト自体のセレクタ、待機処理、前提データ（家族所属状態、認証状態など）の不備を疑い、テストコード側の改善で解決を試みること。
  - テスト失敗の根本原因がプロダクションコード側の不具合であり修正が必要と判断した場合（アクセシビリティ対応や `data-testid` 付与などを含む）でも、**手を動かす前に必ずユーザーへ「事象・原因・修正案」を報告し、合意を得てから変更する**こと。
  - ※ ユーザーから明示的に依頼された新機能実装や機能改善、仕様変更等に伴うプロダクションコード変更は通常通り進めて良い。
- **`.ai/` Knowledge Base の事前確認の義務**:
  - 実装・調査・テスト作業に着手する前に、必ず `.ai/pitfalls.md`（特に「テスト作成時の安易なプロダクションコード改変」等の過去の失敗事例）および `.ai/invariants.md` を確認し、同一の失敗を繰り返さないこと。

## 1. Environment & Shell Context

- **OS / Shell**: Windows (PowerShell)
  - コマンド実行時のパス区切り文字やシェルコマンド（`;` の扱い、ファイル操作コマンド等）は PowerShell の構文に従うこと。
  - Windows PowerShell 7未満 では `&&` 演算子が構文エラー（`トークン '&&' は、このバージョンでは有効なステートメント区切り記号ではありません`）となるため使用できません。
  - コマンドの連続実行はパイプラインの途中での失敗をキャッチできない場合があるため、避けてください。やむを得ない場合は、先頭に `$ErrorActionPreference = "Stop"` を記述して `;` で繋ぐ（例: `$ErrorActionPreference = "Stop"; コマンド1; コマンド2`）ことで、途中でエラーが出た瞬間にスクリプト全体を安全に強制終了させてください。
  - パスに丸括弧 `()` が含まれる場合（例: `src/routes/(app)/records/$id.tsx`）、PowerShell が式として誤解釈するため、必ずダブルクォートで囲むこと（例: `git add "src/routes/(app)/records/file.tsx"`）。
- **Package Manager**: `pnpm`
  - パッケージの追加・削除・実行には必ず `pnpm` を使用すること（`npm`, `yarn` は使用禁止）。

## 2. Quality Assurance & Verification Commands

コード変更や機能実装を行った後、またはユーザーからの検証要求時は、以下のコマンドでエラーがないか確認・通過させること。

1. **Type Check**: `pnpm typecheck`（Turborepo 経由で全ワークスペースの型チェックを実行）
2. **Static Check / Lint/ Format**: `pnpm check`
3. **Test (Unit / Integration)**: `pnpm test`（Turborepo 経由で全ワークスペースの Vitest を実行）
4. **Build Check**: `pnpm build`（Turborepo 経由で全ワークスペースのビルドを実行）
5. **E2E Test**: `pnpm test:e2e`（Turborepo 経由で Playwright E2E テストを実行）
6. **Full Pipeline**: `pnpm verify`（上記1〜4を一括で順次実行し、エラー発生時に即時停止。E2Eテストは個別検証またはCIで実行）

> **Note**: 一括検証を行う際は、ルートの `pnpm verify` を使用してください（個別のスクリプトが失敗した時点で確実に処理が中断されます）。

## 3. Convex Workflow & Code Generation

Convex のスキーマ（`schema.ts`）やバックエンド関数（`convex/*.ts`）を変更した場合は、以下の手順に従ってデプロイ・型定義の生成・フォーマットを行ってください。`convex deploy` の対象環境は、実行時に設定されている `CONVEX_DEPLOY_KEY` によって決まります。

> **Warning（Watch モード常駐の回避）**:
> `convex dev` コマンドはファイル変更監視（watch モード）によってプロセスが常駐してしまうため、AI エージェント実行時や単発の型同期には使用しないでください。
> 変更を反映して最新の型定義を得る際は、必ず **ワンショットで完了する `pnpm convex:sync`（または `convex deploy` → `convex codegen`）** を使用してください。

### 同期・コード生成手順

1. **開発環境へのワンショット反映（ローカル開発・E2Eテスト前）**: `pnpm convex:dev:once`（または `pnpm -F @poohma/web exec convex dev --once`）
   - 開発インスタンス（`CONVEX_DEPLOYMENT=dev:...`）に関数・スキーマを反映し、型定義最新化とフォーマットを常駐プロセス化せずに一括実行します。
   - Playwright E2E テストは実際の Convex 開発インスタンスと通信するため、**スキーマや関数を追加・変更した後は必ず E2E テスト実行前にこのコマンドを実行してください**。
2. **本番・プレビュー環境への一括同期**: `pnpm convex:sync`
   - `convex deploy` → `convex codegen`（型定義最新化） → `pnpm check`（自動フォーマット）の順に一括実行します。
   - CI でプレビューデプロイキーを `CONVEX_DEPLOY_KEY` に設定した場合に限り、プレビュー環境へ反映されます。
3. **個別に実行する場合**:
   - **Deploy**: `pnpm convex:deploy`（実行時の `CONVEX_DEPLOY_KEY` が示す環境へのワンショット反映。プレビューデプロイキーを設定した場合に限りプレビュー環境へ反映）
   - **Codegen & Format**: `pnpm convex:codegen`（`_generated/` 型定義の最新化とフォーマット）
4. **Verify Pipeline**: `pnpm verify`
   - 型定義更新後、プロジェクト全体の一括品質検証を実行します。

本番デプロイは、プレビュー用とは別の認証情報を使用し、定められたリリース運用に従って実行してください。

## 4. Git Commit Message Guidelines

Git コミットメッセージを生成または実行する場合は、**Conventional Commits** 形式に厳格に従うこと。

### Format

```text
<type>(<scope>): <short description>

<detailed description in Japanese>
```

### Rules

- **Header (<type>)**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` 等を使用。
- **Subject**: 変更内容の要約を簡潔に記述。
- **Body（詳細文）**:
  - **必ず日本語で記述**すること。
  - 「なぜこの変更を行ったか」「どのような変更・影響があるか」を分かりやすく記載すること。

### Windows PowerShell でのコミット実行時の注意（文字化け防止）

PowerShell のパイプライン（`|`）はデフォルトの `$OutputEncoding` が ASCII や Shift-JIS の場合があり、マルチバイト日本語が `?` に化けてコミットされる原因になります。
コミットを実行する際は、必ず **UTF-8 一時ファイルを経由** するか、**`$OutputEncoding` と `[Console]::OutputEncoding` を明示的に UTF-8 に設定** すること。

#### 推奨実行例（一時ファイル経由）

```powershell
$commitMsg = @'
feat(auth): ログイン時のトークン再発行処理を追加

・トークン期限切れ時に自動でリフレッシュトークンを検証する処理を実装
・セッション切れによる意図しないログアウトを防止
'@
$tmpMsgFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpMsgFile, $commitMsg, [System.Text.Encoding]::UTF8)
try {
  git commit -F $tmpMsgFile
} finally {
  Remove-Item -Path $tmpMsgFile -Force
}
```

## 5. GitHub CLI (`gh`) Usage in PowerShell

PowerShell 上で `gh pr create` や `gh issue create` を実行して本文（Body）を渡す場合は、以下のルールを厳守すること。

- **`--body` フラグで直接ダブルクォート文字列を渡さないこと**（PowerShell が Markdown 内のバッククォート `` ` `` をエスケープ文字として誤解釈し、`\` に化けるため）。
- **パイプライン（`|`）で直接 `gh` に渡さないこと**（PowerShell のパイプラインエンコーディングによって日本語が `?` に化けるため）。
- 本文を渡す際は、必ず **UTF-8 一時ファイルを作成して `--body-file` に渡す** こと。

### 正しい実行例（一時ファイル経由）

```powershell
$prBody = @'
## 概要
`src/emails/` の作成

・`EmailTemplateDefinition` の定義
'@
$tmpBodyFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpBodyFile, $prBody, [System.Text.Encoding]::UTF8)
try {
  gh pr create --title "feat: メールテンプレートの追加" --body-file $tmpBodyFile
} finally {
  Remove-Item -Path $tmpBodyFile -Force
}
```

## 6. Documentation Update Check During Planning and Before Commit

コード変更や機能追加・仕様変更を計画時、またはコミットする前に、関連するドキュメントの更新要否を必ず確認すること。

- **対象ドキュメント**:
  - 要件定義書（`.docs/requirements.md`）
  - 詳細設計書（`.docs/code-design.md`）
  - デザイン仕様書（`.docs/DESIGN.md`, `.docs/lp-design.md`）
  - 脅威モデル（`.docs/security/threat-model.md`）
  - セキュリティモデル（`.docs/security/security-model.md`）
  - セキュリティポリシー（`SECURITY.md`）
  - プロジェクト概要・セットアップ（`README.md`）
  - AI Knowledge Base（`.ai/`）
- **運用フロー**:
  1. 計画段階で変更内容に関連するドキュメントの更新要否（機能要件の追加、DBスキーマ・API仕様・環境変数の変更、脅威モデルの更新等）を確認し、コミット前にもコード変更差分を精査して再確認する。
  2. ドキュメントの更新が必要な場合は、変更箇所・更新方針をユーザーに確認し、許諾を得た上でドキュメントの更新を行う。
  3. ドキュメント更新を含めた状態で品質検証コマンドを実行し、コミットを行う。

### ドキュメント横断整合性チェック（セルフレビュー）

PoohMa の設計書は多面的な構成（データモデル、認証フロー、API一覧、状態管理責務表、セキュリティ境界）になっているため、**1箇所の変更が複数セクション・複数ファイルに波及する**。コード変更時は、変更対象の直近ドキュメントだけでなく、以下のマトリクスに従って関連セクションを横断検索し、古い仕様の残骸を漏れなく是正すること。

| 変更の種類 | 確認すべきドキュメント箇所 |
| :--- | :--- |
| **スキーマ・テーブル構成** | `code-design.md`「4.1 ER概要」「4.2 テーブル定義」、`.ai/domain.md` |
| **Server Function / Convex 関数の追加・削除・改名** | `code-design.md`「7. API設計」「7.6 Server Functions」表、`.ai/architecture.md` |
| **認証イベント・フロー** | `code-design.md`「5.2 認証フロー」「5.6 ログアウトフロー」、`security-model.md`、`.ai/invariants.md` |
| **状態管理・ストレージ** | `code-design.md`「8.4 状態管理表」、`security-model.md`、`.ai/patterns.md` |
| **セキュリティ境界・脅威** | `security-model.md`、`threat-model.md`、`.ai/invariants.md` |
| **データ移行・UID引き継ぎ** | `code-design.md`「4.1 ER概要」「5.2 フロー」「7.1 API表」、`security-model.md`、`.ai/domain.md` |

> **Note**: 設計書の「ある1セクションだけ更新して他のセクションに古い記述が残る」ことが、外部レビュー（CodeRabbit等）で最も頻繁に指摘されるパターンである。変更対象のキーワード（関数名、テーブル名、ストレージ種別等）で設計書全体を `grep` し、関連する全箇所を同時に更新すること。

## 7. Monorepo Structure

本プロジェクトは **pnpm workspace + Turborepo** によるモノレポ構成です。

```
poohma/                    # ルート（Turborepo オーケストレーション）
├── apps/
│   └── web/               # @poohma/web（TanStack Start + Convex）
│       ├── convex/         # Convex バックエンド（schema, functions, _generated）
│       ├── src/
│       └── tests/
├── workers/
│   └── backup/            # @poohma/backup（Cloudflare Workers 定期バックアップ）
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json     # 共通 TypeScript 設定
├── biome.json             # 統一 Lint / Format 設定
└── package.json           # Turborepo スクリプト
```

- Web アプリケーションのコードは `apps/web/` 配下にあります。`src/` 内の参照には `@/*` パスエイリアスを使用してください。
- Convex 関数から `src/` 内のユーティリティを参照する場合は `../src/...` の相対パスを使用します。
- 各ワークスペースの `tsconfig.json` は `../../tsconfig.base.json` を extends しています。
- Vercel デプロイ時は Root Directory を `apps/web` に設定してください。

## 8. AI Knowledge Base

PoohMaでは、AI Agentが継続的に利用するプロジェクト固有の知識を `.ai/` に蓄積します。

### Knowledge Baseの役割

- `.docs/`: 人間向けの正規仕様・設計・要求
- `.ai/`: AI Agent向けに整理・圧縮されたプロジェクト知識
- `GEMINI.md`: Gemini / Antigravity固有の実行ルールと、`.ai/` の利用・更新ルール

`.ai/` は `.docs/` の代替ではありません。

`.docs/`、現在の実装、Git履歴、Issue / PR等と `.ai/` の内容が矛盾する場合は、根拠のある最新情報を優先し、必要に応じて `.ai/` を更新してください。

### Working with `.ai/`

Issueや実装作業を開始する際は、まず `.ai/` の構成を確認し、今回の作業に関連する知識だけを参照してください。

`.ai/` 全体を無条件に読み込む必要はありません。

基本的な流れ:

1. Issue / taskの内容を理解する
2. 関連する `.ai/` のドキュメントを確認する
3. 必要に応じて `.docs/` と現在の実装を確認する
4. `.ai/` の情報が古い、矛盾している、または不足している場合は実装・ドキュメントを正として判断する
5. 実装・テスト・レビューを行う

### `.ai/` の構成

```text
.ai/
├── architecture.md
├── invariants.md
├── patterns.md
├── pitfalls.md
├── decisions.md
├── domain.md
├── testing.md
└── workflows.md
```

#### `architecture.md`

現在のPoohMaの実装アーキテクチャ。

- workspace構成
- frontend / backend構造
- データフロー
- authentication
- Convex
- E2EE
- 主要なsource of truth
- 変更時に関連確認が必要な領域

#### `invariants.md`

変更によって破壊してはいけない不変条件。

特に以下を含む:

- E2EE
- master key
- family passcode
- authentication / authorization
- Family / User
- Recovery
- データアクセス制御
- セキュリティ境界
- 秘密情報の保存・送信

#### `patterns.md`

PoohMaで実際に採用されている、将来も再利用できる実装・調査パターン。

一般的なベストプラクティスではなく、PoohMaの実装・過去の変更から確認できるパターンを記録する。

#### `pitfalls.md`

PoohMaでAI Agentが誤りやすい点、過去に問題となった点、実装上の罠。

#### `decisions.md`

重要な設計判断と、その現在の意味。

確認できない理由や背景を推測して記録しない。

#### `domain.md`

主要エンティティの相関、ライフサイクル・状態遷移（参加申請・家族移行・リカバリー）、アクセス権マトリクス、カスケード削除ルール。

#### `testing.md`

`convex-test` によるバックエンドテスト技法、E2EE暗号テスト、UI/Providerテスト、テスト実行・検証ルール。

#### `workflows.md`

PoohMa で頻繁に実行される定型作業のワークフロー。

- CMS コンテンツレビューワークフロー

### Updating `.ai/`

Issue / implementation / reviewの作業中に、将来の作業でも再利用できる重要な知識が新たに判明した場合は、`.ai/` の更新要否を判断してください。

更新対象の例:

- 実装変更によりarchitectureが変化した
- 新しいセキュリティ上の不変条件が判明した
- 既存の実装パターンが変更された
- 今後も利用できる新しい実装・調査パターンが判明した
- 新しい実装上のpitfallが判明した
- 重要な設計判断が変更された
- 既存の `.ai/` の記述が現在の実装と一致しなくなった

更新の基本フロー:

```text
Issue
  ↓
調査
  ↓
実装
  ↓
テスト
  ↓
レビュー
  ↓
将来も再利用できる知識があるか判断
  ↓
┌───────────────┐
│ Yes           │ No
↓               ↓
.ai/を更新      何もしない
└───────────────┘
  ↓
commit / PR
```

### `.ai/` に記録してはいけないもの

以下は原則として `.ai/` に追加しないでください。

- 今回のIssueだけに固有の一時的な調査結果
- 将来再利用する可能性が低い情報
- `.docs/` の単純なコピー
- ソースコードの単純な要約
- 根拠のない推測
- AI自身が今回の作業中に一時的に採用した仮説
- 現在の実装や仕様と矛盾する古い情報

`.ai/` の更新自体を目的にしないでください。

### Source of Truth

`.ai/` の内容は常に検証可能な根拠に基づいている必要があります。

情報の判断では、以下を優先してください。

1. ユーザーによる明示的な決定
2. `.docs/security/threat-model.md`（脅威モデルおよびセキュリティ境界に関する Source of Truth）
3. 現在の実装
4. `.docs/` の最新仕様・設計
5. Git履歴
6. Issue / PR等の履歴情報
7. `.ai/` の既存情報

脅威モデルおよびセキュリティ境界に関する判断では、`.docs/security/threat-model.md` を Source of Truth とし、セキュリティ要件が現在の実装や `.ai/` の情報と矛盾する場合も `.docs/security/threat-model.md` を優先してください。

既存の `.ai/` が上記と矛盾する場合、既存の `.ai/` を修正してください。

### Knowledge Baseの更新粒度

`.ai/` は「AIが毎回読み込む巨大なプロジェクト概要」ではありません。

必要な情報を必要なときに参照できるよう、情報を適切なファイルに分離してください。

また、同じ情報を複数の `.ai/` ファイルへ重複して記載しないでください。

目的は、AI Agentが過去の知識を再利用することで、

- repository探索
- 設計判断
- 過去の問題の再調査
- 同じ試行錯誤

を減らすことです。
