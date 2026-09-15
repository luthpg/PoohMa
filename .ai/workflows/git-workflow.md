# Git & GitHub CLI Workflow in PowerShell

Windows PowerShell 環境において、日本語文字化けやエスケープ破壊を防ぎながら安全に Git コミットおよび GitHub CLI（`gh`）を実行するためのワークフローです。

---

## 1. Git Commit Message Guidelines

コミットメッセージは **Conventional Commits** 形式に厳格に従います。

### Format

```text
<type>(<scope>): <short description>

<detailed description in Japanese>
```

- **Header (<type>)**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` 等を使用。
- **Subject**: 変更内容の要約を簡潔に記述。
- **Body（詳細文）**: 必ず日本語で記述し、「なぜこの変更を行ったか」「どのような変更・影響があるか」を分かりやすく記載。

---

## 2. PowerShell での安全なコミット実行手順（文字化け防止）

PowerShell のパイプライン（`|`）や `-m` オプションはデフォルトのエンコーディングにより日本語が `?` に化ける原因になります。コミットを実行する際は、必ず **UTF-8 一時ファイルを経由** してください。

### 実行スクリプトテンプレート

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

---

## 3. PowerShell での安全な GitHub CLI (`gh`) 実行手順

PowerShell 上で `gh pr create` や `gh issue create` を実行して本文（Body）を渡す場合のルールです。

- **`--body` フラグで直接ダブルクォート文字列を渡さないこと**（PowerShell が Markdown 内のバッククォート `` ` `` をエスケープ文字として誤解釈し、`\` に化けるため）。
- **パイプライン（`|`）で直接 `gh` に渡さないこと**（エンコーディングにより日本語が `?` に化けるため）。
- 本文を渡す際は、必ず **UTF-8 一時ファイルを作成して `--body-file` に渡す** こと。

### 実行スクリプトテンプレート

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
