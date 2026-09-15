# PoohMa AI Knowledge Base (`.ai/`)

PoohMa では、AI Agent が継続的に利用するプロジェクト固有の知識を `.ai/` ディレクトリに蓄積・管理しています。

---

## 1. Knowledge Base の役割と位置付け

- **`.docs/`**: 人間向けの正規仕様・要件定義・設計・脅威モデル。
- **`.ai/`**: AI Agent 向けに整理・圧縮されたプロジェクト固有の知識（ドメイン構造、不変条件、落とし穴、アーキテクチャ）。
- **`GEMINI.md`**: Gemini / Antigravity 固有の実行ルール・最重要不変原則（Core Guardrails）。

> **Important**:
> `.ai/` は `.docs/` の代替ではありません。`.docs/`、現在の実装、Git履歴、Issue/PR 等と矛盾する場合は、根拠のある最新情報を優先し、必要に応じて `.ai/` を更新してください。

---

## 2. ディレクトリ構成

```text
.ai/
├── README.md               # 本ファイル（設計思想と運用ガイド）
├── architecture.md         # システム構造、データフロー、主要Source of Truth
├── invariants.md           # 絶対に破壊してはならない不変条件（暗号・認証・生エラー非露出）
├── domain.md               # ドメイン相関、ライフサイクル、アクセス権マトリクス
├── patterns.md             # PoohMa で実証された実装・調査パターン
├── decisions.md            # 重要な設計判断とその背景
├── testing.md              # テスト技法（convex-test, E2EE暗号テスト, E2E）
├── workflows.md            # CMS レビュー等の定型運用フロー
├── workflows/              # 定型作業手順（Git, ドキュメント同期等）
│   ├── git-workflow.md
│   └── doc-sync.md
└── pitfalls/               # 過去の失敗事例・落とし穴（ドメイン別分割）
    ├── review-and-guardrails.md
    ├── backend-convex.md
    ├── auth-session.md
    ├── crypto-e2ee.md
    ├── e2e-testing.md
    ├── environment-shell.md
    └── ui-and-misc.md
```

---

## 3. Source of Truth（判断優先順位）

`.ai/` の内容は常に検証可能な根拠に基づいている必要があります。情報の優先度は以下の通りです：

1. **ユーザーによる明示的な決定**
2. **`.docs/security/threat-model.md`**（脅威モデルおよびセキュリティ境界の Source of Truth）
3. **現在のプロダクション実装**
4. **`.docs/` の最新仕様・設計書**
5. **Git 履歴・コミットログ**
6. **Issue / PR 等のディスカッション履歴**
7. **`.ai/` の既存記述**

---

## 4. 更新ルールと運用方針

Issue や PR レビューの作業中に、将来の作業でも再利用できる重要な知識が新たに判明した場合は、適切なファイルに還元・追記してください。

### 更新すべきもの
- 新しい不変条件やセキュリティ境界の知見
- 外部レビュー（CodeRabbit等）対応で得られた教訓や却下パターン
- アーキテクチャやデータフローの恒久的変更
- 重要な設計判断（ADR）

### 記録してはいけないもの（トークン浪費防止）
- 一時的な調査結果やデバッグスクリプト
- `.docs/` の単純なコピーやソースコードの要約
- 根拠のない推測や仮説
- 現在の実装と矛盾する古い仕様
