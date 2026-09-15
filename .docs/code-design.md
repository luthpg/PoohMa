# 家族間アカウント管理アプリ「PoohMa」詳細設計書

**プロジェクト:** PoohMa (プーマ)

## 0. 本書について

本書は「PoohMa 要件定義書」に対応する設計書である。
実際のアーキテクチャ決定記録（ADR）等が別途存在する場合はそちらを優先する。

> **命名についての注記：** リポジトリ内には本書と同名の `design.md` というファイルが別途存在するが、それはビジュアルデザイン仕様書（配色・タイポグラフィ・コンポーネントスタイリング等）であり、本書（システムアーキテクチャ・DB・API設計を扱う設計書）とは別物である。
> 混同を避けるため、本書では前者を「UIデザインシステム仕様書」と呼び、8.5章で概要を参照する。

## 1. システムアーキテクチャ概要

PoohMaは、フロントエンドとサーバーサイド処理を単一のTanStack Startアプリケーションで統合しつつ、データベース・ビジネスロジックの大部分をConvex（BaaS）に委譲する構成である。
認証はFirebase Authenticationを用い、コンテンツ管理はmicroCMS、メール送信はResendを利用する。

```txt
[ブラウザ]
  │  E2EE暗号化/復号 (Web Crypto API)
  │  WebAuthn (生体認証)
  │  Service Worker / IndexedDB (オフラインキャッシュ)
  ▼
[TanStack Start アプリ (Vercel)]
  ├─ SSR / ルーティング (TanStack Router)
  ├─ Server Functions
  │    ├─ syncUser / getAuthUser / logout  → Firebase Admin SDK でIDトークン検証・セッションCookie発行
  │    └─ getDashboardPrefsFn 等            → Cookieベースのユーザー設定
  ├─ ConvexReactClient (クライアント→Convexへの認証済みアクセス)
  └─ microCMS SDK 経由でFAQ／規約コンテンツ取得
  │
  ▼
[Convex Cloud]
  ├─ Query / Mutation (families / users / records)
  ├─ Action (actions.ts: OGP取得, ふりがな取得, メール送信)
  ├─ HTTP Action (http.ts: getUserByFirebaseUid ─ 内部シークレット認証)
  ├─ Cron (crons.ts: 期限切れ家族移行データ・Export Vault・家族招待・編集セッション・監査ログの定期クリーンアップ)
  └─ 外部連携
       ├─ Resend (メール送信)
       ├─ Yahoo!テキスト解析API (ふりがな取得)
       └─ 任意の外部Webサイト (OGP取得, SSRF対策あり)

[Firebase Authentication]
  └─ auth.config.ts の Issuer (securetoken.google.com/poohma) を
     Convex側でも信頼するIDプロバイダとして設定し、
     クライアントから渡るFirebase IDトークンをConvex側でも直接検証する。
```

### 1.1 オフライン対応（PWA, FR-PWA-03）

```txt
Service Worker (Workbox等):
  - 静的アセット（JS/CSS/フォント）はCache Firstで配信
  - Convexへの getRecords / getRecordDetail 等の読み取り系レスポンスは、
    取得成功のたびにIndexedDB（暗号化済みのまま）へミラーリング保存する
    （passwordHintはE2EE暗号化済み、サービス名・URL・メモ・タグ・ログインID等のメタデータは
    平文としてIndexedDBへ永続化される。復号処理はブラウザメモリ上でのみ行う。6章の鍵階層は据え置き）

オフライン時の閲覧フロー:
  1. ネットワーク不通を検知（Network First失敗 or navigator.onLine）
  2. IndexedDBにミラーリングされた暗号化済みレコード一覧・詳細を表示
  3. パスコード入力 or 生体認証によりマスターキーをブラウザメモリ上に展開
     （オフライン中もPBKDF2/WebAuthn処理はローカルで完結するため実行可能）
  4. 復号したヒントを表示（新規登録・編集・共有範囲変更等の書き込み系操作は
     オフライン中は無効化し、オンライン復帰まで待機する）

オンライン復帰時:
  - Convexの最新データで IndexedDBミラーを差分更新
  - 復帰前にオフライン専用の書き込みキューは持たない（Read-onlyキャッシュとして
    設計し、書き込み競合の複雑化を避ける）
```

## 2. 技術スタック一覧

| 分類             | 技術・ライブラリ                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| フロントエンドフレームワーク | React 19, TanStack Start（SSR）                                                                                                |
| ルーティング         | TanStack Router（ファイルベースルーティング、(app)/(public)のルートグループ分割）                                                                      |
| スタイリング         | Tailwind CSS v4, shadcn/ui（radix-ui ベース）、Geist Sans／Geist Mono（ `@fontsource/geist-sans`, `@fontsource/geist-mono` 。8.5参照）   |
| 状態管理・データ取得     | TanStack Query, Convex React SDK（リアルタイムQuery/Mutation）。責務分離は8.4参照                                                            |
| 日本語処理          | budoux（禁則処理・分かち書き、和文の適切な折り返し）                                                                                                |
| UI補助           | next-themes（ライト/ダーク/システムテーマ切替）、cmdk（コマンドパレット系UI）、@icons-pack/react-simple-icons（サービスロゴアイコン）、html-react-parser（CMSリッチテキストの描画） |
| バックエンド／DB      | Convex（サーバーレス関数＋リアクティブDB）                                                                                                    |
| 認証             | Firebase Authentication（Google OAuth）＋ firebase-admin（サーバー側検証）＋ httpOnlyセッションCookie                                          |
| CMS            | microCMS（microcms-js-sdk）                                                                                                    |
| メール送信・テンプレート | Resend, React Email（`@react-email/components`）                                                                                |
| 外部API          | Yahoo!テキスト解析API（ふりがな）、任意サイトのOGPスクレイピング（cheerio）、Abstract IP Geolocation API（位置情報取得）                                 |
| CSV処理          | papaparse                                                                                                                    |
| QRコード          | qrcode.react                                                                                                                 |
| PWA            | Web App Manifest、iOS standalone判定ロジック（自前実装）、Service Worker（Workbox等）＋IndexedDB（オフラインキャッシュ、FR-PWA-03）                         |
| PDF生成          | クライアントサイドPDF生成ライブラリ（例: jsPDF等）＋qrcode.react（リカバリーキー印刷用、FR-CRYPT-06）                                                          |
| 暗号             | Web Crypto API（AES-GCM, PBKDF2）、WebAuthn（PRF拡張）                                                                              |
| バリデーション        | zod, convex-helpers（customQuery/customMutation）                                                                              |
| 監視             | Vercel Analytics, Vercel Speed Insights                                                                                      |
| テスト            | Vitest, @testing-library/react, convex-test, Playwright（ブラウザモード）                                                             |
| コンポーネントカタログ    | Storybook                                                                                                                    |
| Lint／フォーマット    | Biome                                                                                                                        |
| デプロイ           | Vercel（フロントエンド）、Convex Cloud（バックエンド）                                                                                         |

## 3. ディレクトリ構成（抜粋）

本プロジェクトは pnpm workspace + Turborepo によるモノレポ構成を採用しています。

```txt
poohma/                    … プロジェクトルート（Turborepo / pnpm workspace）
├── apps/
│   └── web/               … @poohma/web（TanStack Start + Convex）
│       ├── convex/         … Convexのスキーマ・Query/Mutation/Action定義
│       │   ├── _generated/ … Convexが自動生成する型・APIクライアント
│       │   ├── actions.ts  … OGP取得・ふりがな取得・メール送信 (Node runtime)
│       │   ├── auth.config.ts … Firebase IDトークンの信頼プロバイダ設定
│       │   ├── auditLogs.ts … 監査ログ書き込みヘルパー (logAuditEvent)
│       │   ├── crons.ts    … 定期バッチ定義
│       │   ├── customBuilders.ts … 認証・認可レベル別のQuery/Mutationビルダー
│       │   ├── families.ts … 家族グループ・参加申請・家族移行ロジック
│       │   ├── http.ts     … 内部HTTPエンドポイント (getUserByFirebaseUid)
│       │   ├── records.ts  … サービスレコードCRUD・検索・タグ・一括操作・監査ログ記録
│       │   ├── rls.ts      … レコード単位アクセス制御 (requireRecordAccess)
│       │   ├── schema.ts   … DBスキーマ定義
│       │   └── users.ts    … ユーザー同期・プロフィール・退会
│       ├── src/
│       │   ├── components/ … 共通UIコンポーネント (AppHeader, PasscodeProvider 等)
│       │   ├── emails/     … メールテンプレート定義・配信レジストリ (React Email / Resend)
│       │   │   ├── _components/ … メール共通コンポーネント (EmailLayout, EmailButton 等)
│       │   │   ├── templates/   … 用途別テンプレート (account/, family/, security/)
│       │   │   ├── dispatch.ts  … メール送信ディスパッチャ
│       │   │   └── registry.ts  … テンプレートレジストリ・Convex Payloadスキーマ
│       │   ├── env/        … クライアント/サーバー環境変数スキーマ (t3-env)
│       │   ├── hooks/      … usePersistentQuery, useConvexFirebaseAuth, use-export-csv 等
│       │   ├── lib/        … crypto.ts (E2EE), biometric.ts (WebAuthn), cms.server.ts
│       │   ├── routes/
│       │   │   ├── (app)/  … 認証必須ルート群 (dashboard, records, family, settings)
│       │   │   ├── (public)/ … 公開ルート群 (LP, usage, faq, login, 規約等)
│       │   │   └── __root.tsx … 全体レイアウト・グローバルProvider
│       │   ├── services/   … サーバー関数 (auth.functions.ts, cms.functions.ts, prefs.functions.ts,
│       │   │                   security.functions.ts, firebase-admin.server.ts)
│       │   └── utils/      … schemas.ts (zod), geo-ip.server.ts (位置情報取得),
│       │                       request-context.server.ts (リクエストメタデータ解析),
│       │                       url-safety.ts (SSRF対策), csv-sanitize.ts,
│       │                       index-group.ts (五十音インデックス), chunk-processor.ts
│       └── tests/          … 単体・結合テスト群 (Vitest / convex-test)
├── workers/
│   └── backup/            … @poohma/backup（定期自動バックアップ用Cloudflare Worker）
├── pnpm-workspace.yaml    … ワークスペース定義
├── turbo.json             … Turborepo パイプライン設定
├── tsconfig.base.json     … 共通 TypeScript 設定
├── biome.json             … 統一 Lint / Format 設定
└── package.json           … ルート定義・スクリプト
```

## 4. データベース設計（Convexスキーマ）

### 4.1 ER概要（テキスト表現）

```txt
families 1 ── * users            (users.familyId → families._id)
families 1 ── * serviceRecords    (serviceRecords.familyId → families._id)
families 1 ── * joinRequests       (joinRequests.familyId → families._id)
families 1 ── * familyInvites       (familyInvites.familyId → families._id)
families 1 ── * familyMigrations    (familyMigrations.targetFamilyId / sourceFamilyId → families._id)
families 1 ── * pendingExportVaults (pendingExportVaults.oldFamilyId → families._id)
familyInvites 1 ── * joinRequests   (joinRequests.invitedByCode → familyInvites._id, optional)
users     1 ── * serviceRecords      (serviceRecords.accountId → users._id, serviceRecords.userId = users.userId)
users     1 ── * joinRequests         (joinRequests.userId = users.userId, 文字列参照)
users     1 ── * pendingExportVaults  (pendingExportVaults.accountId → users._id)
users     1 ── * recordEditingSessions (recordEditingSessions.accountId → users._id)
serviceRecords 1 ── * credentials    (credentials.recordId → serviceRecords._id)
serviceRecords 1 ── * recordEditingSessions (recordEditingSessions.recordId → serviceRecords._id)
serviceRecords 0..* ── * auditLogs    (auditLogs.recordId → serviceRecords._id, optional)
families  0..* ── * auditLogs         (auditLogs.familyId → families._id, optional)
users     0..* ── * auditLogs         (auditLogs.accountId → users._id, optional / 削除後も参照切れ考慮)
```

### 4.2 テーブル定義

#### families

