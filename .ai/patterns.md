# PoohMa Implementation Patterns

PoohMa で実際に採用されている、将来の機能追加や改修で再利用できる実装・調査パターンを整理する。

---

## 1. Convex カスタムビルダーパターン (`convex/customBuilders.ts`)

Convex の関数は直接 export せず、認可レベルに応じたカスタムビルダーでラップして定義する。

```typescript
import { v } from "convex/values";
import { familyBoundMutation } from "./customBuilders";
import { requireContentAccess } from "./rls";

export const updateRecord = familyBoundMutation({
  args: {
    id: v.id("serviceRecords"),
    data: v.object({ /* ... */ }),
  },
  handler: async (ctx, args) => {
    // ctx.user, ctx.identity, ctx.familyId が自動解決・保証されている
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    // RLS による認可チェック
    requireContentAccess(ctx.user, record);

    await ctx.db.patch(args.id, { ...args.data, updatedAt: Date.now() });
  },
});
```

### ビルダーの選択基準

- `identityVerifiedQuery / Mutation`: ユーザーの Convex DB レコードが存在しない初期登録時のみ使用。
- `authenticatedQuery / Mutation`: アカウントの存在・所有権（IDOR防止）が解決された状態。個人設定やアカウント管理等で使用。
- `familyBoundQuery / Mutation`: 家族所属が前提の操作（レコードCRUD、家族設定、招待管理等）で使用。

---

## 2. レコード単位アクセス制御 (RLS) & レガシー互換パターン (`convex/rls.ts`)

Drive型 ACL 所有権モデル（`user` / `family` + `admins`）と移行期間中のレガシー互換を両立するパターン。

```typescript
// 閲覧・編集の権限確認
requireContentAccess(ctx.user, record);

// 削除・共有解除・管理者変更の権限確認
requireAdminAccess(ctx.user, record);
```

- レコードの `ownerType` や `visibility` を直接判定せず、`getEffectiveOwnerType(record)` や `getEffectiveAdmins(record)` 等のヘルパーを介すことで、スキーマ移行中の旧データと新データを同一ロジックで安全に扱える。

---

## 3. E2EE エンベロープ暗号化・再暗号化パターン (`apps/web/src/lib/crypto.ts`)

### 新規暗号化

1. `generateDEK()` で認証情報単位の DEK を生成
2. `encrypt(passwordHint, dek)` でヒント本体を暗号化
3. `wrapDEK(dek, masterKey)` で DEK をマスターキーで暗号化
4. 両方の暗号文と IV をペアで DB に保存

### 家族移行・パスコード変更時の再暗号化 (`reWrapCredential`)

ヒント本体（暗号化テキスト）の再復号は行わず、**DEK のラップのみを旧マスターキーから新マスターキーへ付け替える**ことで、計算コストと平文漏洩リスクを最小化する。

```typescript
const dek = await unwrapDEK(cred.passwordHintDekEncrypted, cred.passwordHintDekIv, oldMasterKey);
const dekWrapped = await wrapDEK(dek, newMasterKey);
```

---

## 4. Server Functions と ConvexHttpClient のリクエスト分離パターン (`src/services/auth.functions.ts`)

`ConvexHttpClient` は `setAuth` 等で内部状態を持つステートフルなクライアントであるため、**リクエスト間でインスタンスを共有せず、関数実行ごとに生成する**。

```typescript
function createConvexClient() {
  return new ConvexHttpClient(env.VITE_CONVEX_URL as string);
}

export const syncUser = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data: { idToken } }) => {
    const convexClient = createConvexClient();
    convexClient.setAuth(idToken);
    return await convexClient.mutation(api.users.syncUser, { /* ... */ });
  });
```

---

## 5. ログアウト制御とクロス多タブ同期パターン (`useConvexFirebaseAuth.ts`)

ログアウト時は `localStorage` に `LOGOUT_FLAG_KEY` をセットし、Cookie による自動セッション復元（サイレント再認証）が即座に再発動するのを防ぐ。さらに `storage` イベントを監視して別タブでのログアウトも即時同期する。

