# Pitfalls: 実行環境 & シェル (Windows PowerShell)

Windows PowerShell 環境における落とし穴と回避法です。

---

### `&&` 演算子の使用禁止

- **問題**: Windows PowerShell 7 未満では `&&` が構文エラー（`トークン '&&' は、このバージョンでは有効なステートメント区切り記号ではありません`）になる。
- **回避法**: コマンドの連続実行は避け、個別実行する。やむを得ず連続実行する場合は、各外部コマンドの直後に `$LASTEXITCODE` を確認し、非ゼロなら停止する（例: `cmd1; if ($LASTEXITCODE -ne 0) { throw "cmd1 failed: $LASTEXITCODE" }; cmd2`）。

---

### 丸括弧 `()` を含むパスの誤解釈

- **問題**: `src/routes/(app)/records/$id.tsx` のようなパスをクォートなしで渡すと PowerShell が式として解釈しエラーになる。
- **回避法**: パスは必ずクォートで囲み、`$id` のようなリテラルの `$` を含む場合はシングルクォートを使用する（例: `git add 'src/routes/(app)/records/$id.tsx'`）。

---

### 日本語コミットメッセージ・PR本文の文字化け

- **問題**: PowerShell の標準パイプライン（`|`）や `-m` 引数はエンコーディングにより日本語が `?` に化ける。
- **回避法**: 必ず **UTF-8 一時ファイルを経由** して `git commit -F $tmpMsgFile` や `gh pr create --body-file $tmpBodyFile` を実行する（詳細は [`.ai/workflows/git-workflow.md`](file:///c:/Users/lutha/Documents/Code/poohma-start/.ai/workflows/git-workflow.md) 参照）。