| フィールド | 型 | 説明 |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| name | string | 家族グループ名 |
| masterKeyEncrypted | string(optional) | パスコード由来鍵でラップされたマスターキー（Base64） |
| masterKeyIv | string(optional) | 上記ラップ処理のIV（Base64） |
| masterKeySalt | string(optional) | パスコードからの鍵導出（PBKDF2）に使うソルト（Base64） |
| kdfIterations | number(optional) | パスコード鍵導出（PBKDF2）の反復回数。作成・パスコード変更時点の値を記録し、復号時はこの値を動的に適用する（NFR-SEC-14）。未設定時はレガシー値300,000 |
| cryptoVersion | number(optional) | KDF・暗号化スキームのバージョン番号。未設定時はレガシー値1 |
| recoveryMasterKeyEncrypted | string(optional) | リカバリーキー由来鍵でラップされたマスターキー（Base64、FR-CRYPT-06） |
| recoveryMasterKeyIv | string(optional) | 上記リカバリーラップ処理のIV（Base64） |
| recoveryMasterKeySalt | string(optional) | リカバリーキー鍵導出（PBKDF2）に使うソルト（Base64） |
| recoveryCodeHash | string(optional) | 正規化リカバリーコードのSHA-256ハッシュ（サーバー側検証用、平文コードは非保存） |
| recoveryKdfIterations | number(optional) | リカバリーキー鍵導出（PBKDF2）の反復回数（デフォルト300,000） |
| recoveryCryptoVersion | number(optional) | リカバリーキー暗号化スキームのバージョン番号（デフォルト1） |
| recoveryIssuedAt | number(optional) | リカバリーキット発行・再発行日時 |
| recoveryIssuedByAccountId | Id<"users">(optional) | リカバリーキットを発行・再発行したユーザーアカウントID |
| updatedAt | number | 更新日時（epoch ms） |

#### recoveryOtps

| フィールド   | 型                 | 説明                                                         |
| ------------ | ------------------ | ------------------------------------------------------------ |
| accountId    | Id<"users">        | 復元をリクエストしたPoohMaアカウントID                       |
| familyId     | Id<"families">     | 復元対象の家族グループID                                     |
| codeHash     | string             | 生成された6桁OTPのSHA-256ハッシュ値（平文保存禁止）          |
| expiresAt    | number             | 認証コード有効期限（発行から10分）                           |
| attempts     | number             | 入力試行回数（最大5回で失効）                                |
| lastSentAt   | number             | 最終送信日時（60秒以内の再送レート制限制御）                 |

インデックス: by\_accountId, by\_familyId\_accountId

#### users

1つのFirebase User (`userId`) に対して複数のPoohMa Account（`_id: Id<"users">`）を保持可能（1:N）。各レコードが独立した所属家族（`familyId`）・表示名・プロファイル・暗号化境界を持ちます。

| フィールド | 型 | 説明 |
| ----------- | ---------------------- | ------------------------------------------------------------------- |
| userId | string | Firebase UID（複数のusersレコードで同一の値を取りうる） |
| email | string | メールアドレス |
| displayName | string(optional) | 表示名（アカウント識別子としても機能。createAccountで必須、syncUserでは初期補完に使用） |
| photoURL | string(optional) | プロフィール画像URL |
| familyId | Id<families>(optional) | 所属家族グループ（アカウントごとに独立） |
| familyRole | ("admin" \| "viewer") | 家族内ロール（"admin": ファミリー管理者, "viewer": メンバー） |
| onboardingVersion | number(optional) | オンボーディング進捗バージョン（未開始: 0または未設定、完了: 1以上） |
| createdAt | number(optional) | 作成日時 |
| updatedAt | number | 更新日時 |

インデックス: by\_userId, by\_email, by\_familyId

#### familyMigrations

| フィールド | 型 | 説明 |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| userId | string | 移行を実行したユーザー |
| sourceFamilyId | Id<families>(optional) | 移行元家族（未所属からの移行時はnull） |
| targetFamilyId | Id<families> | 移行先家族 |
| serviceRecordIds | Id<serviceRecords>\[] | 移行対象レコードIDのスナップショット |
| recordUpdatedAtSnapshot | {recordId, updatedAt}\[](optional) | 各レコードのfetch時点のupdatedAtを保持する配列（楽観的ロック用のバージョンスナップショット。要素は{recordId: Id<serviceRecords>, updatedAt: number}） |
| processedRecordIds | Id<serviceRecords>\[](optional) | 処理済みレコードIDの配列（バッチ失敗時の再開カーソル。未処理レコードはserviceRecordIds差分で特定し、レジューム可能にする） |
| status | "PREPARED" \| "COMPLETED" \| "EXPIRED" \| "ABORTED" | 移行処理の状態 |
| createdAt | number | 作成日時 |
| expiresAt | number | 有効期限（作成から30分後） |

インデックス: by\_userId, by\_status

#### pendingExportVaults

キックされたユーザーの旧家族マスターキー情報を一時退避するテーブル。被キックユーザーは旧パスコードを用いて個人所有レコード（`ownerType: "user"`）のみを新家族へ持ち出すことができる。有効期限（30日）経過または持ち出し完了・明示的破棄により削除される。

| フィールド | 型 | 説明 |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------- |
| accountId | Id<"users"> | 被キックユーザーのアカウントID（users._id） |
| userId | string | 被キックユーザーのFirebase UID（照会・監査用） |
| oldFamilyId | Id<"families"> | キック元の家族ID |
| oldFamilyName | string | キック元の家族名（表示用スナップショット） |
| masterKeyEncrypted | string | 旧家族パスコード由来鍵でラップされたマスターキー（Base64） |
| masterKeyIv | string | 上記ラップ処理のIV（Base64） |
| masterKeySalt | string | 旧パスコード鍵導出（PBKDF2）のソルト（Base64） |
| kdfIterations | number(optional) | 旧パスコード鍵導出（PBKDF2）の反復回数 |
| cryptoVersion | number(optional) | 旧暗号化スキームのバージョン番号 |
| createdAt | number | 作成日時（epoch ms） |
| expiresAt | number | 有効期限日時（作成から30日後） |

インデックス: by\_accountId, by\_userId

#### familyInvites

| フィールド   | 型                      | 説明                                         |
| ------------ | ----------------------- | -------------------------------------------- |
| familyId     | Id<families>            | 招待対象の家族ID                             |
| code         | string                  | 招待コード（UUID等のランダム文字列）         |
| createdBy    | string                  | 発行者の Firebase UID                        |
| createdAt    | number                  | 作成日時                                     |
| expiresAt    | number                  | 有効期限日時（TTLに基づき算出）              |
| revokedAt    | number(optional)        | 手動失効日時（設定時は即無効）               |
| useCount     | number                  | この招待コード経由で作成された申請数（監査用）|

インデックス: by\_code, by\_familyId

#### joinRequests

| フィールド | 型 | 説明 |
| --------------------- | ------------------------------------- | ---------------------------- |
| familyId | Id<families> | 申請対象の家族 |
| userId | string | 申請者の Firebase UID |
| accountId | Id<users>(optional) | 申請元の PoohMa Account ID |
| invitedByCode | Id<familyInvites>(optional) | 申請に利用された招待コードID（監査証跡） |
| status | "pending" \| "approved" \| "rejected" | 申請状態 |
| createdAt / updatedAt | number | 作成・更新日時 |

インデックス: by\_familyId\_status, by\_userId\_status, by\_familyId\_userId, by\_accountId\_status, by\_familyId\_accountId, by\_invitedByCode

#### serviceRecords

| フィールド | 型 | 説明 |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| stableId | string(optional) | CSVエクスポート・差分インポート突合用の安定識別子（UUID v4）。全件バックフィル完了後は実質必須 |
| title | string | サービス名 |
| titleReading | string(optional) | 読み仮名（五十音インデックス用） |
| sortKey | string(optional) | 五十音順・アルファベット順ソートキー（グループ順位 2 桁ゼロ埋めプレフィックス + NFKC/ひらがな正規化文字列）。backfill 完了までは optional |
| url | string(optional) | サービスURL |
| ogpImage / ogpDescription | string(optional) | OGP自動取得結果 |
| customIcon | string(optional) | ファビコン取得失敗時のフォールバック表示（絵文字＋カラーコード等、FR-REC-19） |
| memo | string(optional) | メモ（最大10,000文字） |
| ownerType | ("user" \| "family")(optional) | 所有者種別（"user": 個人所有, "family": 家族共有）。backfill 完了までは optional |
| ownerFamilyId | Id<families>(optional) | 共有レコードが属する家族ID（ownerType === "family" の場合） |
| admins | Id<users>[](optional) | レコードの追加管理者（PoohMa accountId）配列。ファミリー管理者（familyRole === "admin"）は動的に管理者権限を持つため本配列には含めず、個別管理者として任命された一般メンバー（または個人レコード作成者）のみを格納する。backfill 完了までは optional |
| userId | string | 作成者の Firebase UID |
| accountId | Id<users> | 作成者の PoohMa Account ID（所有権・個人レコード境界） |
| familyId | Id<families>(optional) | 暗号化スコープ・所属家族ID |
| tags | string\[] | タグ |
| isPinned | boolean | ピン留め状態（デフォルトfalse、FR-REC-18） |
| isArchived | boolean | アーカイブ（非表示）状態（デフォルトfalse、FR-REC-23） |
| needsUpdate | boolean | 「要更新」フラグ（デフォルトfalse、FR-REC-17） |
| updateRequestedBy | string(optional) | 更新リクエストを送ったユーザーID |
| updateRequestedAt | number(optional) | 更新リクエスト日時 |
| lastViewedAt | number(optional) | 最終ヒント閲覧日時（epoch ms）。`logRecordHintView` 実行時に更新 |
| lastViewedByAccountId | Id<users>(optional) | 最終ヒント閲覧者のPoohMa Account ID |
| updatedByAccountId | Id<users>(optional) | 最終更新を行ったPoohMa Account ID（`createRecord` / `updateRecord` 時に記録） |
| revision | number(optional) | 楽観的ロック用リビジョン番号（0から開始、保存成功ごとに+1インクリメント） |
| isSample | boolean(optional) | サンプルデータフラグ（オンボーディング用のサンプルレコードはtrue） |
| updatedAt | number | 更新日時 |

インデックス: by_family_sortKey, by_family_isSample, by_ownerType_accountId, by_ownerType_ownerFamilyId, by_userId, by_accountId, by_family_updatedAt, by_ownerType_accountId_updatedAt, by_family_stableId, by_stableId

#### credentials

認証情報の正式な保存先。`recordId` で `serviceRecords` を参照し、1レコードあたり最大10件の上限は作成・更新Mutationで検証する。

| フィールド | 型 | 説明 |
| ------------------------ | ---------------------- | ----------------------------------------- |
| recordId | Id<serviceRecords> | 対象サービスレコード。`serviceRecords._id` を参照する |
| stableId | string(optional) | CSVエクスポート・差分インポート突合用の安定識別子（UUID v4）。全件バックフィル完了後は実質必須 |
| label | string(optional) | 認証情報ラベル（平文） |
| loginId | string(optional) | ログインID（平文でサーバーに保存される） |
| passwordHint | string(optional) | 暗号化済みパスワードヒント（Base64、E2EE暗号化対象） |
| passwordHintIv | string(optional) | 上記暗号化のIV |
| passwordHintDekEncrypted | string(optional) | マスターキーでラップされたDEK |
| passwordHintDekIv | string(optional) | DEKラップ処理のIV |
| order | number(optional) | 同一サービスレコード内での表示順 |
| updatedAt | number | 更新日時 |

インデックス: by\_recordId, by_recordId_stableId, by_stableId

#### auditLogs（監査ログ）

レコードの作成・更新・削除・ヒント閲覧・共有設定変更・管理者変更の全操作を家族単位で記録する監査テーブル。脱退・削除後のメンバー表示維持のため操作時点の表示名を `actorDisplayName` に保存する。180日経過したログは `cleanupOldAuditLogsInternal` により自動削除される。

| フィールド | 型 | 説明 |
| --------- | --------------------- | --------- |
| familyId | Id<families>(optional) | 家族共有レコード操作または家族内操作の場合に設定 |
| accountId | Id<users>(optional) | 操作者のPoohMa Account ID（削除後は参照切れ考慮） |
| userId | string | 操作者のFirebase UID |
| actorDisplayName | string | 操作時点の表示名（脱退・削除後のログ表示維持用） |
| recordId | Id<serviceRecords>(optional) | 対象レコードID（削除後も特定可能） |
| ownerType | "user" \| "family" | 操作時点の所有種別 |
| ownerFamilyId | Id<families>(optional) | ownerType === "family" の対象家族ID |
| targetAccountId | Id<users>(optional) | ownerType === "user" の所有者Account ID |
| action | "RECORD_CREATE" \| "RECORD_UPDATE" \| "RECORD_DELETE" \| "HINT_VIEW" \| "SHARE_SETTING_CHANGED" \| "ADMIN_CHANGED" | 操作種別 |
| metadata | object(optional) | 補足情報（targetTitle: レコード名, changedFields: 変更フィールド配列, detail: 付加情報） |
| createdAt | number | 記録日時（epoch ms） |