```typescript
// ログアウト時（他タブへは storage イベントで即座に伝播）
localStorage.setItem("poohma_logout", String(Date.now()));
if (auth) await signOut(auth);
await logout(); // Server Function で Cookie 削除 & Firebase トークン失効

// 認証監視時
if (localStorage.getItem("poohma_logout")) {
  // サイレント再認証をスキップして未認証状態を確定
  setIsAuthenticated(false);
  setIsLoading(false);
  return;
}

// 他タブログアウトのリアルタイム検知
window.addEventListener("storage", (e) => {
  if (e.key === "poohma_logout" && e.newValue) {
    setIsAuthenticated(false);
    setIsLoading(false);
  }
});
```

---

## 6. アカウント切り替え時の状態・キャッシュ破棄パターン (`AccountProvider.tsx`, `PasscodeProvider.tsx`)

同一ブラウザでのアカウント切り替え時に前アカウントの機密データやクエリ結果が残存することを防ぐ。

1. `PasscodeProvider`: `accountId` の変更を検知して `masterKey` を `null` にリセット（再ロック）。
2. `AccountProvider`: 切り替え時にローカルメモリキャッシュの破棄（`clearQueryCache()`）と TanStack Query の無効化・再取得（`await queryClient.invalidateQueries()`）を実行。

---

## 7. 五十音・アルファベット正規化ソートキー生成パターン (`src/utils/index-group.ts`)

日本語・英数字混在レコードを五十音グループ（あ〜わ、英数、記号）順に正確にインデックスクエリするためのパターン。

- サービス名・読み仮名からグループ順位プレフィックス（2桁ゼロ埋め数字）+ NFKC正規化文字列を合成して `sortKey` を生成。
- Convex のインデックス `by_family_sortKey` により、サーバー側でフルテーブルスキャンなしにソート済み取得を実現。

---

## 8. Convex バックエンド関数のテストパターン (`apps/web/tests/convex/`)

`convex-test` を使用し、認証コンテキスト（`as(user)`）や customBuilders、RLS をモックした統合テストを記述する。

```typescript
import { convexTest } from "convex-test";
import { api } from "@/../convex/_generated/api";
import schema from "@/../convex/schema";

test("authenticated user can create record", async () => {
  const t = convexTest(schema);
  const userId = "firebase-uid-123";
  const user = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { userId, email: "test@example.com", updatedAt: Date.now() });
  });

  const asUser = t.withIdentity({ subject: userId });
  // customBuilders を経由した mutation の実行検証
  const recordId = await asUser.mutation(api.records.createRecord, {
    accountId: user,
    title: "Test Service",
    // ...
  });
  expect(recordId).toBeDefined();
});
```

---

## 9. ドキュメント横断セルフレビュー・パターン（CodeRabbit 指摘防止）

PoohMa の仕様書（`code-design.md`, `security-model.md`, `requirements.md`）は多面的な構成（データモデル、フロー、API一覧、状態管理、セキュリティ境界）になっているため、コード変更時は以下のチェックリストでドキュメント全体を横断検索して整合性を確認する。

1. **データモデル変更時**:
   - `accountId` vs `userId` の所有関係やテーブル構造を変更した際は、`code-design.md` の「4.1 ER概要」「4.2 テーブル定義」と `.ai/domain.md` を更新する。
2. **API・関数変更時**:
   - Server Function や Convex 関数を追加・修正・削除した際は、`code-design.md` の「7. API設計」「7.6 Server Functions」表を更新する。
3. **認証・セッション・ストレージ変更時**:
   - 認証イベント（`onAuthStateChanged` / `onIdTokenChanged`）やストレージ（`localStorage` vs `sessionStorage`）を変更した際は、`code-design.md` の「5.2 認証フロー」「5.6 ログアウトフロー」「8.4 状態管理表」「security-model.md」を更新する。

---

## 10. バックグラウンド非同期処理の競合防止パターン（UID・状態ガード）

バックグラウンドでセッション更新やCookie書き込みを行う非同期処理は、非同期呼び出しの合間にユーザーがログアウトしたり別アカウントに切り替わる可能性がある。古いレスポンスによる状態汚染を防ぐため、**非同期処理の前後でユーザーUIDとログアウトフラグを二重検証**する。

