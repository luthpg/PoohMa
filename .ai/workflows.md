# 定型作業手順

本書は、指示頻度の高い作業フローについて文章でまとめ、繰り返し同じ作業を行えるようにするためのファイルである。
ユーザーから明示的な指示があった場合のみ参照し、実行すること。

## CMS コンテンツレビューワークフロー

microCMS で管理される FAQ・利用規約・プライバシーポリシー等の公開コンテンツを、
最新の実装・仕様と照合して更新するための AI Agent 向けワークフローと注意点。

---

### 基本原則

**「実装の事実を先に確認してから CMS コンテンツを評価する」**

CMS コンテンツが正しいかどうかは、実装から独立して判断できない。
まずコードベース・仕様書で「現在の実装」を確定し、その後 CMS コンテンツと照合する。

---

### ワークフロー

#### STEP 1: CMS からデータ取得・保存

**ツール**: microCMS MCP (`microcms_get_list`, `microcms_get_content`)

```
# FAQ（リスト型）
endpoint: "faq", limit: 100, orders: "createdAt"

# 法的ドキュメント（オブジェクト型 = シングルトン）
endpoint: "legal"  ← get_list で取得（get_content は contentId が必要で不可）
```

取得結果は必ず `.local/cms/` に**タイムスタンプ付きファイル名**で保存する。
同名ファイルに上書きすると変更前の断面が消えて差分比較ができなくなる。

```
.local/cms/
├── faq_20260914T095000.json    # 取得日時をファイル名に含める
├── faq_20260914T113000.json    # 更新後に再取得した場合は別ファイルで保存
└── legal_20260914T095000.json
```

**PowerShell でのタイムスタンプ付き保存例:**
```powershell
$ts = Get-Date -Format "yyyyMMddTHHmmss"
# MCP 取得結果を $result に受け取った後
$result | Out-File ".local/cms/faq_$ts.json" -Encoding UTF8
```

**注意点:**
- microCMS MCP は最初 `Forbidden` になることがある（再試行で解消する場合あり）
- `legal` エンドポイントは `get_content` で `contentId` を要求されるが実際はオブジェクト型のため `get_list` で取得する
- HTML エンティティ（`&lt;` 等）は JSON 内に埋め込まれている点に注意

---

#### STEP 2: 実装の事実を確認

CMS の評価前に、以下のソースで「最新の実装状態」を確定する。

| 確認対象 | 主なソース |
|---|---|
| ドメインエンティティ・ACL | `.ai/domain.md` |
| 機能の実装状況（✅/⏳） | `.docs/features.md` |
| 設計上の不変条件 | `.ai/invariants.md` |
| 要件の詳細 | `.docs/requirements.md` |
| 実装コードの直接確認 | `apps/web/src/`, `apps/web/convex/` |
| 最近の変更 | `git log --oneline -20` |

**注意点:**
- `.ai/` と実装が矛盾する場合は **実装を優先**
- `features.md` の ⏳ 未実装は「コードに実装なし」をコードで裏取りすること
- grep が効かない場合は PowerShell の `Select-String` を使う:
  ```powershell
  Get-ChildItem -Path "apps/web/src" -Recurse -Include "*.ts","*.tsx" |
    Select-String -Pattern "keyword" | Select-Object Filename, LineNumber, Line
  ```

---

#### STEP 3: CMS コンテンツと実装の照合・差分分析

##### FAQ の照合観点

| チェック観点 | 確認すること |
|---|---|
| **機能の存在** | 「できる/できない」の記述が実装の実態と合っているか |
| **権限・ロール** | `familyRole`（admin/viewer）の仕様が正確に反映されているか |
| **自動権限付与** | viewer が自ら作成・共有したレコードには自動的に個別管理者として付与される仕様を見落としていないか |
| **数値・制限値** | 最大件数・文字数・期限等の具体的な数値は実装と一致しているか（例: CSV 500行 = `UserMenu.tsx:148`） |
| **フロー記述** | 状態遷移の説明は `domain.md` の状態遷移図と一致しているか |
| **未実装機能** | `features.md` で ⏳ 未実装とされている機能を「できる」と案内していないか |

##### 法的ドキュメントの照合観点

利用規約・プライバシーポリシーの更新が必要になるのは以下の変更があった場合のみ:
- 暗号スキーム・E2EE の仕様変更
- 外部サービス（Firebase, Convex, Cloudflare R2, Resend 等）の追加・削除
- データ保持期間・削除ポリシーの変更
- 新たな個人情報取得項目の追加

ロール機能追加・UI 刷新・パフォーマンス改善等の変更は法的ドキュメントのスコープ外。

---

#### STEP 4: Implementation Plan として整理