インデックス: by_family_createdAt（家族ログ取得）, by_recordId_createdAt（レコード別履歴）, by_targetAccountId_createdAt（個人レコード操作履歴）, by_createdAt（定期パージ用）。

#### recoveryOtps（FR-CRYPT-07）

| フィールド   | 型                 | 説明                                                     |
| ------------ | ------------------ | -------------------------------------------------------- |
| accountId    | Id<users>          | 対象アカウントID                                         |
| familyId     | Id<families>       | 所属家族グループID                                       |
| codeHash     | string             | 6桁OTPのSHA-256ハッシュ（平文はサーバー非保持）          |
| expiresAt    | number             | 有効期限日時（発行から10分）                             |
| attempts     | number             | 試行回数（最大5回超過で無効化）                          |
| lastSentAt   | number             | 再送レート制限用タイムスタンプ（60秒インターバル）       |

インデックス: by_accountId, by_familyId_accountId

#### recoverySessions（FR-CRYPT-07）

| フィールド        | 型                 | 説明                                                     |
| ----------------- | ------------------ | -------------------------------------------------------- |
| accountId         | Id<users>          | 対象アカウントID                                         |
| familyId          | Id<families>       | 所属家族グループID                                       |
| sessionTokenHash  | string             | ワンタイム認可セッショントークンのSHA-256ハッシュ       |
| expiresAt         | number             | 有効期限日時（発行から10分）                             |

インデックス: by_accountId, by_familyId_accountId。OTP検証成功時に一回限りのセッショントークンを発行・記録し、新パスコードによるマスターキー再ラップ実行時に検証・即時消費（削除）する。

#### recordEditingSessions（FR-REC-15）

レコードのリアルタイム同時編集検知とプレゼンス管理に用いる軽量セッションテーブル。

| フィールド  | 型                  | 説明                                                              |
| ----------- | ------------------- | ----------------------------------------------------------------- |
| recordId    | Id<serviceRecords>  | 対象サービスレコード                                              |
| accountId   | Id<users>           | 編集者のPoohMaアカウントID                                        |
| updatedAt   | number              | 最終ハートビート時刻（epoch ms）。TTLは5分（300,000ms）             |

インデックス: by_recordId, by_accountId, by_updatedAt, by_recordId_accountId。編集画面を開いている間30秒間隔でハートビート更新し、5分経過したセッションはクエリ側で自動失効扱いとする。保存完了時やキャンセル時に物理削除されるほか、放置された期限切れセッションは1分間隔の定期cron（cleanupExpiredEditingSessionsInternal）により自動削除される。

#### contacts

ユーザーまたは未認証訪問者からのお問い合わせ情報。

| フィールド | 型                                            | 説明                                           |
| ---------- | --------------------------------------------- | ---------------------------------------------- |
| name       | string                                        | 送信者名（1〜100文字）                         |
| email      | string                                        | メールアドレス                                 |
| category   | string                                        | お問い合わせ種別                               |
| message    | string                                        | メッセージ本文（5〜3000文字）                  |
| userId     | string(optional)                              | 送信者の Firebase UID（ログイン時）            |
| createdAt  | number                                        | 送信日時（epoch ms）                           |
| status     | "UNREAD" \| "READ" \| "RESOLVED"              | 対応ステータス                                 |

インデックス: by_createdAt, by_email_createdAt。同一メールアドレスによる短時間連投の抑止（レート制限）および一覧照会に使用。

## 5. 認証・認可設計

### 5.1 認証要素の責務分離（4層モデル）

PoohMa では、セッションの長期維持と安全なアクセス制御を両立するため、認証要素の責務を以下の4層に明確に分離します。

| 認証要素 | 役割 | 保持期間 | 責務と位置付け |
| --- | --- | --- | --- |
| **Firebase Auth** | 長期ログイン状態の本体 | 数ヶ月単位（無期限） | **Single Source of Truth**。IndexedDB + LocalStorage 永続化によりブラウザ側で長期間維持。 |
| **Firebase ID Token** | Convex バックエンドへの通信認証 | 1時間（SDK自動更新） | Convex への WebSocket/HTTP 通信時に付与され、Convex 側 OIDC 検証で直接認証。 |
| **session Cookie** | SSR初期表示・Server Function用キャッシュ | 14日間（自動ローリング延長） | サーバー側補助セッション。Cookie の期限切れのみでログアウト扱いにしてはならない。 |
| **Custom Token** | Client Auth 消失時のリカバリ | 一時発行（1回限り） | ブラウザストレージの揮発時に session Cookie から Client Auth を復旧するための非常用経路。 |

### 5.2 ログイン〜セッション確立・維持フロー

```txt
1. ユーザーが /login で「Googleでログイン」をクリック
2. Firebase Authentication (signInWithRedirect) によりGoogle認証画面へ遷移
3. リダイレクト復帰後、`onIdTokenChanged` で初期サインイン状態と以後のトークン更新を検知し、認証済みの場合はバックグラウンドで `syncSessionCookieInBackground(user)`（`refreshSessionCookie`）を呼び出して Cookie をローリング延長する
4. ID トークンを取得し、Server Function `syncUser` へ送信
5. サーバー側 (firebase-admin.server.ts) がIDトークンを検証 (adminAuth().verifyIdToken)
6. Convex Mutation `users.syncUser` によりConvex usersテーブルへユーザー情報を同期
   (メールアドレス未確認(emailVerifiedがfalse)の場合はエラーを送出して同期を拒否する。
    同一UIDが無く同一emailが既存の場合に限り、旧UIDのデータ（serviceRecords, joinRequests, familyMigrations）のuserIdを新UIDへ一括付け替える。所有権を示す serviceRecords.accountId は維持される)
7. `createSessionCookie` によりFirebaseセッションCookie(14日間, httpOnly, secure(本番), SameSite=Lax) を発行
8. 以後の各ページロード時：
   - SSR時: `__root.tsx` の beforeLoad が `getAuthUser` を呼び出し、セッションCookieがあれば初期ユーザー情報を取得（SSRキャッシュ）。
   - クライアント側: `(app)/route.tsx` 内の `AuthGuard` が `useAuth()`（Firebase Auth）の状態を監視。
     - 認証初期化中: ローディングスピナーを表示し、未認証と誤認して `/login` へリダイレクトしない。
     - 認証済み: 通常通り画面を描画。セッションCookieが失効または更新時期の場合は、バックグラウンドで `refreshSessionCookie` を実行し Cookie を自動ローリング延長（DB書き込みやログイン通知は行わない）。
     - 未認証確定時: `/login` へ安全にリダイレクト。
```

### 5.3 クライアント→Convexの認証連携

```txt
ConvexReactClient は ConvexProviderWithAuth でラップされ、
useConvexFirebaseAuth フックが fetchAccessToken として Firebase の
現在の IDトークン (auth.currentUser.getIdToken) を供給する。
Convex 側は auth.config.ts の Issuer 設定 (securetoken.google.com/poohma) により
渡されたトークンを直接検証する。
```

### 5.3 認可レベル（Convexカスタムビルダー: convex/customBuilders.ts）

| ビルダー | チェック内容 | 用途 |
| -------------------------------- | ----------------------------------------- | ------------------------- |
| identityVerifiedQuery / Mutation | Firebase Identity の存在のみ検証 | ユーザー新規同期処理など |
| authenticatedQuery / Mutation | Identity検証 + `resolveAccount` によるアカウント解決（所有権検証） | 一般的な認証必須API |
| familyBoundQuery / Mutation | 上記 + 対象アカウントの `user.familyId` が設定されていること | 家族所属が前提の機能（招待承認、家族固有クエリ等） |
| familyAdminMutation | 上記 + 対象アカウントの `familyRole === "admin"` であること | 家族設定・メンバーロール変更・キック等の管理者限定機能 |
| recordAdminMutation | familyBound + 対象レコード（`args.id`）が存在し `requireAdminAccess` を満たすこと（`ctx.record` 注入） | レコード個別管理者追加・解除等のレコード管理者限定機能 |

#### アカウント解決（resolveAccount）の仕組み

`authenticatedQuery` / `authenticatedMutation` / `familyBoundQuery` / `familyBoundMutation` / `familyAdminMutation` / `recordAdminMutation` は共通引数として `accountId?: v.optional(v.id("users"))` をサポートします。

1. `accountId` が明示的に渡された場合：
   - DB から当該 `users` レコードを取得。
   - `user.userId === identity.subject`（ログイン中 Firebase UID）であることを検証（IDOR 防止）。不一致の場合は `Unauthorized` 例外を送出。
2. `accountId` が省略された場合：
   - ログイン中 Firebase UID に紐づく先頭の `users` レコードへ自動フォールバック（下位互換性確保）。

生のConvex `query` / `mutation` を直接エクスポートすることは禁止し、必ず上記のカスタムビルダーを経由する。実装例（ `convex/records.ts` の `updateRecord` ）：

```txt
export const updateRecord = familyBoundMutation({
  args: { id: v.id("serviceRecords"), data: ConvexRecordInputSchema },
  handler: async (ctx, args) => {
    // 認証と家族所属チェック・対象アカウント解決は familyBoundMutation により自動化済み
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    // RLSバリデーターによる認可検証（5.4）
    requireAdminAccess(ctx.user, record);

    await ctx.db.patch(args.id, { ...args.data, updatedAt: Date.now() });
  },
});
```

### 5.4 レコード単位アクセス制御（convex/rls.ts）

```txt
requireContentAccess(user, record):
  // 家族境界チェック（レコードが家族に属している場合、ユーザーも同一家族でなければならない）
  if record.familyId !== undefined && record.familyId !== user.familyId:
    Access denied エラーを送出

  // 閲覧権限チェック: 家族共有レコード、または本人の個人レコード
  isOwner = record.ownerType === "user" && record.accountId === user._id
  isFamilyShared = record.ownerType === "family" && record.ownerFamilyId === user.familyId
  isOwner または isFamilyShared でなければ Access denied エラーを送出

requireAdminAccess(user, record):
  // 編集・削除・共有解除・管理者変更権限チェック
  if record.ownerType === "user":
    if record.accountId !== user._id:
      Access denied エラーを送出
  else: // ownerType === "family"
    isAdmin = getEffectiveFamilyRole(user) === "admin" || (record.admins ?? []).includes(user._id)
    if record.ownerFamilyId !== user.familyId || !isAdmin:
      Access denied エラーを送出

サーバー側の getRecordDetail は requireContentAccess、
updateRecord / deleteRecord / deleteRecords / unshareRecord / addRecordAdmin / removeRecordAdmin は requireAdminAccess を必ず経由する。
```

### 5.5 セッション失効時の入力保護（FR-AUTH-07）

```txt
ConvexReactClient / TanStack Query の Mutation実行を共通ラッパーでインターセプトし、
認証エラー（セッションCookie失効・IDトークン失効）を検知した場合：
  1. 実行しようとしていたMutationの引数（フォーム入力内容）とクライアント生成の
     idempotency key（UUID等）をReact State上に保持したまま、
     画面を覆う再ログインモーダルを表示する（入力欄はアンマウントしない）
  2. 再ログイン（Firebase再認証 → syncUser → セッションCookie再発行）が完了した時点で、
     保持しておいた引数と同一のidempotency keyを用いて元のMutationを自動的に再実行する
  3. サーバー側は、createRecord / updateRecord / importRecords 等の書き込みMutationに対して
     idempotency keyを受け取り、既に同一キーで処理済みの場合は再実行せず既存結果を返却する
     （初回リクエストがサーバー到達前にタイムアウトした場合のみ再実行し、
     サーバー処理済み・レスポンス欠落の場合は既存結果を再利用して重複作成・通知を防ぐ）
  4. 再実行が成功した時点でモーダルを閉じ、通常のフィードバック（トースト等）を表示する

本フローはフォーム保存系Mutation（createRecord / updateRecord / importRecords 等）に対して
共通的に適用できるよう、Mutation呼び出しの共通フックとして実装する。
```

### 5.6 ログアウトとセッション復元制御（FR-AUTH-04）