```typescript
async function syncSessionCookieInBackground(user: FirebaseUser) {
  // 1. 開始前ガード
  if (!auth?.currentUser || auth.currentUser.uid !== user.uid || localStorage.getItem(LOGOUT_FLAG_KEY)) {
    return;
  }
  const idToken = await user.getIdToken();
  // 2. 非同期処理完了後（書き込み直前）の再ガード
  if (!auth?.currentUser || auth.currentUser.uid !== user.uid || localStorage.getItem(LOGOUT_FLAG_KEY)) {
    return;
  }
  await refreshSessionCookie({ data: { idToken } });
}
```

---

## 11. モバイルキーボード回避型インラインサジェストUIパターン (`TagInput`)

モバイル端末において、ポップオーバー（Combobox）方式のサジェストはソフトウェアキーボード（OSK）によって覆い隠されやすく、フォーカス操作が必須となるため入力体験を損ないやすい。

- **インライン候補チップ**: 入力欄の直下に横スクロール可能なチップ行を常時表示し、キーボード非展開のまま1タップで追加・削除を可能にする。
- **選択状態の前方ソート**: 選択されたタグを前方にソートして描画することで、現在の選択状態の把握と解除操作を迅速化する。
- **フォーカス維持 (`onMouseDown: e.preventDefault()`)**: チップタップ時にテキスト入力欄からフォーカスが外れるのを防ぎ、`onBlur` による下書き未確定文字列の意図しない自動タグ化を防止する。
- **イベントバブリング抑止**: チップ上のキーボード操作（Enter等）がルートの入力コンポーネントへ不要に伝播しないようガードする。

---

## 12. 多段 Sticky Section Headers パターン (`RecordForm`)

グローバルナビゲーションが `sticky top-0 h-16` で固定されている画面において、縦に長い入力フォームのセクション見出しを連動固定するパターン。

- **オフセット連動 (`top-16 z-10`)**: 各セクションの見出しバーを `sticky top-16 z-10` かつ背景色（`bg-card/95 backdrop-blur`）に指定する。
- **自然なスライド切り替え**: CSS の `sticky` は親の `<section>` 要素のスクロール領域に拘束されるため、JavaScript での座標計算を行わずとも、次のセクションがスクロールインすると前のセクションヘッダーが自然に押し出されて切り替わる。
- **操作アクションの常時視認**: アカウント情報の「+ 追加する」ボタンなどをセクションヘッダー内に配置することで、項目が多数（最大10件）増えても画面外に流れず、いつでも追加操作が可能になる。

---

## 13. リアルタイム同時編集プレゼンスと楽観的ロック競合防止パターン (`$id.tsx` / `records.ts`)

非エンジニア層の利用（別アプリや別タブでの確認、一時的な離席など）を想定し、過剰な排他ロックによるデッドロックを防ぎつつ、データの無警告上書きを100%防止する二層防御パターン。

### 1. プレゼンス同期（Soft Advisory: `recordEditingSessions`）

- **長めのTTL (5分)**: メモ帳や別タブでパスワード等を調べて戻ってくる猶予を持たせるため、セッションTTLは 5 分（`EDIT_SESSION_TTL_MS = 300_000`）とする。
- **定期ハートビート (30秒)**: 編集画面がフォアグラウンドにある間、30秒間隔で `heartbeatEditingSession` を送信。
- **復帰時リフレッシュ (`visibilitychange: visible`)**: モバイルOS等でバックグラウンド時にタイマーが停止しても、画面復帰時に即座にハートビートを送信してセッションを延長する。
- **デッドロック防止と自動クリーンアップ**: 編集セッションは他者の編集をブロックせず、「○○さんが編集中です」という警告のみを表示する。ブラウザ強制終了や完全離脱時も5分で自然失効（クエリから除外）し、1分間隔の定期cron（`cleanupExpiredEditingSessionsInternal`）によりDBから物理削除（1回最大500件バッチ）されるため、レコードがロックされて家族が編集不能になる事故やDB肥大化・トランザクション上限エラーを防ぐ。
- **スクロール追従プレゼンストースト**: 編集画面ではフォームが縦にスクロールされていても他者の編集開始を見落とさないよう、他メンバーの編集セッション検知時に消えないトースト（`duration: Infinity`）が表示され、「編集をやめる」「最新を読み込む」アクションボタンで即座に対応できる。離脱や保存、他メンバーの編集終了時に自動消去される。

