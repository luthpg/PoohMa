# PoohMa Architecture

## 1. Monorepo & Workspace Structure

本プロジェクトは **pnpm workspace + Turborepo** によるモノレポ構成。

```text
poohma/
├── apps/
│   └── web/               # @poohma/web (TanStack Start + Convex)
│       ├── convex/        # Convex バックエンド (schema, functions, RLS, customBuilders)
│       ├── src/           # フロントエンドおよび Server Functions
│       └── tests/         # テスト群 (Vitest / convex-test)
├── workers/
│   └── backup/            # @poohma/backup (Cloudflare Workers + R2 定期自動バックアップ)
├── .docs/                 # 人間向けの正規仕様・設計書
├── .ai/                   # AI Agent向けの実践知識ベース
├── GEMINI.md              # 実行環境ルール・QA・Git・.ai/利用規約
├── biome.json             # 統一 Lint / Format 設定
├── turbo.json             # Turborepo パイプライン設定
└── package.json           # ルートスクリプト
```

### Workspaceの責務

| Workspace | 責務 | 主要技術 |
| --- | --- | --- |
| `apps/web` | メインWebアプリケーション（フロントエンド、SSR、Server Functions、Convex BaaSバックエンド） | React 19, TanStack Start, TanStack Router, Convex, Tailwind CSS v4, shadcn/ui, Web Crypto API |
| `workers/backup` | Convex Cloud からの定期データエクスポートおよび Cloudflare R2 へのアーカイブ保存 | Cloudflare Workers, Cloudflare R2, Wrangler, Fetch |

---

## 2. Frontend / Backend 構造

### Frontend (`apps/web/src`)

- **Routing**: TanStack Router によるファイルベースルーティング
  - `routes/(app)/`: 認証必須ルート（`dashboard.tsx`, `family.tsx`, `records/`, `settings/index.tsx`, `settings/bulk.tsx`, `recovery.tsx`）
  - `routes/(public)/`: 未認証公開ルート（`index.tsx` (LP), `login.tsx`, `usage.tsx`, `faq.tsx`, `news/index.tsx`, `news/$id.tsx`, `contact.tsx`, `terms-of-service.tsx`, `privacy-policy.tsx`）
  - `routes/__root.tsx`: ルート共通レイアウト、認証コンテキスト（`beforeLoad` で `getAuthUser` 実行）、各種 Provider
- **Components & Code Splitting**:
  - `components/UserMenu.tsx`: 全画面共通のヘッダー・メニュー。初期バンドル軽量化のためCSVや仮想スクロールの重い依存を排除（92kB → 37kB）。
  - `components/bulk/`: 一括データ管理専用コンポーネント群（`CsvImportDropZone.tsx`, `CsvExportSection.tsx`, `CsvImportPreviewTable.tsx`）および `components/csvHelpDialog.tsx`。プレビューテーブルは `React.lazy` で遅延ロード。
- **State & Context**:
  - `AuthProvider`: Firebase Auth 状態管理
  - `AccountProvider`: 1 Firebase UID : N PoohMa Account のアクティブアカウント管理・切り替え
  - `PasscodeProvider`: E2EEマスターキーのインメモリ保持、ロック状態管理、誤入力バックオフ
- **Services (Server Functions)**:
  - `auth.functions.ts`: `syncUser`, `refreshSessionCookie`, `getAuthUser`, `logout`, `getCustomTokenFromSession`（Firebase Admin SDK とセッション Cookie 制御）
  - `firebase-admin.server.ts`: Firebase Admin 初期化・トークン検証
  - `cms.functions.ts` / `cms.server.ts`: microCMS 連携（FAQ/利用規約/お知らせ）
    - `fetchNewsListServer`, `fetchNewsDetailServer`: `info` エンドポイント（`NewsContent` 型）でお知らせ一覧・詳細取得
  - `cms.queries.ts`: TanStack Query の `queryOptions` ラッパー（`cmsQueries.newsList()`, `cmsQueries.newsDetail(id)` 等）
- **Lib & Utils**:
  - `crypto.ts`: Web Crypto API による E2EE（AES-GCM, PBKDF2, DEK/MasterKey ラップ/アンラップ）
  - `biometric.ts`: WebAuthn PRF 拡張による生体認証連携
  - `recovery-kit.ts`: リカバリーキット発行・PDF 生成・2段階復元

### Backend (`apps/web/convex`)