```txt
ログアウトフロー：
  1. クライアント側（UserMenu / FamilyComponent 等）で localStorage にログアウトフラグ（LOGOUT_FLAG_KEY = "poohma_logout"）を設定（他タブへは storage イベントで即時通知）
  2. Firebase Auth の signOut(auth) を実行
  3. サーバー関数 logout() を呼び出し：
     - 現在のセッションCookieから uid を検証し、Firebase Admin SDK の revokeRefreshTokens(uid) でリフレッシュトークンを即時失効
     - 発行時と同一属性（path, httpOnly, secure, sameSite）でセッションCookieを削除（deleteCookie および maxAge: 0）
  4. クエリキャッシュ（clearQueryCache / queryClient）を全クリア

サイレント再認証・セッション復元制御（useConvexFirebaseAuth）：
  - 認証状態の監視において、未認証時にサーバー側セッションCookieを用いたサイレント再認証（getCustomTokenFromSession）を行う（checkRevoked: true で検証）
  - ただし localStorage に LOGOUT_FLAG_KEY が存在する場合、または storage イベントで他タブのログアウトを検知した場合はログアウト状態と判定し、サイレント再認証をスキップして即時未認証状態（isAuthenticated=false）に確定させる
  - ユーザーが明示的に再ログインに成功した時点で LOGOUT_FLAG_KEY を削除する
```

## 6. 暗号化設計（E2EE）

### 6.1 鍵階層

```txt
家族パスコード（各メンバーが記憶する秘密情報。サーバー保存なし）
  │  PBKDF2 (SHA-256, iterations=families.kdfIterations（既定300,000。NFR-SEC-14により
  │           復号時は都度DBの値を動的に適用し、将来の反復回数引き上げ後も
  │           旧パラメータで作成された既存データを復号可能にする）,
  │           salt=families.masterKeySalt)
  ▼
パスコード導出鍵（AES-GCM 256, wrapKey/unwrapKey用途）
  │  unwrapKey（サーバーに保存された families.masterKeyEncrypted / masterKeyIv を復号）
  ▼
マスターキー（家族グループ共通, AES-GCM 256）
  │  認証情報ごとに generateDEK() で新規生成した鍵を wrapKey
  ▼
DEK（Data Encryption Key, 認証情報1件ごと, AES-GCM 256）
  │  encrypt(passwordHint, DEK)
  ▼
暗号化済みパスワードヒント（credentials.passwordHint / passwordHintIv として保存）

マスターキー自体は families.masterKeyEncrypted / masterKeyIv として保存され、
DEKは credentials.passwordHintDekEncrypted / passwordHintDekIv として保存される
（封筒暗号化 / Envelope Encryption 方式）。

【リカバリー経路（FR-CRYPT-06）】
同じマスターキーに対して、パスコード経路とは別に、リカバリーキー由来鍵でラップした
もう一つの入口を用意する（6.6参照）。
  リカバリーキー（高エントロピーなランダム文字列。サーバー保存なし・発行時に一度だけ提示） 
    │  HKDF-SHA256（高エントロピーなためPBKDF2の重い反復は不要）
    ▼
  リカバリーキー導出鍵
    │  unwrapKey（families.masterKeyRecoveryEncrypted / masterKeyRecoveryIv を復号）
    ▼
  マスターキー（パスコード経路と同一のものに到達する）
```

備考：エンベロープ暗号化は全レコードで必須であり、暗号化（encryptHint）・復号（decryptHint）・家族移行時の再ラップ（reWrapCredential）のいずれにおいても DEK を必須とする（マスターキー直接暗号化・復号へのフォールバックは行わない）。

### 6.2 実装関数（src/lib/crypto.ts, src/utils/passcode-strength.ts）

| 関数 / コンポーネント                               | 役割                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| deriveKeyFromPasscode(passcode, salt)       | PBKDF2でパスコード導出鍵を生成                                                                    |
| generateMasterKey() / generateDEK()         | AES-GCM鍵の新規生成                                                                         |
| wrapMasterKey / unwrapMasterKey             | マスターキーのラップ／アンラップ                                                                    |
| wrapDEK / unwrapDEK                         | DEKのラップ／アンラップ（マスターキーで）                                                                |
| reWrapCredential / reEncryptCredentials     | 移行時のDEK再暗号化（旧マスターキーでアンラップし、新マスターキーで再ラップ）                                            |
| encrypt / decrypt                           | AES-GCMによる汎用の暗号化／復号（IV自動生成）                                                           |
| generateSalt                                | PBKDF2用ソルトの生成                                                                         |
| evaluatePasscodeStrength(passcode)          | `@zxcvbn-ts` を用いたパスコード強度判定（最低10文字、zxcvbnスコア2以上、推測耐性チェック）                           |
| PasscodeStrengthMeter                       | パスコード入力時の強度メーターUI（プログレスバー・強度ラベル表示）                                                  |

#### パスコード誤入力時の指数バックオフと一時ロックアウト（`PasscodeProvider.tsx`）

- パスコード解除の誤入力を検知し、連続失敗回数（`failedAttempts`）をカウント。
- 3回以上連続で失敗した場合は指数バックオフ（$2^{n-3}$ 秒、最大30秒）による遅延（`lockoutUntil`）を適用し、ロックアウト期間中は送信ボタンを非活性化してトースト通知を表示。
- パスコード解除成功時に失敗カウントおよびロックアウト状態をリセット。

### 6.3 生体認証（WebAuthn PRF拡張, src/lib/biometric.ts）

登録フロー：

```txt
1. isBiometricSupported() でプラットフォーム認証器の利用可否を確認
   （PublicKeyCredential.isConditionalMediationAvailable 等によるバックグラウンド判定を含み、
    実際にWebAuthnの儀式（顔・指紋スキャン）を開始する前に非対応を検知する。FR-BIO-05）
   → 非対応の場合はエラー画面を出さず、案内メッセージとともにパスコード手入力の
     ダイアログへそのまま遷移する（同一のUIフローの入口を共有し、ユーザーからは
     「対応端末では生体認証、非対応端末ではパスコードが最初から出る」ように見える）
2. navigator.credentials.create() を PRF拡張 (extensions.prf.eval.first = ランダムsalt) 付きで実行
3. 取得したPRF出力をAES-GCM鍵としてインポート
4. 平文のパスコードをそのAES-GCM鍵で暗号化
5. { credentialId, encryptedPasscode, iv, prfSalt } を idb-keyval (IndexedDB) に
   ユーザーIDをキーとして保存（サーバーへは送信しない）
```

認証（ロック解除）フロー：

```txt
1. navigator.credentials.get() を、登録時と同一のprfSaltを指定して実行
2. 得られたPRF出力でAES-GCM鍵を復元
3. 保存済み encryptedPasscode を復号し、平文パスコードを取得
4. 通常の unlock(passcode) フロー（6.1のPBKDF2以降）に合流し、マスターキーを展開
```

### 6.4 家族移行時の再暗号化フロー

```txt
1. prepareFamilyMigration Mutation
   - 移行先家族ID (targetFamilyId) を確定 (新規作成 or 承認済み参加申請の家族)
   - 呼び出しユーザーの既存 serviceRecords ID一覧・各レコードの updatedAt をスナップショットし、
     familyMigrations レコードを status=PREPARED, expiresAt=作成+30分 で作成
     （recordUpdatedAtSnapshot フィールドに各レコードIDをキーとしたupdatedAtマッピングを保存し、
     後続のcommit時に楽観的ロックの前提条件として検証する）
   - 呼び出し時点で残っている自分の他のPREPARED移行は先にEXPIRED化しクリーンアップ

2. getMigrationForEncryption Query
   - 対象レコードの暗号化済みDEK・パスワードヒント・IV一覧をクライアントへ返却

3. クライアント側の再暗号化処理 (family.tsx - reEncryptCredentials)
   - 旧マスターキーで各DEKをunwrap → 新マスターキーで各DEKを再wrap
     （パスワードヒント本体は再暗号化不要、DEKの付け替えのみ）
   - DEK情報がない場合は reWrapCredential がエラーとし、マスターキー直接暗号化にはフォールバックしない

4. commitFamilyMigration Mutation（NFR-AVAIL-03/04対応：バッチ分割・楽観的ロック）
   - 再暗号化済みcredentialsを、1回あたり20〜50件程度のバッチに分割して複数回のMutation呼び出しで送信する
     （通信断・Convexのペイロード／実行時間制限に対する耐性を確保。familyMigrationsに
      processedRecordIds を保持し、失敗時は未処理分から再送してレジューム可能にする）
   - 各バッチのレコード更新時、対象レコードの updatedAt が 1. のrecordUpdatedAtSnapshotで
     スナップショットされた値と一致することを前提条件として検証する（楽観的ロック）。
     不一致の場合は当該レコードの更新を拒否し、「移行中に他メンバーが更新したため再取得が必要」として
     呼び出し元へ返す
   - 各バッチ成功時、処理済みレコードIDを processedRecordIds へ追記し、
     次回レジューム時はserviceRecordIds との差分を未処理レコードとして特定する
   - 全バッチ成功後、ユーザーのfamilyIdを更新、参加申請があれば削除
   - 移行元家族が空（メンバー0・レコード0）になった場合は削除
   - familyMigrationsのstatusをCOMPLETEDに更新

5. 失敗時：abortFamilyMigration Mutationで明示的中断、または放置時はCronで自動EXPIRED化
   （バッチ途中で中断した場合、processedRecordIdsを参照し、serviceRecordIdsとの差分を
    未処理レコードとして再開する。未処理のレコードは旧familyId・旧鍵のまま残るため、
    レジューム時は差分のみを再暗号化・送信する）
```

### 6.5 パスコードのみのローテーション（FR-FAM-10）

```txt
家族グループを変えずにパスコードだけを変更する場合、マスターキー自体は変更しない
（6.4の家族移行のようにDEK・パスワードヒントの再暗号化は不要）。

1. 新パスコードを入力（確認一致・強度チェック、NFR-SEC-13）
2. クライアント側で新しいソルトを生成し、新パスコードから新しい導出鍵を生成
3. 展開済みの現在のマスターキー（アンロック済み前提。未展開の場合は旧パスコードでの
   アンロックを先に要求する）を、新しい導出鍵で再wrap
4. Mutation families.rotatePasscode を呼び出し、以下のみを更新する：
   masterKeyEncrypted / masterKeyIv / masterKeySalt / kdfIterations / cryptoVersion
   （各レコードに `credentials.recordId` で紐づく認証情報・DEK・passwordHintは一切変更しない。
   DEKはマスターキーでラップされており、マスターキー自体は不変であるため、
   パスコード由来鍵の変更はDEKに影響しない。O(1)で完了する軽量な操作。
   Compare-And-Swapにより他端末・他メンバーとの同時更新時の競合を防止する）
5. 実行端末で生体認証が有効な場合は既存PRFシードを用いてローカル暗号化パスコードを更新。
   他の家族メンバーや別端末には通知メールを送信し、次回新パスコードでの解錠と生体認証の再登録を促す
6. リカバリーキーが発行済みの場合、recoveryMasterKeyEncrypted 等は
   同一マスターキーへの別経路のラップであるため、本操作による影響を受けず有効なまま残る
```

### 6.6 リカバリーキット（復元コード, FR-CRYPT-06, FR-CRYPT-07）