### 2. 楽観的ロック（Hard Invariant: `updateRecord`）

- **リビジョン番号（`revision`）突合**: クライアントは編集開始時に保持した `revision`（0から開始する単調増加整数）を渡して保存する。DBの現在の `record.revision ?? 0` と一致しない場合、`CONFLICT` エラーを送出し、先行保存データを無警告で上書きする事故を防ぐ。保存成功時にサーバー側で `revision + 1` を採番する。
- **スクロール追従競合通知 & 競合解決UI**: 
  - フォームが縦に長くスクロールしても見落とさないよう、他メンバーが更新した瞬間（`isRecordStale`）に画面端へ消えないトースト（`duration: Infinity`）がアニメーション出現し、「最新を読み込む」アクションボタンで即座にワンタップ再読み込みできる。
  - 保存ボタン押下時にも競合（`CONFLICT`）を検知した場合はモーダルダイアログを表示し、(1)「最新の内容を読み込む」（フォーム最新化・編集終了）、(2)「上書き保存する」（`force: true` による強制保存）のいずれかをユーザーに明示的に選択させる。
- **保存完了時の自動解放**: `updateRecord` 成功時に、実行者の編集セッションレコードをサーバー側で自動クリーンアップする。

---

## 14. PR レビュー・追加コミット調査パターン (`gh pr view --comments`)

PR 上で外部 AI（CodeRabbit 等）や他者からコミットやレビュー指摘が追加された際、その意図と背景を的確に把握するための調査手順。

```bash
# PRの概要と最新コメント（レビュー指摘一覧）を確認
gh pr view --comments

# 特定のコミットの差分とコミットメッセージを確認
git show <commit-hash>
```

- **文脈優先の原則**: コード差分（`git diff`）を見る前に、必ずレビュアーが「どのようなリスクや不具合を指摘し、なぜその実装方針を推奨したのか」のレビュー本文を確認する。
- **断面最適の評価**: 変更提案が「現在開発中のブランチ断面」においてアーキテクチャの堅牢性（例: タイムスタンプよりリビジョン番号が優位、放置セッションの定期cron削除）を高めるものであれば、過去の一時的な議論の制約に囚われず、前向きに採用して仕様書・AIナレッジと同期する。

---

## 15. Convex Bounded Concurrency と一覧プロジェクションパターン (`records.ts`)

Convex の同時実行 I/O 上限（1,000 ops / 関数）を安全に回避しつつ、正規化された子テーブルから一覧画面に必要な最小限のフィールドのみをプロジェクション取得するパターン。

```typescript
export async function asyncMapBounded<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
  chunkSize = 64,
): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
```

- **有界並行性（Bounded Concurrency）**: 無制限な `Promise.all(records.map(...))` を廃止し、64 件チャンク単位で並行処理することで、レコード数が数百〜数千件に増加しても関数内の同時 I/O を常に安全な範囲内に抑え込む。
- **一覧プロジェクション（暗号化フィールド除外）**: 一覧取得（`getRecords`）において、詳細表示・編集に必要な暗号化データ（`passwordHint`, `passwordHintIv`, `passwordHintDekEncrypted`, `passwordHintDekIv`）をあえて結合せず、表示・検索に必要なプロパティ（`_id`, `id`, `label`, `loginId`）のみを返却する。これにより転送データ量を激減させ、不要な暗号化データのクライアント漏洩を防ぐ（最小権限の原則）。詳細画面（`/records/$id`）は独立した `getRecordDetail` で完全なクレデンシャルを取得する。

---

## 16. 監査ログ記録パターン (`auditLogs.ts` / `logAuditEvent`)

PoohMa では操作ログを**専用ユーティリティ関数 `logAuditEvent`** に集約し、各 Mutation から呼び出す一貫パターンを採用している。

```typescript
// convex/auditLogs.ts - 共通ヘルパー（Mutation内からのみ呼出し可）
import { logAuditEvent } from "./auditLogs";

// records.ts 内の Mutation
await logAuditEvent(ctx, {
  actor: ctx.user,           // Doc<"users"> - actorDisplayName を自動抽出
  recordId: args.id,
  ownerType: "family",
  ownerFamilyId: ctx.user.familyId,
  targetAccountId: undefined,
  action: "RECORD_UPDATE",
  metadata: {
    targetTitle: record.title,
    changedFields: diffFields, // 変更フィールド名配列
  },
});
```