- `schema.ts`: データベーススキーマおよびインデックス定義
- `customBuilders.ts`: 認可レベル別 Convex クエリ/ミューテーションビルダー（`identityVerified*`, `authenticated*`, `familyBound*`, `familyAdmin*`, `recordAdmin*`, `resolveAccount`）
- `rls.ts`: レコード単位のアクセス制御関数（`requireContentAccess`, `requireAdminAccess`, `getEffectiveFamilyRole`, `isRecordAdmin`, レガシー互換ヘルパー）
- `convex.config.ts`: Convex Components 設定（`@convex-dev/rate-limiter` の登録）
- `auditLogs.ts`: 監査ログ書き込みヘルパー（`logAuditEvent` 関数）。Mutation 内から呼び出し専用の内部ユーティリティ。`records.ts` が参照する
- `records.ts`: サービスレコード CRUD、検索、タグ、一括操作（共有/解除/個別管理者一括設定 `bulkSetRecordAdmin`）、同時編集セッション管理（`recordEditingSessions`、1分cron上限500件バッチ自動削除）、`updateRecord` revision方式楽観的ロック競合防止（FR-REC-15）、**監査ログ記録**（RECORD_CREATE/UPDATE/DELETE/HINT_VIEW/SHARE_SETTING_CHANGED/ADMIN_CHANGED → `auditLogs` テーブル）、`getFamilyAuditLogs`/`getRecordAuditLogs`/`getStaleRecords`、ページネーション対応クエリ（`getRecordsPaginated`）、監査ログ自動クリーンアップ（180日cron）
- `families.ts`: 家族グループ、家族招待（`familyInvites`）、参加申請（`joinRequests`）、家族移行（`familyMigrations`）、パスコードローテーション、メンバーロール変更（`updateMemberRole`）、メンバーキック・データ持ち出し（`pendingExportVaults`）
- `users.ts`: ユーザー同期、アカウント作成・切り替え・削除、ログイン履歴記録、SSR用ユーザー/アカウント（family暗号化メタデータ含む）取得
- `contacts.ts`: お問い合わせ受付（`createContact` mutation）、Honeypot スパム防御、多層レート制限（①Convex公式 `@convex-dev/rate-limiter` トークンバケット ＋ ②同一メール短時間連投制限 `by_email_createdAt`）、管理者メール通知（`sendNotificationEmail` internalAction、`ADMIN_EMAIL` 宛て Resend 送信、replyTo: 問い合わせ者メール）
- `recovery.ts`: リカバリーキット検証、2段階復元（メールOTP発行・検証、マスターキー再ラップ）
- `actions.ts`: Node.js ランタイムでの外部連携（OGP取得、ふりがなAPI、Resend メール送信。環境変数 `DISABLE_EMAIL_DELIVERY=true` での外部配送スキップ対応）
- `http.ts`: 内部 HTTP エンドポイント（`getUserByFirebaseUid`、内部共有シークレット認証）
- `crons.ts`: 定期バッチジョブ（期限切れ編集セッション・移行データ・期限切れ Export Vault・家族招待・**古い監査ログ**のクリーンアップ）


---

## 3. 認証・認可アーキテクチャ

### 認証要素の責務分離（4層モデル）

| 認証要素 | 役割 | 保持期間 | 責務と位置付け |
| --- | --- | --- | --- |
| **Firebase Auth** | 長期ログイン状態の本体 | 数ヶ月単位（無期限） | **Single Source of Truth**。IndexedDB + LocalStorage 永続化によりブラウザ側で長期間維持。 |
| **Firebase ID Token** | Convex バックエンドへの通信認証 | 1時間（SDK自動更新） | Convex への WebSocket/HTTP 通信時に付与され、Convex 側 OIDC 検証で直接認証。 |
| **session Cookie** | SSR初期表示・Server Function用キャッシュ | 14日間（自動ローリング延長） | サーバー側補助セッション。Cookie の期限切れのみでログアウト扱いにしてはならない。 |
| **Custom Token** | Client Auth 消失時のリカバリ | 一時発行（1回限り） | ブラウザストレージの揮発時に session Cookie から Client Auth を復旧するための非常用経路。 |

### 認証フロー

```mermaid
flowchart TD
    classDef clientNode fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#ffffff;
    classDef serverNode fill:#334155,stroke:#1e293b,stroke-width:2px,color:#f8fafc;
    classDef convexNode fill:#d97706,stroke:#b45309,stroke-width:2px,color:#ffffff;
    classDef authNode fill:#7c3aed,stroke:#6d28d9,stroke-width:2px,color:#ffffff;

    Browser["💻 <b>ブラウザ (Client)</b><br/>Firebase Auth (LOCAL persistence)"]:::clientNode
    FirebaseAuth["🔑 <b>Google OAuth / Firebase Auth</b>"]:::authNode
    ServerFn["⚙️ <b>Server Function: syncUser</b><br/>(TanStack Start / Node)"]:::serverNode
    Convex["🔥 <b>Convex Cloud</b>"]:::convexNode

    Browser -->|"1. Google ログイン (signInWithRedirect)"| FirebaseAuth
    FirebaseAuth -->|"2. IDトークン取得 & LOCAL永続化"| Browser
    Browser -->|"3. syncUser へ IDトークン送信"| ServerFn
    ServerFn -->|"4. IDトークン検証 (Firebase Admin SDK)"| ServerFn
    ServerFn -->|"5. users.syncUser 実行"| Convex
    ServerFn -->|"6. session Cookie (14日間) 発行"| Browser
    Browser -->|"7. ConvexProviderWithAuth 経由で IDトークン送信"| Convex
    Convex -->|"8. auth.config.ts に基づき IDトークンを直接検証"| Convex
    Browser -.->|"9. トークン更新時に session Cookie を自動ローリング延長"| ServerFn
```