```txt
発行フロー：
  1. crypto.getRandomValues により高エントロピーなリカバリーコード（32文字のCrockford's Base32、4文字×8ブロック）
     を生成し、画面上に表示する（サーバーには平文はもちろん、導出可能な形でも一切送信しない）
  2. リカバリーコードと新規ソルトから PBKDF2-SHA256（300,000回）でAES-GCM鍵（リカバリー導出鍵）を導出
  3. 展開済みのマスターキーをリカバリー導出鍵でwrap
  4. リカバリーコードとQRコード、発行日時・対象家族名を記載したA4印刷・保管用PDF（pdf-libでクライアントサイド生成）を作成
  5. PDF生成完了後、Mutation recovery.registerRecoveryKit を呼び出し、
     recoveryMasterKeyEncrypted / recoveryMasterKeyIv / recoveryMasterKeySalt を更新（旧情報は即時無効化）
  6. 家族メンバー全員へリカバリーキット発行・再発行通知メールを送信
  7. ユーザーはPDFダウンロード、印刷、またはGoogle Drive連携により安全に保管する

利用（パスコード忘却時の2段階復元）フロー：
  1. 「パスコードを忘れた場合」導線または /recovery 画面へアクセス
  2. Step 1: リカバリーコードの入力（手入力、またはPDF/QRコード画像ドラッグ＆ドロップによる自動読み取り）
  3. Step 2: 登録メールアドレスへ6桁のワンタイムパスワード（OTP）を送信（sendRecoveryOtp）。
     OTPのSHA-256ハッシュをDBに保存（有効期限10分、試行回数上限5回、60秒再送レート制限）
  4. Step 3: OTPを入力し、Mutation verifyRecoveryOtpAndGetRecoveryData で検証。
     OTP検証成功時に短命なワンタイム認可セッショントークン（recoverySessions）を発行し、
     recoveryMasterKeyEncrypted 等の暗号化データを返却
  5. クライアント側でリカバリーコードから導出した鍵で recoveryMasterKeyEncrypted をunwrapし、マスターキーを復元
  6. Step 4: 新しい家族パスコードを入力させ、復元したマスターキーを新パスコード鍵で再wrap。
     Mutation recovery.redeemRecoveryAndRotatePasscode に認可セッショントークンと共に送信し、
     認可トークンを原子的消費（削除）した上で masterKeyEncrypted 等を更新
  7. 家族メンバー全員にパスコード変更通知メールを送信し、復元完了

再発行：
  - リカバリーキットは家族設定画面から任意のタイミングで再発行できる
  - 再発行時は、展開済みマスターキーを新しいリカバリーコード由来鍵で再wrapし、
    recoveryMasterKeyEncrypted 等を上書きする（過去に発行された旧コードは即座に完全失効する）
```

### 6.7 メンバーキックとExport Vaultによる個人データ持ち出しフロー（FR-FAM-09）

```txt
キック実行フロー（家族メンバー側）：
  1. 家族メンバー一覧画面で対象メンバーの「削除」ボタンを押下
  2. 確認モーダル表示：
     - 対象者の個人データ（ownerType: "user"）は本人が持ち出せること
     - 共有データ（ownerType: "family"）は家族側に残ること
     - 削除後はパスコード変更を推奨する旨
  3. Mutation families.kickMember を呼び出し：
     - 旧家族マスターキー情報を pendingExportVaults テーブルへ保存（TTL: 30日）
     - 被キックユーザーがadminsに含まれる共有レコードの管理者リストを調停（reconcileAdminsOnLeave）
     - 被キックユーザーの familyId を undefined に更新（個人所有レコードは変更せず維持）
     - 被キックユーザー宛てにキック通知メール（memberKicked）をスケジュール送信
  4. 完了モーダルでパスコード変更を推奨案内：
     「今すぐパスコードを変更する」押下により既存のパスコードローテーションフォーム（6.5）を展開・スクロール

データ持ち出し・移行フロー（被キックユーザー側）：
  1. 家族未所属かつ有効な pendingExportVault を保有している場合、専用画面を表示：
     - キックされた旨、旧家族名、データの持ち出し期限（残り日数）を表示
     - 選択肢A: 「旧家族のパスコードを入力してデータを引き継ぐ」
     - 選択肢B: 「データを持ち出さずに新しく家族を作成・参加する（データ破棄）」
  2. 選択肢A（引き継ぎ）選択時：
     - 旧家族パスコードを入力し、pendingExportVaults の暗号パラメータ・ラップ鍵をアンラップ検証
     - 成功後、アンラップされた旧マスターキーを一時保持し、家族作成または参加申請承認待ちへ進む
     - 家族作成（prepareFamilyMigration: create）または参加完了（handleCompleteTransfer）時、
       一時保持した旧マスターキーを用いて個人レコードのDEKを新家族マスターキーで再wrap
     - commitFamilyMigration 成功時に pendingExportVaults は自動削除される
  3. 選択肢B（破棄）選択時：
     - 警告確認後、Mutation families.abandonPendingExportVault でVaultを物理削除
     - 通常の家族未所属ユーザー向け画面へスムーズに復帰
  4. 定期クリーンアップ：
     - 30日経過した失効Vaultは Cron（cleanupExpiredExportVaultsInternal）により自動削除
```

## 7. API設計（Convex Functions一覧）

### 7.1 convex/users.ts

| 関数 | 種別 | 認可 | 概要 |
| -------------------- | ------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| syncUser | Mutation | identityVerified | ログイン時のユーザー情報同期（新規作成／UID引き継ぎ／プロフィール更新）。別UID引き継ぎ時は `serviceRecords.userId`、`joinRequests`、`familyMigrations` も新UIDへ付け替えて孤児化を防止する（所有権を示す `serviceRecords.accountId` は維持）。新規ログイン時はIP・位置情報等をもとにログイン通知メールをスケジュール送信 |
| updateProfile | Mutation | authenticated | 表示名の更新 |
| notifyBiometricEvent | Mutation | authenticated | 生体認証の登録・解除イベントを検知し、セキュリティ通知メールをスケジュール送信 |
| deleteAccount | Mutation | authenticated | 退会処理（所有レコード削除、家族最終メンバー時は家族も削除）。退会完了通知メールを送信 |
| getUserByFirebaseUid | InternalQuery | 内部限定 | UIDからユーザー＋所属家族情報、および紐づく全アカウント（各アカウントの所属家族情報含む）を取得（HTTP Action経由） |
| getUserById | InternalQuery | 内部限定 | Convex内部IDからユーザー＋家族情報を取得 |

### 7.2 convex/families.ts

| 関数 | 種別 | 認可 | 概要 |
| -------------------------------------- | ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| getFamilyMembers | Query | authenticated | 自分の所属家族のメンバー一覧取得 |
| createFamily | Mutation | authenticated | 家族グループ新規作成＋通知メール送信 |
| getFamilyInfoByFamilyId | Query | authenticated | 家族IDから家族の暗号鍵情報を取得（メンバー or 承認済み申請者のみ） |
| getFamilyPublicInfo | Query | authenticated | 招待コードから家族名等の公開情報のみ取得 |
| createJoinRequest | Mutation | authenticated | 参加申請の送信＋既存メンバーへの通知メール |
| cancelJoinRequest | Mutation | authenticated | 自分の保留中申請のキャンセル |
| getMyJoinRequest | Query | authenticated | 自分の申請状況取得 |
| dismissRejectedRequest | Mutation | authenticated | 却下された申請の削除（確認） |
| getPendingRequests | Query | familyBound | 自家族への保留中申請一覧 |
| approveJoinRequest / rejectJoinRequest | Mutation | familyAdmin | 申請の承認／却下＋通知メール（ファミリー管理者のみ実行可能） |
| prepareFamilyMigration | Mutation | authenticated | 家族移行の準備（PREPARED状態の作成とレコード更新スナップショットの保持） |
| getMigrationForEncryption | Query | authenticated | 移行対象データ（暗号化済みDEK等）の取得 |
| commitFamilyMigration | Mutation | authenticated | 移行の確定（再暗号化データの反映）。prepare時点とcommit時点のレコード一覧を照合する楽観的ロック（競合検知）を適用 |
| abortFamilyMigration | Mutation | authenticated | 移行の中断 |
| rotatePasscode | Mutation | familyBound | パスコードのみの変更（masterKeyEncrypted/Iv/Salt/kdfIterationsのみ更新、6.5） |
| issueRecoveryKey | Mutation | familyBound | リカバリーキーの発行／再発行（masterKeyRecoveryEncrypted等を保存、6.6） |
| recoverWithRecoveryKey | Mutation | authenticated | リカバリーキー経由でのマスターキー復元後、新パスコードでの再wrap結果を保存（6.6） |
| getRecordsForReEncryption | Query | familyBound | 再暗号化対象データ取得（家族所属前提） |
| createFamilyInvite | Mutation | familyBound | 有効期限付き招待コードの発行（TTL: 15分〜30日、デフォルト7日） |
| revokeFamilyInvite | Mutation | familyBound | 自家族の招待コードの手動失効 |
| getFamilyInvites | Query | familyBound | 自家族の招待コード一覧取得（ステータス: active/expired/revoked付き） |
| updateMemberRole | Mutation | familyAdmin | メンバーのロール（admin/viewer）の更新。ファミリー管理者のみ実行可能。家族内に最低1名のファミリー管理者が残るよう検証（最後の管理者の降格を防止） |
| kickMember | Mutation | familyAdmin | メンバーのキック（強制削除）。ファミリー管理者のみ実行可能。最後のファミリー管理者のキックは防止。Export Vaultへのマスターキー退避（TTL: 30日）、admins調停、所属解除、通知メール送信（6.7） |
| getMyPendingExportVault | Query | authenticated | 被キックユーザーの有効なExport Vault取得（期限切れ時はnull） |
| abandonPendingExportVault | Mutation | authenticated | 被キックユーザーによるExport Vaultの明示的破棄（データ持ち出し放棄） |
| cleanupExpiredMigrationsInternal | InternalMutation | 内部限定（Cron） | 期限切れ移行データの自動クリーンアップ |
| cleanupExpiredFamilyInvitesInternal | InternalMutation | 内部限定（Cron） | 30日以上前の期限切れ・失効済み招待コードの自動削除 |
| cleanupExpiredExportVaultsInternal | InternalMutation | 内部限定（Cron） | 期限切れExport Vaultの自動クリーンアップ |

### 7.3 convex/records.ts

| 関数 | 種別 | 認可 | 概要 |
| ----------------------------------------------------------------- | ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| getRecords | Query | authenticated | 一覧取得。家族所属時は by\_family\_sortKey インデックスで同一家族レコードを取得し、非所属時は by\_ownerType\_accountId で個人レコードを取得。フルテーブルスキャンを完全排除（Issue #137）。検索・タグ・所有者フィルタ・並び替え・取得上限（limit）に対応。credentials読み取りは有界並行（32件バッチ）で実行。既定でisArchived=falseのみ返す |
| getRecordsPaginated | Query | authenticated | ページネーション対応の一覧取得（Convex usePaginatedQuery準拠）。ページ内レコードに対してのみcredentialsを有界並行バッチで結合し、同時I/O上限を回避 |