### 設計上のポイント

- **操作時点の表示名を保存**: `actor.displayName || actor.email || "メンバー"` を `actorDisplayName` に記録。脱退・削除後の参照切れに対応。
- **`familyId` の設定ルール**: `ownerType === "family"` のときのみ `familyId` を設定し、`by_family_createdAt` インデックスで家族ログ取得に使用する。個人レコード（`ownerType: "user"`）操作は `familyId` を持たない。
- **ヒント閲覧は `serviceRecords` も同時更新**: `logRecordHintView` では `auditLogs` への記録に加え、`serviceRecords.lastViewedAt` / `lastViewedByAccountId` も `patch` する。
- **UI への影響ゼロ保証**: クライアント側（`CredentialCard`）からの `logRecordHintView` 呼び出しは `.catch(() => {})` で失敗をサイレント無視し、ログ記録の失敗が復号表示をブロックしないようにする。
- **180日 TTL + 再帰バッチ削除**: 24時間cron で `by_createdAt` インデックスを使って100件ずつ削除し、件数上限到達時は `ctx.scheduler.runAfter(0, ...)` で自己スケジュールして全削除を完結させる。

---

## 17. Convex 有界並行 I/O & ページネーションパターン (`records.ts`)

Convex の同時 I/O 上限（1,000 ops）およびトランザクション実行時間・読み取り上限を回避するための標準パターン。

```typescript
// 1回の Promise.all による同時 I/O をチャンクサイズ（32件）に制限
export async function asyncMapBounded<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
  chunkSize = 32,
): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
```

- `getRecordsPaginated` でページネーションを行い、ページ内レコードに対してのみ `asyncMapBounded` を適用することで、大量データ環境下でもトランザクション上限と同時 I/O 上限を確実に回避する。

---

## 18. UIテキストの非技術者向け平易化 & JpText 日本語整形パターン

PoohMa はITリテラシーを問わず家族全員が利用するサービスであるため、技術用語・開発者用語の露出を避け、直感的で安心感のある表現に統一する。

### 1. 用語の置き換えガイドライン
| 内部・技術用語 | UI上の推奨表現 | 理由・文脈 |
| :--- | :--- | :--- |
| **OGP / OGP取得** | サイト情報 / サイト情報を更新 | 非技術者には「OGP」の意味が伝わらないため |
| **復号 / 復号中** | 読み込み / ロック解除 / 表示中 | 暗号処理の詳細ではなく、ユーザー目線の動作を表現 |
| **競合 (Conflict)** | 他のご家族の更新と重複 / 上書きの可能性 | 同時編集時の注意をご家族目線で分かりやすく伝える |
| **マスターキー** | 家族データ / 暗号鍵 / 家族専用キー | 内部暗号概念の露出を控え、保護対象または用途を明示 |
| **セッション終了** | ログアウトしてログイン画面に戻る | 状態変化を自然な日本語動詞で表現 |
| **CSVエクスポート** | CSVファイルをダウンロード / 手元に保存 | 操作結果（手元に保存されること）を強調 |

### 2. `JpText` による句点自動改行と BudouX の併用
スマートフォンの小画面で長文が文字の塊（壁）になることを防ぐため、`JpText`（BudouX）を活用する。
- **句点分割**: 文末以外の句点（`。`）の直後に改行を挿入し、一文ごとに `<br />` を生成。
- **自然な折り返し**: 各文の内部では BudouX が `<wbr />` を挿入し、単語の途中での不自然な改行を防止。
- **JSX要素の共存**: プレーンテキストだけでなく、強調（`<strong>`）やリンク（`<a>`）等の混在時も再帰的に適用。
- **JSX境界の文区切り維持**: テキストノードの末尾が「。」で終わり直後に兄弟ノード（`<strong>` 等）が続く場合や、JSX要素の末尾が「。」で終わり直後にテキストが続く場合も、兄弟要素の存在を検知して境界に `<br />` を挿入し、文単位の改行を保持する。

---

## 19. CSV差分インポート・仮想スクロールプレビュー・Code Splitting パターン

