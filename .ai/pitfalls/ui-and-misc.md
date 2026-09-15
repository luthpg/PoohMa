# Pitfalls: UI・スタイリング & 環境設定

UI 実装、外部 API 連携、環境変数、モノレポ設定における落とし穴と回避法です。

---

### Biome の Markdown 非対応

- **問題**: `pnpm check` で `.ai/*.md` や `.docs/*.md` のフォーマットやリンク切れを検出しようとする。
- **実際**: Biome 2.x は Markdown をパース/チェックしない。ドキュメントの整合性確認は手動または専用スクリプトで行う。

---

### 環境変数の追加・変更時の CI 設定（`.github/workflows/ci.yml`）更新漏れ

- **問題**: `apps/web/src/env/client.ts` や `server.ts` に必須環境変数を追加した際、ローカルの `.env` のみ更新して `.github/workflows/ci.yml` の `env` を更新し忘れると、GitHub Actions CI の Test / Build で Zod バリデーションエラーが発生して CI が失敗する。
- **回避法**: 環境変数を追加・変更した際は、必ず `.github/workflows/ci.yml`（`check-and-test` ジョブ）に対応するダミー環境変数を追記する。

---

### 外部 UI / API 連携追加時の CSP（Content Security Policy）設定漏れ

- **問題**: Google Picker などの iframe 埋め込み型 UI や外部 API を追加した際、`apps/web/src/start.ts` の CSP ミドルウェアで許可していないと、ブラウザにより通信や埋め込みがブロックされる。
- **回避法**: iframe を使用する場合は `frame-src`、クライアントから直接呼び出す外部 API がある場合は `connect-src` に対象ドメインを明示的に追加する。

---

### Google Picker API の `setEnableDrives(true)` とルートフォルダ選択の制約

- **問題**: `DocsView(ViewId.FOLDERS)` に `setEnableDrives(true)` を設定するとマイドライブが表示されなくなる。また Google Picker はマイドライブ直下（root）そのものを選択状態にできない。
- **回避法**: マイドライブ用（`setParent("root")`）と共有ドライブ用（`setEnableDrives(true)`）の 2 つの独立した `DocsView` を登録する。

---

### 親コンテナのパディングとネガティブマージンの不整合による水平オーバーフロー

- **問題**: 親コンテナが `p-4 sm:p-6` とモバイル時に縮小されているにもかかわらず、子要素で `-mx-6` を固定指定してしまうと、モバイル画面で左右 8px ずつ画面外へ飛び出し、水平スクロール（横揺れ）が発生する。
- **回避法**: ネガティブマージンは必ず親要素のレスポンシブパディングと完全に同一のブレークポイントと値で指定する（例: `-mx-4 sm:-mx-6 px-4 sm:px-6`）。

---

### ドキュメント・設定ファイルにおけるローカル絶対パス（`file:///`）の混入

- **問題**:
  - AI エージェントのチャット出力用リンク指示（`file:///...` スキームの絶対パスリンク）に引きずられ、リポジトリにコミット・管理するドキュメント（`GEMINI.md`、`.ai/*.md`、`.agents/skills/...` 等）にまで `file:///c:/Users/...` のようなローカル絶対パスを記述してしまう。
  - 他の開発者環境や GitHub Web 上でリンク切れを引き起こすだけでなく、OS のローカルユーザー名や環境固有パスなどの情報が Git 履歴に漏洩する。
- **回避法**:
  - コミット対象となるドキュメント内の Markdown リンクは、**必ずリポジトリ内相対パス（例: `./.ai/invariants.md`、`../invariants.md` 等）** で記述する。
  - チャット返答用の絶対パスリンクと、コミットするドキュメントの相対パスリンクの責務を厳格に区別し、ドキュメント変更時はコミット前に `file:///` や `Users/` が残存していないか確認する。