| getArchivedRecords | Query | authenticated | アーカイブ済みレコードの一覧取得（FR-REC-23） |
| getRecordDetail | Query | authenticated | 詳細取得（rls.tsによるrequireContentAccess制御）。adminUsersをファミリー管理者＋admins配列から動的マージして返却。取得時にrecordAccessLogへVIEWEDを記録し、lastViewedAt/Byを更新 |
| getAvailableTags | Query | authenticated | 閲覧可能レコードから使用中タグ一覧を抽出（by\_family\_sortKey経由） |
| getOwnedRecords | Query | authenticated | 自分が管理可能な全レコード取得（個人レコード＋自分が管理者の共有レコード、CSVエクスポート用） |
| fetchRecordsForExport | Mutation | authenticated | CSVエクスポート用レコード一括取得（stableId含む。サーバー側でCSVエクスポート通知メールもスケジュール送信） |
| shareRecord | Mutation | familyBound | ワンタップで個人レコードを家族共有レコード（ownerType: "family"）に昇格。共有者が閲覧者の場合はadminsに追加、ファミリー管理者の場合は空配列（共有変更通知メール送信） |
| unshareRecord | Mutation | familyBound | ワンタップで共有レコードを個人レコード（ownerType: "user", admins: []）に戻す（管理者限定・共有変更通知メール送信） |
| addRecordAdmin / removeRecordAdmin | Mutation | recordAdmin | 共有レコードの個別管理者（一般メンバー）の追加・解除（管理者限定・管理者変更通知メール送信。ファミリー管理者の冗長追加は防止） |
| bulkSetRecordAdmin | Mutation | familyBound | 選択した共有レコード群に対して個別管理者の追加／解除を一括適用（管理者限定） |
| bulkShareRecords / bulkUnshareRecords | Mutation | familyBound | 選択した個人レコードの一括共有 / 共有レコードの一括共有解除（isRecordAdminで認可検証） |
| previewCsvImport | Query/Action | familyBound | インポート予定のCSV行と既存データ（URL＋タイトルで突合）を比較し、行ごとに新規／上書き／スキップを判定して返す（FR-CSV-07、9.7参照） |
| getRecordsForDiffImport | Query | authenticated | CSV差分インポート突合用にアクセス可能なレコード一覧を軽量取得（暗号化フィールドは除外、最小権限原則） |
| applyImportDiff | Mutation | familyBound | CSV差分プレビューで承認された新規登録・更新を一括反映（家族境界・管理者認可検証、非空フィールドのみ更新、監査ログ記録） |
| createRecord | Mutation | familyBound | レコード新規作成（zodによるサーバー再検証、sortKey自動算出、ownerType: "user" \| "family"、credentials最大10件チェック、stableId自動生成、revision: 0初期化） |
| updateRecord | Mutation | familyBound | レコード更新（requireAdminAccessチェックにより閲覧専用メンバーによる更新を防止、sortKey再算出、共有解除時は管理者権限を要求、revisionによる楽観的ロック競合検証、forceフラグによる強制上書き、完了時セッション自動削除） |
| deleteRecord / deleteRecords | Mutation | familyBound | 単体／一括削除（requireAdminAccessチェック、非管理者の共有レコード削除を防止） |
| importRecords | Mutation | familyBound | CSVインポート（全件新規作成、最大500件、家族内メールアドレスの厳格突合、行ごとのバリデーション結果を返却、stableId自動生成、revision: 0初期化） |
| bulkUpdateRecords | Mutation | familyBound | 一括タグ付与／所有設定変更（所有設定変更は確認モーダルを経由） |
| togglePin | Mutation | familyBound | isPinnedの切り替え（FR-REC-18） |
| archiveRecord / unarchiveRecord | Mutation | familyBound | isArchivedの切り替え（FR-REC-23） |
| requestUpdate | Mutation | familyBound | needsUpdate等を設定し、オーナーへ通知メールを送信（FR-REC-17） |
| resolveUpdateRequest | Mutation | familyBound | レコード編集保存時にneedsUpdateを自動解除 |
| mergeTags | Mutation | familyBound | 指定タグ名を持つ自分の閲覧可能レコード群のtags配列を一括置換（FR-REC-22） |
| getRecordAccessLog | Query | authenticated | 対象レコードのrecordAccessLogをタイムラインとして取得（rls.tsチェック、FR-REC-16） |
| startEditingSession / heartbeatEditingSession / endEditingSession | Mutation | familyBound | recordEditingSessionsの作成・更新・削除（FR-REC-15、TTL 5分、ハートビート30秒） |
| getActiveEditors | Query | authenticated | 対象レコードを編集中のユーザー一覧を取得（Convexのリアクティブクエリでクライアントが購読、TTL 5分超過分は自動除外） |
| cleanupExpiredEditingSessionsInternal | InternalMutation | internal（Cron） | 5分TTLを超過した期限切れ編集セッションの定期クリーンアップ（1分間隔cronから実行、1回最大500件のバッチ削除でトランザクション上限を回避） |
| logRecordHintView | Mutation | familyBound | パスワードヒント閲覧時の監査ログ記録。`serviceRecords.lastViewedAt` / `lastViewedByAccountId` を更新し、`auditLogs` に `HINT_VIEW` を記録する |
| getFamilyAuditLogs | Query | familyBound | 家族全体の監査ログをページネーションで取得（`by_family_createdAt` インデックス使用、降順）。actorDisplayNameをDBから最新化して返す |
| getRecordAuditLogs | Query | authenticated | 単一レコードのアクセス履歴タイムラインを取得（最大50件、`by_recordId_createdAt` インデックス使用） |
| getStaleRecords | Query | authenticated | 指定日数（デフォルト180日）以上更新されていないレコードを取得（サンプルレコード除外） |
| cleanupOldAuditLogsInternal | InternalMutation | internal（Cron） | 180日以上経過した監査ログを削除（24時間間隔cronから実行、1回100件バッチ、件数上限到達時は再帰実行） |

### 7.4 convex/actions.ts（Node runtime, "use node"）

| 関数 | 種別 | 認可 | 概要 |
| -------------------------------- | ---------------- | -------------------- | -------------------------------------- |
| getOgpInfo | Action | 要ログイン（内部でidentity検証） | 指定URLのOGP情報取得（SSRF対策済みfetch＋cheerio解析） |
| getFurigana | Action | 要ログイン | Yahoo!テキスト解析APIによるふりがな取得 |
| sendEmailReq / sendTemplatedEmailInternal | (Internal)Action | 内部限定 | Resend経由のメール送信（React EmailテンプレートのHTML化・配信）。環境変数 `DISABLE_EMAIL_DELIVERY=true` の場合は外部配信をスキップし成功扱いとする |

### 7.5 convex/http.ts

| エンドポイント | メソッド | 認証 | 概要 |
| --------------------- | ---- | ------------------------------------------------ | -------------------------------------- |
| /getUserByFirebaseUid | POST | x-internal-secret ヘッダー（CONVEX\_INTERNAL\_SECRET） | サーバーサイド (getAuthUser) からのユーザー情報取得専用API |

### 7.6 Server Functions (src/services/)

| 関数 | ファイル | メソッド | 認可・検証 | 概要 |
| ---------------------------- | --------------------- | ---- | ------------------------- | ------------------------------------------------------- |
| syncUser | auth.functions.ts | POST | Firebase IDトークン検証 | ログイン時のユーザー同期・セッションCookie発行・ログイン通知送信トリガー |
| refreshSessionCookie | auth.functions.ts | POST | Firebase IDトークン検証（失効検証含む） | セッションCookieの自動ローリング延長（DB書き込み・ログイン通知は行わない） |
| getAuthUser | auth.functions.ts | GET | セッションCookie検証 | 現在ログイン中のユーザーおよび所属家族情報取得（紐づくアカウントと各家族情報を含む） |
| getCustomTokenFromSession | auth.functions.ts | POST | セッションCookie検証 | セッションCookieからFirebaseカスタムトークンを再発行（セッション復旧用） |
| logout | auth.functions.ts | POST | セッションCookie失効 | ログアウト処理（Cookie削除＋トークン失効） |
| getClientRequestContext | security.functions.ts | GET | なし | 接続元のIPアドレス・User-Agent・GeoIP位置情報の取得 |
| fetchNewsListServer | cms.functions.ts | GET | なし | microCMSからのお知らせ一覧取得（SSR・TanStack Query） |
| fetchNewsDetailServer | cms.functions.ts | GET | なし | microCMSからのお知らせ詳細取得（SSR・TanStack Query） |

### 7.7 convex/contacts.ts

| 関数                  | 種別           | 認可       | 概要                                                                                         |
| --------------------- | -------------- | ---------- | -------------------------------------------------------------------------------------------- |
| createContact         | Mutation       | 公開       | お問い合わせ送信（Honeypot、Zod整合バリデーション、@convex-dev/rate-limiterトークンバケット、同一メール短時間連投制限、管理者メール通知予約） |
| sendNotificationEmail | InternalAction | 内部限定   | 管理者（ADMIN_EMAIL）宛てにお問い合わせ受領通知メールを配信（送信者をreplyToに設定）        |

## 8. 画面設計・ルーティング設計

### 8.1 ルートグループ構成（TanStack Router）

```txt
(public)/  … PublicLayout配下。ヘッダー・フッター共通、未ログインでも閲覧可
  index.tsx, usage.tsx, faq.tsx, login.tsx,
  terms-of-service.tsx, privacy-policy.tsx,
  news/index.tsx, news/$id.tsx, contact.tsx

(app)/     … 認証必須。Client-First AuthGuard（useAuth）により保護。未認証確定時は /login へリダイレクト、
              家族未所属時は /family 以外を /family へ強制リダイレクト。
              家族所属済みの場合のみ AppHeader を表示。
  dashboard.tsx, records/new.tsx,
  records/$id.tsx …… レコード詳細・編集。CredentialCard でパスワードヒント復号時に logRecordHintView を呼び出し監査ログ記録。RecordAuditHistoryAccordion で getRecordAuditLogs（最大30件）を購読してアクセス・変更履歴を表示。
  family.tsx …… 家族管理画面。FamilyAuditLogSection で getFamilyAuditLogs（ページネーション）を購読して家族のアクティビティログをアコーディオン表示。
  settings.tsx

__root.tsx … 全体のHTML/head/Provider階層を定義。
              beforeLoadでgetAuthUserを実行し、以降の全ルートで
              context.user としてユーザー情報を共有する。
```

### 8.2 グローバルProvider階層（__root.tsx）

```txt
ConvexProviderWithAuth(useConvexFirebaseAuth)
  └ QueryClientProvider (TanStack Query)
      └ ThemeProvider (ライト/ダーク/システム)
          └ AccountProvider (複数アカウント管理・初期アカウント/family保持)
              └ PasscodeProvider (E2EE鍵管理・パスコードダイアログ)
                  └ 各ページコンポーネント + Analytics/SpeedInsights/Toaster
```

### 8.3 UI/UXガイドライン（NFR-UX-04〜07）

- 主要操作（新規登録等）・コピーボタン等の操作要素は、タップ領域44×44px以上を確保し、
  スマートフォンでの片手操作を考慮した位置（画面下部寄り）に配置する
- フォーム入力欄・危険操作（アカウント削除等）は、WCAG基準のコントラスト比を満たす配色とする
- 「自分のみ／個人」等の表記・共有／個人を示す配色は、コンポーネント共通のトークンとして
  画面全体で統一する。エラー時は原因と次の行動が分かる案内を表示する（無機質なトースト単体に頼らない）
- モーダル（パスコード解除・確認ダイアログ等）を閉じた際は、起動直前にフォーカスしていた
  要素へ自動的にフォーカスを戻す
- タグ入力欄は、ソフトウェアキーボード表示中でもよく使うタグを選択・解除できるUI（入力欄直下に候補チップス形式で表示、選択中タグは前方ソート）とする（FR-REC-14）。上限（20個）到達時は追加操作を抑止する。
- レコード登録・編集フォームは、グローバルヘッダー（`sticky top-0 h-16`）の直下（`sticky top-16 z-10`）に各セクション（基本情報、アカウント情報、その他の設定）の見出しがスクロール位置に応じて連動固定される設計とし、入力中の視認性を担保する。
- 公開レイアウト（`PublicLayout`）は、SSR解決された認証ユーザー情報に基づき、未ログイン時はログインボタン、ログイン時は共通ユーザーアバター（`UserAvatar`）による `UserMenu`（ダッシュボード導線付き）を描画する。

### 8.4 状態管理・キャッシュ戦略（TanStack Query vs Convex）

TanStack QueryとConvexは双方がキャッシュ機構を持つため、責務の境界線を明確に分離し、二重フェッチやデータ不整合を防ぐ。

役割分担：

| 領域 | 担当技術 | 対象データ | 役割 |
| --------------- | ---------------- | ------------------------------------------------ | ----------------------------------------------- |
| 認証状態・ルート保護 | Firebase Auth（useAuth / AuthGuard） | 認証状態、Firebase User、IDトークン | 長期ログイン状態の本体（Single Source of Truth）、ルート保護 |
| 初期スナップショット・CMS | TanStack Query | SSR初期スナップショット（Cookieベース）、UI設定、CMSデータ（FAQ・規約等の静的コンテンツ） | SSR時の初期データ解決、低頻度更新の外部コンテンツのキャッシュ |
| アプリケーションデータ | Convex（useQuery） | serviceRecords、家族情報、参加申請状態など | リアルタイムデータ同期。信頼できる唯一の情報源（Single Source of Truth） |

基本原則：

1. **二重キャッシュの禁止** ：Convexが提供するアプリケーションデータは、ConvexのWebSocket経由のリアクティブ同期によって常に最新状態が保たれる。これをTanStack Queryで再度フェッチ・ラップしてキャッシュすることは、他端末での編集が即時反映されない等のデータ不整合と、不要なHTTPリクエストを招くため厳禁とする。
2. **描画品質（チラツキ防止）の担保** ：Convexのデータ取得が開始してから完了するまでの遷移期間に画面がちらつかないよう、コンポーネントは `usePersistentQuery` フックを介してメモリ上にフォールバックキャッシュ（直近取得結果、最大1,000件、NFR-PERF-02）を保持する。
3. **セッションクリーンアップ** ：ログアウト時は、TanStack Queryのキャッシュ（ `queryClient.clear()` ）と `usePersistentQuery` のインメモリキャッシュの両方を即時にクリアし、アカウント間でのデータ残存・露出を防ぐ。

### 8.5 ビジュアルデザインシステム（概要）

PoohMaのUIは、Vercelのデザインシステム（Geist）を参考にしたビジュアル仕様に基づく。詳細なトークン定義は別紙のUIデザインシステム仕様書（0章の命名注記を参照）を参照し、ここでは実装上の要点のみを示す。

