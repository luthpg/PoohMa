# Pitfalls: E2E テスト & クライアントルーティング

Playwright E2E テストおよびフロントエンド遷移における落とし穴と回避法です。

---

### テスト作成時の安易なプロダクションコード改変（絶対禁止）

- **問題**: テストコード作成中にテストが失敗した際、原因を精査せず安易にプロダクションコードを変更したり、プロダクションコードのバグを発見した際にユーザーの許可なく独断で修正を加えてしまう。
- **回避法**: テスト実装時の不具合はまずテストコード自体の改善・待機処理の調整で解決できないかを試みる。どうしてもプロダクションコードの修正が必要な場合は、独断で修正を実行せず、必ず事前にユーザーへ事象・原因・修正案を報告し、実行の許可を得てから対応する（GEMINI.md 最重要原則）。

---

### Playwright `extraHTTPHeaders` による外部 API の CORS プリフライト拒否

- **問題**: `playwright.config.ts` の `use.extraHTTPHeaders` に `x-vercel-protection-bypass` や Cloudflare Access ヘッダーを指定すると、ブラウザが発行するすべてのリクエスト（Google Identity Toolkit 等の外部 API を含む）に付与され、CORS OPTIONS プリフライト拒否で `auth/network-request-failed` が発生してログインできなくなる。
- **回避法**: グローバルヘッダー設定を廃止し、`e2e/support/test-fixtures.ts` 内で `context.route` を使って自アプリオリジン（`baseURL`）宛て通信のみにバイパスヘッダーを注入する。

---

### 未認証ルートガード（`(app)/route.tsx`）における `useEffect` ナビゲーションの無限ループ / Abort

- **問題**: `(app)/route.tsx` で未認証時に `useEffect` 内で `navigate({ to: "/login", search: { redirect: location.href } })` を呼ぶ際、依存配列に `location.href` を含めていると、中間 URL 変化で再レンダリングが連鎖し、先行ナビゲーションが次々と Abort されてローディングスピナーのままフリーズする。
- **回避法**: `useRef(false)`（`hasRedirectedRef`）を用いて、未認証遷移がトリガーされたら1度だけ `navigate` を実行するようにガードする。

---

### ログアウト処理における Server Function と Client Auth の実行順序（Race Condition）

- **問題**: ログアウト時に `await signOut(auth)` を先に実行し、その後に Server Function `await logout()` を呼ぶと、`signOut` 完了瞬間に `onAuthStateChanged` が発火してコンポーネントツリーが未認証遷移を開始し、進行中の `logout()` fetch がブラウザによって中断（`TypeError: Failed to fetch`）される。その結果、サーバー側の Session Cookie が削除されずに残る。
- **回避法**: 必ず **Server Function `await logout()`（Cookie 削除）を先に完了**させ、その後に `await signOut(auth)`（クライアント認証状態破棄）を呼び出す順序を徹底する。

---

### 家族所属状態によるログアウト UI の配置分岐と E2E テスト

- **問題**: 家族未所属時は画面直下に「ログアウト」ボタンが直接レンダリングされるが、家族所属済みになると「ダッシュボードへ」リンクに変化し、ログアウトボタンは `UserMenu`（アバタードロップダウン）内へ格納される。家族所属状態でテストが走ると、画面直下のログアウトボタンが見つからず `TimeoutError` となる。
- **回避法**: E2E テストでは画面直下にログアウトボタンが存在するかを判定し、存在しない場合は `[data-testid="user-menu-trigger"]` をクリックして `UserMenu` 内のログアウトを選択するフォールバックを組む。

---

### 大量データ暗号化・外部APIフェッチを伴うE2Eテストのタイムアウト

- **問題**: CSVインポートテスト（`e2ee-seed-import.spec.ts`）など、数十件のレコードに対してクライアント側 Web Crypto 暗号化、外部 OGP フェッチ、形態素解析（ルビ取得）を順次実行する巨大なジャーニーテストでは、`@playwright/test` のテストごとのデフォルトタイムアウト（30秒）を超えてしまうことがある。これは `playwright.config.ts` の `webServer` 起動タイムアウト（120秒）とは別の設定である。
- **回避法**: 大量の非同期暗号化・外部通信を伴うテストスイートでは、個別の `test.setTimeout(300_000)` 等で十分なタイムアウト値を明示的に設定する。