```markdown
## 調査で確認した最新実装の事実
（表形式：機能 / 実装状況 / 根拠ファイルとセクション）

## FAQ 照合結果
### ❌ 修正必須（優先度：高）
- 実装と真逆・または存在しない機能を「できる」と案内している
### ⚠️ 修正推奨（優先度：中）
- 不完全・不正確で誤解を生む可能性がある
### 🆕 新規追加を推奨（優先度：低）
- 最近実装された機能に対応する Q&A がない

## 利用規約 / プライバシーポリシー — 修正不要 or 修正箇所
```

- 各差分に「現在の記述」と「提案する修正案」を並べて示す
- 修正不要の場合も「確認した・問題なし」を明記する

---

#### STEP 5: ユーザー承認を得る

`implementation_plan.md` を提示して承認を得る（`RequestFeedback: true`）。
修正テキストはこのステップでユーザーが調整する。
**承認なしに CMS を更新しない。**

---

#### STEP 6: CMS を更新する

```
# FAQ 更新
microcms_update_content: endpoint="faq", contentId="<id>", content={question, answer}

# FAQ 新規作成（公開済みとして）
microcms_create_content_published: endpoint="faq", content={slug, question, answer, category}

# legal 更新（オブジェクト型）
microcms_update_content: endpoint="legal", contentId="legal", content={terms, privacy}
```

**注意点:**
- `answer` フィールドは HTML 文字列（`<p>...</p>` 等）、Markdown は使わない
- `category` は以下の既存 ID を使う（新カテゴリ作成は MCP 経由では不可）

| カテゴリ名 | ID |
|---|---|
| `account` | `scdgmuz5nrl1` |
| `backupAndExport` | `pcldc8emk8t` |
| `familyManagement` | `pq_r7-eaqk` |
| `general` | `ftc4qdpl4b` |
| `security` | `rlotrq2o8u` |
| `technical` | `0qmdugmv8g` |
| `troubleshooting` | `fuoynnzb0` |
| `usage` | `sb74fww03h05` |

---

#### STEP 7: 更新結果の正確性確認

更新後に MCP で再取得して内容を検証する。

```
microcms_get_content: endpoint="faq", contentId="<id>"
```

確認観点:
- `updatedAt` が最新タイムスタンプに更新されているか
- **`answer` の全文を目視確認する**（`updatedAt` 更新だけでは文字レベルの誤りを検出できない）
- `question` / `category` が想定通りか
- 必要に応じてローカル dev サーバーで `/faq` ページの表示を確認する

**意図しない変更がないか全件チェックする方法（PowerShell）:**
```powershell
# 「変更前スナップショット」と「変更後再取得」で updatedAt を比較
$before = (Get-Content ".local/cms/faq_<変更前タイムスタンプ>.json" -Raw -Encoding UTF8 | ConvertFrom-Json).contents

# 変更後の現在データは MCP 出力ファイルから抽出
$raw = Get-Content "<MCP出力ファイルパス>" -Raw -Encoding UTF8
$lines = $raw -split "`n"
$jsonLine = $lines | Where-Object { $_ -match "^\{.*totalCount" } | Select-Object -First 1
$after = ($jsonLine | ConvertFrom-Json).contents

$expected = @("<更新したID1>", "<更新したID2>")
$unexpected = @()
foreach ($item in $after) {
    $prev = $before | Where-Object { $_.id -eq $item.id }
    if ($null -ne $prev -and $item.updatedAt -ne $prev.updatedAt) {
        $tag = if ($item.id -in $expected) { "[OK]" } else { "[!! 意図しない変更 !!]" }
        Write-Host "$tag $($item.id) | $($item.slug) | $($prev.updatedAt) -> $($item.updatedAt)"
        if ($item.id -notin $expected) { $unexpected += $item }
    }
}
if ($unexpected.Count -eq 0) { Write-Host "[PASS] 意図した変更のみ確認" }
```

---

### よくある失敗パターン

| 失敗 | 原因 | 対策 |
|---|---|---|
| `features.md` の ⏳ 未実装を「実装済み」と誤判断 | コードの裏取りをしていない | 必ずコードで存在を確認 |
| viewer のアクセス権を「閲覧のみ」と単純化 | 「自ら作成・共有したレコードには個別管理者として自動付与」を見落とす | `domain.md` §3 のマトリクスを全行確認 |
| legal の更新が必要と誤判断 | FAQ と同じ粒度で評価してしまう | legal は暗号スキーム・外部サービス変更時のみ |
| 承認前に MCP 更新を実行 | 効率を優先してしまう | STEP 5 の承認は必須 |
| answer に Markdown を使う | microCMS はリッチテキスト（HTML）形式 | 常に HTML タグで記述する |
| MCP 経由で日本語 HTML を書き込んだとき変換ミスが混入する（例: `乵用して`、`一疑で`） | Agent 内部のテキスト生成時に CJK 文字が文字化けすることがある | STEP 7 で `answer` 全文を必ず目視確認し、ミスを発見したら即再更新する |