- **タイポグラフィ** ：Geist Sans／Geist Mono（ `@fontsource/geist-sans`, `@fontsource/geist-mono` ）。見出しはネガティブなレタースペーシング（表示サイズで-2.4px〜-2.88px）を用いる。ウェイトは400（本文）／500（UI・操作）／600（見出し）の3段階に限定する。
- **Shadow-as-border技法** ：カード・ボタン等の境界線には、通常のCSS `border` ではなく `box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08)` （ゼロオフセット・ゼロブラーの1pxシャドウ）を用いる。
- **カラーパレット** ：基本はアクロマティック（ `#171717` 〜 `#ffffff` のグレースケール）とし、ブランドカラー（オレンジ系。LPデザイン定義書に別途規定）はCTA等の重要な操作にのみ点で使用する。
- **ボーダー半径** ：ボタン6px、カード8px、画像付きカード12px、バッジ9999px（フルピル）など、要素の種類ごとに固定のスケールを用いる。

## 9. 主要シーケンス

### 9.1 サービスレコード新規登録

```txt
1. ユーザーがURL欄入力→フォーカスアウト
   → Convex Action getOgpInfo 呼び出し → タイトル/画像/説明を自動反映
   → タイトルが確定した時点で Action getFurigana を呼び出し読み仮名を自動反映
2. パスワードヒントを含むフォームを送信
   → hasHintsToEncrypt かつ masterKey未展開の場合、requireUnlock() でパスコードダイアログ表示
   → PasscodeProvider.encryptHint() で 認証情報ごとにDEK生成→暗号化→DEKラップ
3. Mutation records.createRecord 呼び出し（zodスキーマによるサーバー側再検証）
4. 成功後、/dashboard へ遷移
```

### 9.2 CSVインポート

```txt
1. ユーザーがCSVファイルを選択 (UserMenu.tsx)
2. papaparseでパース（ヘッダー行あり）
3. 行数（500件以下）・フィールド長（10,000文字以下）の早期バリデーション
4. パスワードヒントを含む行がある場合、requireUnlock() でロック解除
5. processInChunks() により10件単位でチャンク処理：
     各行についてOGP取得・ふりがな取得（未設定時のみ）→ パスワードヒント暗号化
6. Mutation records.importRecords 呼び出し（サーバー側で行ごとにzod再検証）
7. 成功件数・行ごとの失敗理由をトースト表示
```

### 9.3 家族グループ新規作成

```txt
1. 家族名・パスコード（8文字以上、確認一致）を入力
2. クライアント側でソルト生成 → PBKDF2でパスコード導出鍵生成
   → マスターキー生成 → マスターキーをパスコード導出鍵でラップ
3. Mutation families.createFamily 呼び出し（暗号化済みマスターキー・IV・ソルトを送信）
4. サーバー側でfamiliesレコード作成、ユーザーのfamilyIdを更新、
   Action経由で完了通知メールをスケジュール送信
5. authUserクエリを再検証し、AppHeader等の表示を更新
```

### 9.4 パスコードのみのローテーション（FR-FAM-10）

```txt
1. 家族管理画面で現在のパスコードによりロック解除（未解除の場合）
2. 新パスコード・確認入力を送信
3. クライアント側で6.5の手順によりマスターキーを新しい導出鍵で再wrap
4. Mutation families.rotatePasscode 呼び出し
5. 成功後、以後のロック解除は新パスコードで行われる（既存レコードは無変更）
```

### 9.5 リカバリーキーの発行・復旧（FR-CRYPT-06）

```txt
発行：
1. 設定画面から「リカバリーキーを発行」を選択（マスターキー展開済みであること）
2. クライアント側で6.6の手順によりリカバリーキーを生成しマスターキーを別経路でラップ
3. Mutation families.issueRecoveryKey 呼び出し
4. QRコード付きPDFをその場で生成しダウンロード（キーの値はこの時点以降サーバーにも
   ブラウザにも残らない。再表示不可であることを画面上で明示する）

復旧：
1. ログイン画面／パスコード解除画面から「パスコードを忘れた場合」を選択
2. リカバリーキーを入力
3. クライアント側で6.6の手順によりマスターキーを復元
4. 新しいパスコードを設定させ、rotatePasscode 相当の処理でmasterKeyEncrypted等を更新
5. Mutation families.recoverWithRecoveryKey 呼び出し、完了後は新パスコードでログイン可能になる
```

### 9.6 同時編集の検知（FR-REC-15）

```txt
1. ユーザーAがレコード編集画面を開く → Mutation startEditingSession（recordEditingSessions にセッション登録）
2. 編集画面を開いている間、30秒間隔で Mutation heartbeatEditingSession を送信
   （別アプリ・別タブから復帰した際（visibilitychange: visible）にも即時ハートビートを送信してセッション延長）
3. ユーザーBが同じレコードの詳細または編集画面を開く → Query getActiveEditors（リアクティブ）が
   ユーザーAの編集中セッションを検知し、「Aさんが編集中です（約○分前）」を表示（Soft Advisory、編集画面ではスクロール追従する消えないトースト通知（「編集をやめる」「最新を読み込む」アクション付き）も発火）
4. ユーザーAが保存 or キャンセル or 画面離脱 → Mutation endEditingSession
   （離席やタスクキルでハートビートが途絶えた場合、TTL 5分（300秒）経過によりサーバー・クエリ側で自動失効）
5. 保存時、updateRecord はクライアントが保持する revision（初期値0）を検証し（楽観的ロック）、
   他ユーザーの先行更新によってDB側の revision が進んでいた場合は「CONFLICT: レコードが他のユーザーによって更新されました」を送出
   （通常更新時は revision 必須・一致検証。成功時に revision を +1 インクリメント）
6. 編集途中に他者が更新した瞬間、フォームのスクロール位置に関係なく消えないトースト（「最新を読み込む」アクション付き）が出現して即座に解決可能。
   保存実行時に競合が検知された場合もモーダルダイアログを表示:
   - 「最新の内容を読み込む」: 最新レコードを再読み込みし、編集画面を最新データで更新
   - 「上書き保存する」: force: true を指定して updateRecord を再実行し、強制上書き保存（revision は +1 インクリメント）
7. 保存完了時、実行者自身の recordEditingSessions はサーバー側で自動削除される
8. 放置された期限切れセッション（TTL 5分超過）は、1分間隔の定期cron（cleanupExpiredEditingSessionsInternal）によって自動削除される（1回最大500件バッチ）
```

### 9.7 CSVインポートのプレビュー（FR-CSV-07）

```txt
1. CSVファイル選択・パース後、確定ボタンを押す前に Query/Action previewCsvImport を呼び出す
2. サーバー側で、各行のURL＋タイトルを既存の自分のレコードと突合し、
   「新規／上書き／スキップ」を判定した結果を返す
3. クライアントは判定結果を一覧としてプレビュー表示し、ユーザーが行単位で
   インポート対象から除外できるようにする
4. ユーザーが確定操作を行った時点で、9.2のインポートフロー（ロック解除→暗号化→
   importRecords呼び出し）へ進む
```

## 10. SSRF対策設計（OGP取得機能, src/utils/url-safety.ts）

```txt
validateUrlSafety(url):
  1. URLスキームが http / https 以外なら拒否
  2. ホスト名が直接IPアドレス指定の場合、isPrivateIp()でプライベート/ループバック/
     リンクローカル/未指定アドレス範囲かを判定し、該当すれば拒否
  3. ドメイン名の場合、dns.resolve4 / resolve6 で名前解決し、
     解決された全アドレスに対してisPrivateIp()チェックを実施（1つでも該当すれば拒否）
  4. 安全と判定された解決済みIPアドレスを返す

fetchSafeBuffer() (convex/actions.ts):
  - 上記で得た「検証済みIPアドレス」に対して直接TCP接続し(Hostヘッダーのみ元のホスト名を付与)、
    アプリケーションレベルでのDNS Rebinding対策を行う
  - リダイレクト応答を受けた場合、リダイレクト先URLに対して再度 validateUrlSafety() を実行
    （毎回名前解決からやり直す）
  - 最大リダイレクト回数：1〜10回（デフォルト5回）、リダイレクトの循環を検出したら中断
  - レスポンスサイズ上限：5MB、リクエストタイムアウト：5秒

リソース枯渇対策の強化（NFR-SEC-11）：
  - レスポンスヘッダーの Content-Length を確認し、上限（5MB）を超える場合は
    ボディの読み込みを開始せず即座に中断する
  - Content-Length が存在しない、または実際の転送量が事前申告と異なる（chunked transfer等）
    ケースに備え、response.arrayBuffer() で一括読み込みせず、ストリームを逐次読み込みながら
    受信済みバイト数を積算し、上限（5MB）を超過した時点で接続を強制中断（AbortController）する
  - 上記のいずれかで中断した場合、OGP取得は失敗として扱い、フォームの当該項目は
    未入力のまま処理を継続する（登録自体は妨げない）
```

## 11. 入力バリデーション設計（src/utils/schemas.ts, zod）

| スキーマ | 用途 |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| AeadDataSchema | IV（16文字Base64）・暗号文（Base64、最小長22）の形式チェック共通部品 |
| CredentialInputSchema | 認証情報の文字数上限、ヒント／IV／DEKの整合性チェック（片方のみ存在はエラー） |
| RecordInputSchema | サービスレコード全体（タイトル必須255文字以内、URL形式、メモ10,000文字以内、 `credentials` 配列は `MAX_CREDENTIALS_PER_RECORD = 10` で上限を明示、 `tags` 配列は `MAX_TAGS_PER_RECORD = 20` で上限を明示） |
| CreateFamilyInputSchema | 家族名必須、マスターキー暗号化データ・ソルトの形式チェック、パスコード強度要件（最低文字数10文字・zxcvbnスコア2以上、NFR-SEC-13）はクライアント側の入力時点でも検証する |
| ChangeFamilyInputSchema | create/joinで分岐する必須項目チェック、認証情報配列の整合性チェック |
| RotatePasscodeInputSchema | 新パスコードの強度要件チェック、マスターキー再ラップデータの形式チェック（新設） |

これらのスキーマは src/utils/schemas.ts に定義され、Convex側（records.ts）でも
convex用にID型を拡張した上でそのまま再利用し、クライアント・サーバーの二重検証を実現している。

## 12. バッチ・スケジューラ設計

```txt
convex/crons.ts に登録されている定期ジョブ一覧:

1. cleanup expired family migrations（1時間間隔）
   → internal.families.cleanupExpiredMigrationsInternal
   - status=PREPARED かつ expiresAt < 現在時刻 の familyMigrations を EXPIRED に更新
   - 移行先家族(targetFamilyId)がメンバー0件・レコード0件であれば空家族グループを削除

2. cleanup expired export vaults（1時間間隔）
   → internal.families.cleanupExpiredExportVaultsInternal
   - 30日TTLを超過した pendingExportVaults を削除

3. cleanup expired family invites（24時間間隔）
   → internal.families.cleanupExpiredFamilyInvitesInternal
   - 30日以上前の期限切れ・失効済み招待コードを削除

4. cleanup expired editing sessions（1分間隔）
   → internal.records.cleanupExpiredEditingSessionsInternal
   - 5分TTLを超過した recordEditingSessions を削除（1回最大500件バッチ）

5. cleanup old audit logs（24時間間隔）
   → internal.records.cleanupOldAuditLogsInternal
   - 180日以上経過した auditLogs を削除（1回100件バッチ、上限到達時は再帰実行）
```

## 13. 外部サービス連携設計

| サービス | 用途 | 認証方式 |
| ----------------------- | ---------------------------- | -------------------------------------- |
| Firebase Authentication | Googleログイン、IDトークン発行 | クライアントSDK（Google OAuth） |
| Firebase Admin SDK | IDトークン検証、セッションCookie発行・検証 | サービスアカウント（環境変数 or JSONファイル） |
| Convex | DB・ビジネスロジック実行基盤 | Firebase IDトークンをそのまま信頼（auth.config.ts） |
| microCMS | FAQ・利用規約・プライバシーポリシーの コンテンツ管理 | APIキー（サーバーサイドのみ） |
| Resend | 通知メール送信 | APIキー |
| Yahoo!テキスト解析API | サービス名からのふりがな自動生成 | アプリケーションID |
| Cloudflare Workers / R2 | Convexデータの定期自動バックアップ（日次） | Cloudflare Secret（`CONVEX_DEPLOY_KEY`） |

## 14. CSVエクスポート・インポート仕様

### 14.1 概要・目的
ユーザーが登録したサービスレコードおよび付随するクレデンシャル（最大10件/行）を一括で手元にバックアップ（CSVエクスポート）し、必要に応じて編集した上で再度取り込むことで既存レコードの一括差分更新（UPDATE）や新規追加（CREATE）を安全に行える機能。

