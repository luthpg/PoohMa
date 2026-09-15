# Pitfalls: Convex & バックエンド開発

Convex バックエンド開発における落とし穴と回避法です。

---

### `convex dev` の常駐プロセスと開発環境へのワンショット反映 (`--once`)

- **問題**: 
  - `convex dev` は通常ファイル変更監視モードで常駐するため、AI Agent 実行時にプロセスが終了しなくなる。
  - 一方で `pnpm convex:codegen` だけを実行すると、ローカルの型定義は更新されるが **Convex 開発クラウドインスタンス（`dev:...`）には関数やスキーマがプッシュされない**。そのため、実バックエンドと通信する E2E テスト（Playwright）を実行した際に `Could not find public function for '...'` でテストが全滅する罠に陥る。
  - また、`pnpm convex:deploy` / `pnpm convex:sync` は本番（production）デプロイまたは `CONVEX_DEPLOY_KEY` 設定環境向けであり、ローカル開発環境（`dev:...`）への反映には使えない。
- **回避法**: 
  - 開発環境（`dev:...`）に関数・スキーマの変更をワンショットで安全に反映し、型定義を生成するには **`convex dev --once`**（`pnpm -F @poohma/web exec convex dev --once`）を使用する。常駐せずにデプロイとコード生成を完了できる。
  - E2E テスト実行前やローカル検証前にバックエンドのスキーマ・関数を変更した場合は、必ず事前に `convex dev --once` を実行すること。

---

### ConvexHttpClient の共有による状態汚染

- **問題**: `ConvexHttpClient` に `setAuth(token)` を呼ぶとクライアント内部に認証状態が保持されるため、モジュールグローバルで共有するとマルチユーザー間で認証情報が混線する。
- **回避法**: Server Functions 内でリクエストごとに `new ConvexHttpClient()` を生成する。

---

### Convex FunctionReference（`api.*`）の Proxy 構造とキャッシュキーの衝突

- **問題**: `useQuery(api.records.getRecords)` などに渡す `FunctionReference` は内部的に Proxy オブジェクトである。`"_path" in query` は `false` を返し、`JSON.stringify(query)` は `"{}"` を返すため、安易にオブジェクト走査や JSON 文字列化でキャッシュキーを生成すると、すべてのクエリ関数の識別子が `"{}"` となり同一キーでキャッシュが上書き・汚染される。これにより、同引数（`{ accountId }`）を持つ配列クエリ（`getRecords`）の結果が別クエリ（`getAvailableTags`）に混入し、React 子要素にオブジェクトが渡ってクラッシュ（React error #31）する原因となる。
- **回避法**: `FunctionReference` の関数名解決にはグローバルシンボル `query[Symbol.for("functionName")]` を参照する。`apps/web/src/hooks/usePersistentQuery.ts` の `getQueryFunctionKey` ヘルパーを利用し、安全にクエリパス（例: `"records:getRecords"`）を取得する。

---

### 生の Convex query / mutation の直接 export

- **問題**: 認可チェックや `resolveAccount` を通さずに Convex 関数を公開すると、未認証アクセスや IDOR 脆弱性の原因になる。
- **回避法**: 必ず `convex/customBuilders.ts` のビルダー（`authenticated*`, `familyBound*` 等）を使用する。

---

### レコード所有権判定の直接参照

- **問題**: `record.ownerType === "family"` や `record.admins` を直接参照すると、移行前の旧レコード（`visibility: "SHARED"`）で正しく判定できない。
- **回避法**: 必ず `convex/rls.ts` の `getEffectiveOwnerType(record)`, `getEffectiveAdmins(record)` ヘルパーを使用する。

---

### Firebase UID (`userId: string`) と Convex ID (`Id<"users">`) の混同・型アサーション

- **問題**: Firebase UID（文字列）と Convex の `users` テーブルのドキュメント ID（`Id<"users">`）は別物である。`userId as unknown as Id<"users">` のような安易な型アサーションを行うと、Convex の引数バリデーション（`v.id("users")`）で実行時エラーが発生し、`try-catch` で握りつぶされて障害が表面化しない原因になる。
- **回避法**: `users.syncUser` は対象アカウントの `Id<"users">` を返す。Convex ID を要求する引数には必ず実在する `_id` を渡し、型アサーションで不正な文字列を渡さない。

---

### SSR 初期データ（`getUserByFirebaseUid`）と CSR クエリ（`getAccounts`）のアカウント構造不整合

- **問題**: SSR 時に TanStack Start の `getAuthUser` から呼ばれる Convex 内部エンドポイント `getUserByFirebaseUid` は、ユーザーの `accounts` 配列を返す。この `accounts` の各アカウントに `family`（E2EE 暗号化メタデータ: `masterKeyEncrypted`, `masterKeyIv`, `masterKeySalt`, `kdfIterations`, `cryptoVersion` 等）が含まれていないと、クライアント側で CSR のリアクティブクエリ `getAccounts` が解決されるまでの間、`activeAccount.family` が欠落する。その結果、ページ読み込み直後の E2EE 操作（パスコードによるマスターキー解除や暗号化インポート）で `family` が見つからず暗号化・復号処理が失敗する。
- **回避法**: `getUserByFirebaseUid` 内で `allAccounts` をマッピングする際、各アカウントの `familyId` に紐づく `family` ドキュメントを取得し、`getAccounts` と完全に一致するスキーマで `family` 情報を注入して返す。

---

### メンバーキックにおける被除名者検証と自己除名の防止

- **問題**: PoohMa では 1 Firebase UID : N PoohMa Account のマルチアカウント構造をとっている。キック処理（`kickMember`）で単に `familyId` のみで対象を検索すると、誤って同一人物の別アカウントや自分自身を除名してしまい、家族グループが管理者不在または自己矛盾状態に陥る。
- **回避法**: `kickMember` 引数には `targetAccountId`（`Id<"users">`）を受け取り、(1) 自分自身（`targetAccountId === user._id`）の除名禁止、(2) 同一ログインユーザー（`targetUser.userId === identity.subject`）の除名禁止、(3) 対象アカウントが同一家族に所属していることの確認を厳格に行う。

---

### Export Vault 退避時の KDF 暗号パラメータ保存漏れ

- **問題**: メンバーキック時に旧家族のマスターキー情報（`masterKeyEncrypted`, `masterKeyIv`, `masterKeySalt`）だけを退避し、`kdfIterations` や `cryptoVersion` を保存し忘れると、将来 KDF バージョン引き上げ等が行われた際に、被キックユーザーが旧パスコードを入力しても正しい反復回数で鍵導出できずアンラップに失敗する。
- **回避法**: `pendingExportVaults` テーブルには必ず `kdfIterations` と `cryptoVersion` を含め、キック時点の `family.kdfIterations` / `family.cryptoVersion` をそのまま退避・保存する。