最大500行のCSVデータを取り込み、既存データとの差分を安全に検知・プレビュー確認・一括反映するためのパターン。

### 1. 柔軟なCSVパースとヘッダーマッピング
- **順不同・列位置可変**: PapaParse の `header: true` を使用し、列の物理的な順序に関わらず1行目のヘッダー名でマッピング。
- **ヘッダー名トリム**: `transformHeader: (h) => h.trim()` により前後の空白を除去して完全一致比較。未知の列はスキップ。
- **クレデンシャル列グループ化**: `CredentialId{n}`, `Label{n}`, `LoginID{n}`, `PasswordHint{n}`（`n` = 1〜10）の番号サフィックスからグループを構築。

### 2. 最小権限の差分突合 (`getRecordsForDiffImport`)
- 突合に必要な平文メタデータ（`stableId`, `title`, `url`, `memo`, `ownerType`, `admins`, `tags`, `credentials.stableId/label/loginId/hasPasswordHint`）のみを取得。暗号化フィールド（密文・IV・DEK）は取得せず、帯域とクライアント負荷を最小化。

### 3. E2EE整合性と空セル値保護
- **空セル値維持 (SKIP)**: CSV側のセルが空の場合は既存値を維持し、誤操作によるデータ消去を防止。
- **PasswordHint の暗号化最適化**:
  - CSV側のヒントが空: 暗号化をスキップし既存暗号化データを維持（パスコード入力不要）。
  - CSV側に平文ヒントあり: パスコードマスターキーをアンロックし、`encryptHint` で再暗号化。
- **UIブロック防止 (ADR-007)**: `processInChunks`（10件単位で `setTimeout(0)` によるマクロタスク yield）により、Web Worker なしでも 60fps の応答性とプログレスバー・トースト表示を両立。

### 4. 仮想スクロールプレビュー最適化と横スクロール完全一致 (`CsvImportPreviewTable.tsx`)
- **ヘッダー・ボディ横スクロール完全一致構造**:
  - ヘッダーと行リストを別々のスクロールコンテナに分割すると、スクロール同期にラグやズレが発生する。
  - **単一スクロールコンテナ（`parentRef`）直下に最小幅ラッパー（`min-w-[850px]`）を配置し、その中に `sticky top-0 z-10` のヘッダーと仮想アイテム行コンテナ（`translateY`）を同居させる**。
  - これにより、ブラウザ標準のスクロール機構で横スクロール位置および各列の幅が1pxの狂いもなく完全一致し、縦スクロール時のヘッダー上部固定もノーコストで達成できる。
- **レイアウトシフト防止**: `estimateSize: () => 56` と `measureElement` による可変高の正確な自動計測。
- **安定キー (`getItemKey`)**: `csvRow` 番号をキーとして指定し、フィルタ切替時の不要な再計測を抑制。
- **行コンポーネント完全メモ化 (`React.memo`)**: スクロールイベント時の不要な子コンポーネント再描画を完全に遮断。
- **行単位の制御**: 行ごとの「反映する」チェックボックスおよび「エラー行以外を反映」トグルによる柔軟な反映制御。

### 5. 全画面共通コンポーネントの Code Splitting パターン (`UserMenu.tsx` → `/settings/bulk`)
- 全画面（ダッシュボード、レコード詳細、設定等）で常時マウントされる共通ヘッダー・メニュー（`UserMenu`）に、CSV解析（`papaparse`）や仮想化（`@tanstack/react-virtual`）などの特定業務専用の重いライブラリを直接含めない。
- 業務機能を専用ルート（`/settings/bulk`）に分離し、メニュー側はシンプルな `<Link to="/settings/bulk">` のみに留める。
- 専用画面内でも、初期表示が不要な重いテーブルコンポーネントは `React.lazy` と `Suspense` で遅延ロードする。
- この分離により、共通メニューのチャンクサイズを **92.30 kB → 37.52 kB（約60%削減）** し、アプリ全体の初期表示速度とTBT（Total Blocking Time）を劇的に改善できる。

### 6. 安全な一括反映 (`applyImportDiff`)
- 家族境界および管理者権限（`requireAdminAccess`）をレコードごとに厳密に検証。
- 更新対象の非空フィールドのみ `db.patch` し、監査ログ（`RECORD_UPDATE`）を記録。