### 14.2 CSVフォーマット・列定義
- **ファイル形式**: UTF-8 BOM付きCSV（Excelでの文字化けを防止）。
- **列順序（位置）**: 可変（順不同）。PapaParse（`header: true`）により1行目のヘッダー名でマッピング。
- **列マッピング**:
  - `RecordId`: サービスレコードの安定ID（UUID v4、`serviceRecords.stableId`）。空欄の場合は新規作成（CREATE）扱い。
  - `Title`: サービス名（必須、最大100文字）。
  - `URL`: サービスURL（任意、最大2,048文字）。
  - `Memo`: メモ（任意、最大10,000文字）。
  - `OwnerType`: 所有種別（`"user"` または `"family"`）。
  - `Admins`: 個別管理者のメールアドレス一覧（カンマ区切り）。
  - `Tags`: タグ一覧（カンマ区切り）。
  - `CredentialId{n}`（`n` = 1〜10）: クレデンシャルの安定ID（UUID v4、`credentials.stableId`）。
  - `Label{n}`: アカウント表示ラベル（任意、最大50文字）。
  - `LoginID{n}`: ログインID / メールアドレス（任意、平文）。
  - `PasswordHint{n}`: パスワードのヒント（任意、平文入力。インポート時にE2EE暗号化）。
- **未知の列**: 定義外の列が存在しても無視（スキップ）して処理を継続。

### 14.3 差分判定・更新マトリクス
| 条件 | 判定 | 処理内容 |
| :--- | :---: | :--- |
| `RecordId` が空 または 列なし | **CREATE** | 新規レコードとして登録（`stableId` を自動生成、OGP/ふりがな取得、ヒント暗号化） |
| `RecordId` があり、DBに存在する | **UPDATE / SKIP** | 各フィールドを比較。差分があれば UPDATE、全項目一致またはCSV側が空白なら SKIP |
| `RecordId` があり、DBに存在しない | **ERROR** | エラー理由:「指定された RecordId のレコードが見つかりません」 |
| CSV内で同一の `RecordId` が重複 | **ERROR** | エラー理由:「CSV内で RecordId が重複しています」 |
| `CredentialId` が別のレコードに属している | **ERROR** | エラー理由:「CredentialId が別のレコードに紐づいています」 |
| `CredentialId` が空で Label/Login/Hint あり | **CREATE (Cred)** | 既存レコード配下に新規クレデンシャルを追加 |
| `CredentialId` があり、当該レコードに属する | **UPDATE / SKIP (Cred)** | クレデンシャル項目の差分を判定。空セルは既存値を維持 |

### 14.4 セキュリティ・E2EE・整合性保護
- **空セルによる値保護**: CSVのセルが空（未入力）の場合は**既存の値を維持（SKIP）**し、意図しないデータ消去を防止する。
- **削除の非サポート**: CSVから行やクレデンシャルを削除しても、DB上のデータは**削除しない**（削除はアプリUIから明示的に実行）。
- **E2EE整合性**:
  - CSV側の `PasswordHint` が空の場合: DB上の既存暗号化データをそのまま維持（暗号化処理・マスターキーアンロック不要）。
  - CSV側に平文の `PasswordHint` が入力されている場合: 家族パスコードマスターキーで端末内暗号化（`encryptHint`）を実行して更新ペイロードを生成。
- **認可検証**: `applyImportDiff` 内で、実行ユーザーが所属する家族境界および管理者権限（`requireAdminAccess`）をレコードごとに厳密に検証。

### 14.5 一括データ管理画面（`/settings/bulk`）とプレビューUI・Code Splitting
- **単独ページ化（`routes/(app)/settings/bulk.tsx`）**:
  - 全画面共通メニュー（`UserMenu`）から重いインポート・エクスポート処理および仮想スクロールUIを完全に切り離し、専用の一括データ管理画面 `/settings/bulk` を提供。
  - 設定一覧画面（`/settings/`）および `UserMenu` からダイレクトに遷移可能。
- **Code Splitting（バンドルサイズ最適化）**:
  - `UserMenu` から CSV 解析（`papaparse`）、仮想スクロール（`@tanstack/react-virtual`）、差分突合フック（`useImportCsvDiff`）を完全剥離。
  - `UserMenu` のチャンクサイズを **92.30 kB → 37.52 kB（約60%削減）** し、ダッシュボードや詳細画面など全画面の初期ロードを大幅に軽量化。
  - `/settings/bulk` 内でも `CsvImportPreviewTable` を `React.lazy` で遅延ロードし、ファイル選択前の初期描画コストを最小限に抑制。
- **変更プレビューテーブル（`CsvImportPreviewTable.tsx`）**:
  - 反映前に新規追加（緑）・更新（青）・スキップ（灰）・エラー（赤）の各行の内訳と Before / After の詳細差分を確認可能。
  - **行単位の選択**: 各行にチェックボックスを用意し、ユーザーが個別に「反映する / しない」を選択可能。
  - **エラー行スキップトグル**: エラー行が存在する場合でも、トグルONで正常な選択行のみを一括反映可能。
  - **ヘッダーとボディの横スクロール完全一致**: 単一のスクロールコンテナ（`parentRef`）直下に `min-w-[850px]` のラッパーを配置し、その中に `sticky top-0 z-10` のヘッダーと仮想アイテム行コンテナ（`translateY`）を同居させる設計を採用。JavaScriptによるスクロール連動ラグを生じさせず、ブラウザ標準のスクロール機構で横スクロール位置および列幅の完全一致と縦スクロール時のヘッダー固定をノーコストで両立。
- **仮想スクロール（@tanstack/react-virtual）**:
  - 最大500行のデータでも 60fps を維持するため、行高自動計測（`measureElement`）、DOM完全メモ化（`React.memo`）、`getItemKey`、オーバースキャン（8行）を適用。
- **UIブロック防止（ADR-007）**:
  - Web Worker は導入せず、10件単位でマクロタスク yield を行う `processInChunks` と Web Crypto API の非同期性を活用してスムーズな処理とプログレスバー・トースト表示を実現。
- **インポート完了サマリー画面**:
  - 反映完了後はステップが遷移し、新規登録件数・更新件数のサマリーバッジ、ダッシュボードへの遷移ボタン、再インポートボタンを表示。
- **ヘルプ・サンプル機能（`csvHelpDialog.tsx`）**:
  - CSVインポートゾーン横に「？」アイコンを配置。クリックで仕様説明モーダルが開き、フル列サンプルCSVをダウンロード可能。

## 15. 環境変数一覧

### クライアント（src/env/client.ts, VITE_プレフィックス）

| 変数名 | 必須 | 説明 |
| ------------------------------- | -- | -------------------- |
| VITE_APP_TITLE | 任意 | アプリタイトル |
| VITE_FIREBASE_API_KEY | 必須 | Firebase APIキー |
| VITE_FIREBASE_AUTH_DOMAIN | 必須 | Firebase Authドメイン |
| VITE_FIREBASE_PROJECT_ID | 必須 | FirebaseプロジェクトID |
| VITE_FIREBASE_STORAGE_BUCKET | 必須 | Firebase Storageバケット |
| VITE_CONVEX_URL | 必須 | ConvexデプロイURL |

### サーバー（src/env/server.ts）

| 変数名 | 必須 | 説明 |
| --------------------------------- | -- | ------------------------------------------------- |
| SERVER_URL | 任意 | サーバーURL |
| MICROCMS_SERVICE_DOMAIN | 必須 | microCMSサービスドメイン |
| MICROCMS_API_KEY | 必須 | microCMS APIキー |
| CONVEX_INTERNAL_SECRET | 必須 | Convex HTTP Action（内部API）保護用シークレット |
| ABSTRACT_IP_GEOLOCATION_API_KEY | 必須 | Abstract API GeoIP（ログイン・監査メール位置情報取得用） |

### その他（Convex実行環境）

| 変数名 | 説明 |
| ------------------------------------------------------------ | ---------------------------------------------- |
| FIREBASE_SERVICE_ACCOUNT / FIREBASE_ADMINSDK_CREDENTIALS | Firebase Admin初期化用サービスアカウント（JSON文字列 or ファイルパス） |
| RESEND_API_KEY / RESEND_MAIL_FROM | メール送信設定 |
| DISABLE_EMAIL_DELIVERY | （任意）外部メール配送スキップフラグ。`true` の場合、E2Eテスト時等にResendへの外部配信を行わず成功扱いとする |
| YAHOO_CLIENT_ID | ふりがな取得API用アプリケーションID |

### バックアップ環境（Cloudflare Workers Secret: workers/backup）

| 変数名 | 説明 |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | Convex Deploy Key（`prod:...` 形式）。Cloudflare Secrets で暗号化保存（`wrangler secret put CONVEX_DEPLOY_KEY`）。 |

## 16. デプロイ構成

- **フロントエンド** ：Vercelにデプロイ。vercel.json にて `/__/auth/*` へのアクセスをFirebase Hosting（poohma.firebaseapp.com）へリライトし、Firebase Authのポップアップ/リダイレクト処理を委譲している。
- **セキュリティヘッダー（NFR-SEC-12）** ：vercel.json の `headers` ブロックで全パスに対し以下を設定する。
  - `Content-Security-Policy` ： `default-src 'self'` を基本とし、 `connect-src` にConvexデプロイURL・Firebase・microCMS・Resend等の許可ドメインのみを列挙、 `script-src 'self'` （インラインスクリプトが必要な箇所はnonceを付与）、 `frame-ancestors 'none'`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Content-Type-Options: nosniff`
    導入時は、Firebase Authのリダイレクト（ `/__/auth/*` ）やmicroCMS/Resendへの通信がブロックされないよう、許可ドメインリストを実装済みの外部連携先（13章）と突き合わせてから有効化する。
- **開発環境** ：vite.config.ts にてFirebase Auth関連パスのプロキシ設定、および自己署名証明書（@vitejs/plugin-basic-ssl）によるローカルHTTPS対応（WebAuthn等はHTTPS必須のため）。
- **バックエンド** ：Convex Cloudにデプロイ（ `pnpm dev:convex` / Convexデプロイパイプライン）。
- **定期自動バックアップ（NFR-AVAIL-05）** ：Cloudflare Workers（Cron Trigger: 毎日 UTC 18:00 / JST 03:00）により Convex Export API から ZIP データをストリーム取得し、Cloudflare R2（`poohma-backups` バケット）へ直接保存する。
  - **セキュリティ**：HTTP口（`fetch` ハンドラー）を排して Cron 実行専用とし、不要な外部エンドポイントを公開しない。Deploy Key は Cloudflare Secret として暗号化管理する。
  - **ライフサイクル**：R2 バケット側で 90 日経過したバックアップオブジェクトを自動削除するライフサイクルルールを設定し、保管容量を最適化する。
- **SSR注意事項** ： `ssr.external: ["papaparse"]` の設定により、papaparseはSSRバンドルから除外しクライアント専用として扱う。

## 17. テスト・品質管理

- **単体・結合テスト** ：Vitest ＋ @testing-library/react（UIコンポーネント）、convex-test（Convex関数のテスト）。
- **ブラウザテスト** ：@vitest/browser-playwright によるブラウザ実行モードのテスト。
- **コンポーネントカタログ** ：Storybook（a11yアドオン、テーマ切替アドオン等を含む）。
- **静的解析／フォーマット** ：Biome（ `check` / `check:ci` スクリプト）。
- **型チェック** ： `tsc --noEmit` 。

## 18. 今後の課題（技術的観点）

- 家族移行のPREPARED状態が複数端末から同時実行された場合の競合制御（同一ユーザーの既存PREPAREDを都度EXPIRED化する方式に加え、`commitFamilyMigration` での楽観的ロック検証がIssue #190で対応済み。Web Worker + IndexedDB による耐障害性向上はIssue #111として計画中）。
- オフラインキャッシュ（1.1）は読み取り専用として設計しているため、オフライン中の書き込み操作（新規登録・編集等）に対応する場合は、書き込みキューイングと競合解決（9.6の楽観的ロックとの整合）の設計が別途必要になる。
- 複数家族（マルチ・ワークスペース）対応：要件定義書10章の検討課題のとおり、現行は1ユーザー1家族グループ（users.familyIdが単一値）を前提としたスキーマ・認可設計（5.3のfamilyBoundQuery/Mutation等）となっている。対応する場合はusersテーブルの家族所属を配列化し、家族切替時にどのfamilyIdをコンテキストとして扱うか（アクティブ家族の概念）を含めた設計見直しが必要。