### 認可階層（Convex customBuilders）

1. `identityVerifiedQuery / Mutation`: Firebase Identity の存在のみを検証（新規ユーザー登録等）
2. `authenticatedQuery / Mutation`: Identity 検証 + `resolveAccount` によるアカウント所有権チェック（IDOR 防止）
3. `familyBoundQuery / Mutation`: 上記 + 対象アカウントが家族グループ（`familyId`）に所属していることを強制

---

## 4. E2EE（暗号化）アーキテクチャ

### 鍵階層（エンベロープ暗号化）

```mermaid
flowchart TD
    classDef inputNode fill:#4338ca,stroke:#3730a3,stroke-width:2px,color:#ffffff;
    classDef derivedNode fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#ffffff;
    classDef masterNode fill:#d97706,stroke:#b45309,stroke-width:2px,color:#ffffff;
    classDef dekNode fill:#059669,stroke:#047857,stroke-width:2px,color:#ffffff;
    classDef hintNode fill:#e11d48,stroke:#be123c,stroke-width:2px,color:#ffffff;

    Passcode["🔑 <b>家族パスコード</b><br/>(ユーザー記憶 / サーバー非保存)"]:::inputNode
    PasscodeKey["🛡️ <b>パスコード導出鍵</b><br/>(AES-GCM 256)"]:::derivedNode
    MasterKey["🏛️ <b>マスターキー</b><br/>(家族共通, AES-GCM 256)"]:::masterNode
    DEK["📄 <b>DEK (Data Encryption Key)</b><br/>(認証情報1件ごと, AES-GCM 256)<br/>credentials.passwordHintDekEncrypted<br/>credentials.passwordHintDekIv"]:::dekNode
    EncryptedHint["🔒 <b>暗号化パスワードヒント</b><br/>credentials.passwordHint<br/>credentials.passwordHintIv"]:::hintNode

    Passcode -->|"PBKDF2 (SHA-256, families.kdfIterations, families.masterKeySalt)"| PasscodeKey
    PasscodeKey -->|"unwrapKey (families.masterKeyEncrypted)"| MasterKey
    MasterKey -->|"wrapKey / unwrapKey"| DEK
    DEK -->|"encrypt / decrypt"| EncryptedHint
```

### 生体認証（WebAuthn PRF拡張）の正確な位置づけ

> [!IMPORTANT]
> **WebAuthn PRF 拡張は「家族パスコードのローカル保管（平文パスコードの暗号化保存）」にのみ使用される。**
> 認証処理やマスターキーの導出・バイパスには直接関与しない。
> PRF 出力鍵でローカルに暗号化保存された家族パスコードを復号し、得られたパスコードを通常の `unlock(passcode)` フロー（PBKDF2 鍵導出以降）に入力してマスターキーを展開する。

---

## 5. 主要な Source of Truth

| 領域 | Source of Truth |
| --- | --- |
| DB スキーマ・インデックス | `apps/web/convex/schema.ts` |
| Convex 認証・認可基盤 | `apps/web/convex/customBuilders.ts` |
| レコード単位アクセス制御 (RLS) | `apps/web/convex/rls.ts` |
| E2EE 暗号化・鍵導出アルゴリズム | `apps/web/src/lib/crypto.ts` |
| 脅威モデル・セキュリティ境界 | `.docs/security/threat-model.md` |
| 人間向け正規仕様・詳細設計 | `.docs/requirements.md`, `.docs/code-design.md` |

---

## 6. 変更時に関連確認が必要な領域

- **DB スキーマ変更時**:
  - `apps/web/convex/schema.ts` 変更後、必ず `pnpm convex:sync`（または `pnpm convex:codegen`）を実行して `_generated/` を最新化した後、 `pnpm check` でフォーマット
  - 影響を受ける Convex 関数（`records.ts`, `families.ts`, `users.ts` 等）およびフロントエンドの型参照
  - `.docs/code-design.md` の DB スキーマ表の更新要否
- **所有権・アクセス制御変更時**:
  - `apps/web/convex/rls.ts`, `apps/web/convex/customBuilders.ts`, `apps/web/convex/records.ts`
  - `.docs/security/threat-model.md` の脅威シナリオ（T6, T8）との整合性確認
- **E2EE / 暗号パラメータ変更時**:
  - `apps/web/src/lib/crypto.ts`（`KDF_VERSIONS` への追記、既存パラメータの不変性維持）
  - リカバリーキット（`recovery-kit.ts`, `recovery.ts`）への波及確認
- **認証・セッション変更時**:
  - `apps/web/src/services/auth.functions.ts`, `firebase-admin.server.ts`, `useConvexFirebaseAuth.ts`, `AccountProvider.tsx`
