# Pitfalls: 認証・セッション管理

Firebase Auth および Session Cookie 管理における落とし穴と回避法です。

---

### Convex 認証への Firebase Custom Token の誤用

- **問題**: Server Function 内などで `adminAuth().createCustomToken(uid)` を生成し、`ConvexHttpClient.setAuth(customToken)` に渡しても Convex 側で JWT 検証エラー（`Unauthenticated`）が発生する。
- **原因**: Convex の OIDC 認証（`auth.config.ts`）は Google 発行の Firebase ID Token（`securetoken.google.com/poohma`）のみを受け付ける。Custom Token は Firebase サービスアカウントによる署名であり OIDC JWT ではない。
- **回避法**: Convex の Mutation / Query 実行は、ブラウザの認証済みクライアント（`useMutation`, `useQuery`）から直接 Firebase ID Token を使って呼び出す。

---

### Session Cookie への過剰依存による早期ログアウト（数ヶ月ログイン維持の破壊）

- **問題**: TanStack Router の `(app)` ルート保護（`beforeLoad`）で `context.user`（Session Cookie 由来）のみを見て未認証判定（`/login` へ強制リダイレクト）すると、Cookie の最大有効期限（14日）や iOS Safari の Cookie 制約で Cookie が切れた瞬間にユーザーが追い出される。
- **原因**: 長期ログインの本体（Single Source of Truth）はブラウザの Firebase Auth（LOCAL 永続性）であり、Session Cookie は SSR 補助キャッシュに過ぎない。
- **回避法**: ルート保護はクライアント側 `useAuth().isAuthenticated` を判定基準とし、Cookie が切れていても Firebase Auth が生きていればバックグラウンドで `refreshSessionCookie` により Cookie を自動ローリング延長する（DB更新やログイン通知は行わない）。また、`refreshSessionCookie` 内では `verifyIdToken(idToken, true)` で明示的に失効チェックを行い、失効済みアカウントによる不正なセッション延長を防ぐ。

---

### `verifySessionCookie(..., true)` の `checkRevoked` 誤用によるセッション消失

- **問題**: 通常のセッション検証で `verifySessionCookie(sessionCookie, true)`（`checkRevoked = true`）を指定すると、リクエストごとに Google Auth サーバーへの外部通信が発生し、ネットワークの揺らぎやタイミング差で `session-cookie-revoked` が誤検知され、セッションが突然切れる。
- **回避法**: 通常の SSR セッション検証では `checkRevoked: false` を使用し、パフォーマンスと安定性を担保する。

---

### バックグラウンド非同期処理におけるユーザー・ログアウトのレースコンディション

- **問題**: `syncSessionCookieInBackground` 等のバックグラウンド非同期処理において、`await user.getIdToken()` などの非同期呼び出しの合間にユーザーがログアウトしたり別ユーザーへ切り替わった場合、遅れて返ってきた古いレスポンスが共有の `session` Cookie を上書きし、失効したセッションが復活してしまう。
- **回避法**: 非同期処理の「開始前」と「完了直前（Cookie書き込み前）」の双方で、`auth?.currentUser?.uid === user.uid` かつ `!localStorage.getItem(LOGOUT_FLAG_KEY)` を検証し、状態変化が起きていれば即座に処理を破棄（no-op）する。

---

### リカバリー用 Custom Token 発行時のセッション失効検証漏れ

- **問題**: セッションCookieからCustom Tokenを再発行するリカバリー関数（`getCustomTokenFromSession`）で `verifySessionCookie(cookie, false)`（失効検査オフ）を使うと、別端末や他タブでログアウト（`revokeRefreshTokens`）済みとなった古いCookieからでもCustom Tokenが再発行され、再ログインに成功してしまう。
- **回避法**: 通常のSSR検証（`getAuthUser`）では `checkRevoked: false` を用いるが、**セッションの再生産・リカバリーを行う `getCustomTokenFromSession` では必ず `checkRevoked: true` を明示**して失効済みセッションを遮断する。

---

### ログアウト状態のタブローカル管理（sessionStorage の誤用）

- **問題**: ログアウトフラグを `sessionStorage` だけで保持すると、他タブにログアウトが伝播せず、他タブ側のサイレント再認証が古いCookieを使ってセッションを復活させてしまう。
- **回避法**: オリジン全体で共有すべき認証状態・ログアウトフラグは `localStorage` に一本化し、`window.addEventListener("storage", ...)` で他タブのログアウトを即時検知して全タブを未認証状態へ同期させる。

---

### `/(public)/login` の `beforeLoad` による逆リダイレクトと白画面バウンス

- **問題**: クライアント側の Firebase Auth が未認証になった際、再ログインのために `/login` へアクセスしたにもかかわらず、`login.tsx` の `beforeLoad` が古い Session Cookie（`context.user`）を見て `throw redirect({ to: "/dashboard" })` してしまうと、未認証のまま `/(app)` へ突き返され、画面が真っ白にフリーズする。
- **回避法**: `login.tsx` では `beforeLoad` による即時強制リダイレクトを行わず、ブラウザ側（`LoginPage` 内の `onAuthStateChanged`）で実際にログイン状態が確認できた場合にのみ `/dashboard` へナビゲートする。
