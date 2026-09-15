# PoohMa Domain Models & Status Transitions

PoohMa における主要ドメインエンティティの関係性、ライフサイクル、状態遷移ルールを整理する。

---

## 1. エンティティ相関図 (Entity Relationships)

```mermaid
flowchart TD
    FirebaseUser["Firebase User (userId)"] -->|"1:N"| PoohMaAccount["PoohMa Account (users._id)"]
    PoohMaAccount -->|"N:1 (familyId)"| Family["Family (families._id)"]
    
    PoohMaAccount -->|"1:N owner"| RecUser["serviceRecords (ownerType: user)"]
    PoohMaAccount -.->|"1:N admin"| RecFamily["serviceRecords (ownerType: family)"]
    PoohMaAccount -->|"1:N editor"| EditSession["recordEditingSessions (TTL 5m)"]
    
    RecUser -->|"1:N"| CredsUser["credentials (by_recordId)"]
    RecFamily -->|"1:N"| CredsFamily["credentials (by_recordId)"]
    RecUser -->|"1:N"| EditSession
    RecFamily -->|"1:N"| EditSession
    
    Family -->|"1:N scope"| RecFamily
    Family -->|"1:N"| Invites["familyInvites"]
    Family -->|"1:N"| JoinReqs["joinRequests"]
    Family -->|"1:N"| AuditLog["auditLogs (by_family_createdAt, TTL 180d)"]
    PoohMaAccount -.->|"actor"| AuditLog
    RecUser -.->|"optional ref"| AuditLog
    RecFamily -.->|"optional ref"| AuditLog
```

---

## 2. 状態遷移とライフサイクル (State Transitions)

### 2.1 家族招待 (`familyInvites`) と参加申請 (`joinRequests`) のライフサイクル

```mermaid
flowchart TD
    Issue["既存家族メンバーが招待コード発行<br/>(familyInvites: UUID, TTL)"]
    Issue -->|"期限切れ / 手動失効 (revokedAt)"| Invalid["無効化 (申請不可)"]
    Issue -->|"有効な招待コードを共有"| Apply["申請者が参加申請を作成<br/>(joinRequests: pending)"]
    
    Apply --> Pending["pending"]
    Pending -->|"家族管理者が承認 (approveJoinRequest)"| Approved["approved<br/>(user.familyId 更新)"]
    Pending -->|"家族管理者が拒否 / 申請者が取り下げ"| Rejected["rejected<br/>(アクセス権なし)"]
    
    Approved --> Unlock["家族パスコード入力でマスターキー解除"]
```

- **招待コード発行**: 既存家族メンバーが有効期限（15分〜30日）を指定して発行（`createInviteCode`）。いつでも手動失効（`revokeInviteCode`）可能。
- **参加申請トリガー**: 申請者が有効な招待コード（リンク/QR）を入力して申請を作成（`createJoinRequestWithInvite`）。
- **承認時**: 家族の管理者（`familyAdminMutation`）が承認（`approveJoinRequest`）すると、対象アカウントの `user.familyId` が更新され、申請者に通知。
- **拒否・取り下げ時**: 家族の管理者による拒否（`rejectJoinRequest`）または申請者自身によるキャンセル（`cancelJoinRequest`）により `rejected` となり、家族へのアクセス権は付与されない。
- **参加完了後**: 申請者は家族パスコードを入力してマスターキーをロック解除し、家族内での利用を開始する。

---

### 2.2 家族移行トランザクション (`familyMigrations`)

```mermaid
flowchart TD
    Start["ユーザーが移行を開始 (prepareFamilyMigration)"] --> Prepared["PREPARED<br/>(移行対象レコードのスナップショット保持)"]
    Prepared -->|"30分タイムアウト / クリーンアップ"| Expired["EXPIRED"]
    Prepared -->|"手動中断 (abortFamilyMigration)"| Aborted["ABORTED"]
    Prepared -->|"クライアント側でDEK再ラップ完了<br/>(commitFamilyMigration)"| Completed["COMPLETED<br/>(所属家族・全レコードのfamilyId一括更新)"]
```

- **ステータス**:
  - `PREPARED`: 移行準備完了。移行対象のレコード一覧とスナップショットを保持。
  - `COMPLETED`: 再暗号化データの保存と `familyId` の付け替えが正常完了。
  - `EXPIRED`: 30 分以内に完了せず失効（Crons による定期クリーンアップ対象）。
  - `ABORTED`: ユーザーによる手動中断。

---

### 2.3 リカバリー 2 段階復元 (`recoveryOtps` / `recoverySessions`)

```mermaid
flowchart TD
    Req["1. 復元要求 (sendRecoveryOtp)"] --> OtpIssued["recoveryOtps 発行<br/>(有効期限10分, 最大5回試行)"]
    OtpIssued --> Verify["2. メールOTP (6桁) + リカバリーコード照合<br/>(verifyRecoveryOtpAndGetRecoveryData)"]
    
    Verify -->|"試行失敗 (< 5回)"| Retry["attempts 加算"] --> Verify
    Verify -->|"試行失敗 (>= 5回)"| Fail["recoveryOtps 削除 (失効・やり直し)"]
    
    Verify -->|"照合成功"| SessionIssued["3. OTP即時削除 + recoverySessions 発行<br/>(短命な認可セッショントークン, 有効期限10分)"]
    SessionIssued --> Rotate["4. 新パスコードでマスターキー再ラップ<br/>(redeemRecoveryAndRotatePasscode)"]
    Rotate --> Consumed["5. recoverySessions 即時消費 (削除)<br/>+ 家族メンバーへ通知"]
```

---

### 2.4 メンバーキックと Export Vault (`pendingExportVaults`) のライフサイクル

```mermaid
flowchart TD
    Kick["既存メンバーがメンバー除名実行 (kickMember)"] --> VaultCreated["pendingExportVaults 作成<br/>(旧MasterKey暗号文, TTL 30日)"]
    Kick --> FamilyCleared["被除名者の familyId を未設定（undefined）にクリア<br/>+ 共有レコード管理者調停 (reconcileAdminsOnLeave)<br/>+ 通知メール送信"]
    
    VaultCreated -->|"被除名者が旧パスコード入力<br/>(クライアントで旧MasterKeyアンラップ)"| Unlocked["移行準備完了<br/>(vaultUnlockedKey 保持)"]
    Unlocked -->|"新家族作成 / 参加時<br/>(commitFamilyMigration)"| Migrated["個人レコード (ownerType: user) のみDEK再ラップ<br/>+ pendingExportVaults 物理削除"]
    
    VaultCreated -->|"被除名者がデータ破棄を選択<br/>(abandonPendingExportVault)"| Abandoned["pendingExportVaults 物理削除<br/>(個人データは新家族へ持ち出さず破棄)"]
    VaultCreated -->|"30日タイムアウト / クローンジョブ<br/>(cleanupExpiredExportVaultsInternal)"| ExpiredVault["EXPIRED (物理削除)"]
```

- **キック実行**: ファミリー管理者が他メンバーを除名（`kickMember`、`familyAdminMutation`）。自己キック、別アカウントの指定、および家族内最後の管理者のキックは拒否。
- **データ分離**: 共有レコード（`ownerType: "family"`）は旧家族資産として残り、被キックユーザーの `familyId` を即時クリア。管理者であった場合は `reconcileAdminsOnLeave` で残存メンバーへ調停。
- **Export Vault 退避**: 個人レコード（`ownerType: "user"`）の持ち出しを可能にするため、旧家族の `masterKeyEncrypted`, `masterKeyIv`, `masterKeySalt`, `kdfIterations`, `cryptoVersion` を `pendingExportVaults` へ原子的に退避。
- **持ち出し完了または破棄**: 被キックユーザーが旧パスコードでアンラップして新家族へ持ち出し完了（`commitFamilyMigration`）するか、手動破棄（`abandonPendingExportVault`）、または 30日経過による自動クリーンアップ（1時間ごとの Cron）によって Vault は物理削除される。

---

### 2.5 レコード同時編集セッションと排他制御 (`recordEditingSessions` / FR-REC-15)

```mermaid
flowchart TD
    Open["編集画面を開く (startEditingSession)"] --> Active["ACTIVE<br/>(ハートビート送信: 30秒間隔)"]
    Active -->|"ハートビート更新 (heartbeatEditingSession)<br/>/ タブ復帰 (visibilitychange: visible)"| Active
    
    Active -->|"正常保存 (updateRecord 成功: revision + 1)"| Cleaned["セッション自動削除 (保存完了)"]
    Active -->|"キャンセル / 画面離脱 (endEditingSession)"| CleanedManual["セッション手動削除"]
    Active -->|"離席・タスクキル (ハートビート途絶 5分超過)"| ExpiredSession["自然失効<br/>(クエリ getActiveEditors から除外)"]
    ExpiredSession -->|"1分間隔 cron (cleanupExpiredEditingSessionsInternal)"| Purged["DB物理削除 (定期クリーンアップ)"]
    
    Active -.->|"保存時: 他者の先行更新検知<br/>(record.revision !== 手元のrevision)"| Conflict["CONFLICT エラー<br/>(競合解決ダイアログ表示)"]
    Conflict -->|"最新の内容を読み込む"| Reload["最新化 & 編集終了"]
    Conflict -->|"上書き保存する (force: true)"| ForceSave["強制保存実行 & セッション削除"]
```

- **プレゼンス（Soft Advisory）**: 編集セッションは他者の編集を一切ブロックせず、注意喚起のみを行う。誰かが開きっぱなしで放置しても家族が編集不能になるデッドロックを防止。放置された期限切れセッションは1分cronで物理削除される。
- **データ保全（Hard Invariant）**: 最終防衛線として `revision`（単調増加整数）の楽観的ロック検証により、無警告の先行データ上書きを確実に遮断。

---

### 2.6 家族ロール（`familyRole`）のライフサイクル

```mermaid
flowchart TD
    CreateFam["家族グループ新規作成 (createFamily)"] --> AdminRole["作成者: familyRole = 'admin'<br/>(ファミリー管理者)"]
    JoinFam["家族参加申請承認 (approveJoinRequest)"] --> ViewerRole["新規参加者: familyRole = 'viewer'<br/>(メンバー)"]
    
    AdminRole -->|"updateMemberRole (降格)"| ViewerRole
    ViewerRole -->|"updateMemberRole (昇格)"| AdminRole
    
    AdminRole -.->|"最後の1人の管理者を降格しようとした場合"| BlockDemote["BLOCK (最低1名の管理者を保持)"]
    AdminRole -.->|"最後の1人の管理者をキックしようとした場合"| BlockKick["BLOCK (最後の管理者のキック不可)"]
```

- **初期付与**: 家族を新規作成したアカウントは `"admin"`、招待承認で新規参加したアカウントは安全のため `"viewer"` となる。バックフィル完了に伴い `users.familyRole` は必須フィールド。
- **権限昇格・降格**: ファミリー管理者のみが他メンバーのロールを変更できる（`updateMemberRole`、`familyAdminMutation`）。
- **最後の管理者保護**: 家族内に最低1名のファミリー管理者（`admin`）が存在することを必須とし、最後の管理者の降格およびキックはサーバー側で厳格に拒否する。

---

## 3. レコード所有権モデルとアクセス権マトリクス

管理者判定（`isRecordAdmin`）は、**ファミリー管理者（`familyRole === "admin"`）** または **対象レコードの `admins` 配列に含まれる個別管理者** のいずれかを満たす場合に成立する（動的マージ ACL）。

| 操作 | 個人レコード (`ownerType: "user"`) | 共有レコード (`ownerType: "family"`) |
| --- | --- | --- |
| **閲覧・復号** | 所有アカウント (`accountId === user._id`) のみ | 同一 Family に所属する全メンバー（`viewer` 含む） |
| **編集 (タイトル/メモ/タグ等)** | 所有アカウントのみ | レコード管理者（ファミリー管理者または個別管理者）のみ |
| **ヒント更新 (DEK再暗号化)** | 所有アカウントのみ | レコード管理者（ファミリー管理者または個別管理者）のみ |
| **共有解除 (個人へ戻す)** | 対象外 | レコード管理者のみ |
| **管理者変更 (admins追加/解除)** | 対象外 | レコード管理者のみ（ファミリー管理者は全レコード管理権限を持つためadmins追加不要） |
| **削除** | 所有アカウントのみ | レコード管理者のみ |

---

## 4. データ整合性・カスケード削除ルール

- **レコード削除時**:
  - 親レコード（`serviceRecords`）削除時、または一括削除（`deleteRecords`）時、紐づくすべての `credentials` が `deleteCredentialsForRecord` ヘルパーによりカスケード削除される。
- **ユーザー退会時**:
  - 家族に残存メンバーがいる場合、退会者の個人レコード（`ownerType: "user"`）およびその配下の `credentials` のみを削除する。共有レコード（`ownerType: "family"`）は元の家族に残し、`reconcileAdminsOnLeave` により残存メンバーへ管理権限を調整する。
  - 退会者が家族グループの最後の 1 人である場合、その家族に紐づく全 `serviceRecords`、配下の全 `credentials`、参加申請（`joinRequests`）、招待（`familyInvites`）、および `families` レコードを削除する。
- **家族離脱時**:
  - 家族移行トランザクションの対象となる個人レコード（`ownerType: "user"`）とその `credentials` は、新マスターキーで再暗号化されて移行先へ引き継がれる。
  - 共有レコード（`ownerType: "family"`）は元の家族グループに残留する。離脱者がレコード管理者である場合、`reconcileAdminsOnLeave` が残存する家族メンバーの管理権限を調整する。
- **メンバーキック時**:
  - 被キックユーザーの個人レコード（`ownerType: "user"`）は削除されず、旧家族の暗号化マスターキー情報が `pendingExportVaults`（30日TTL）に退避され、新家族への移行（再暗号化）に備える。
  - 共有レコード（`ownerType: "family"`）は元の家族グループに残留し、被キックユーザーがレコード管理者である場合は `reconcileAdminsOnLeave` が残存メンバーの管理権限を自動調停する。
  - 移行完了時（`commitFamilyMigration`）またはユーザーによる手動破棄（`abandonPendingExportVault`）時に、`pendingExportVaults` は物理削除される。
- **同一 email アカウント再作成時のデータ引き継ぎ（`users.syncUser`）**:
  - メールアドレス未確認（`emailVerified: false`）の場合はエラーを送出して同期を拒否する。
  - 同一 email かつ別 UID の既存データが存在する場合、旧 UID の `serviceRecords.userId`、家族参加申請（`joinRequests`）、および家族移行データ（`familyMigrations`）を新 UID へ一括付け替えて引き継ぐ（所有権を示す `serviceRecords.accountId` は維持される）。

---

## 5. レコード制約・バリデーション境界 (Constraints & Limits)

巨大ドキュメント生成防止およびUI・DB・CSVインポート間の整合性担保のため、以下の制約を設けている。

- **認証情報項目数 (`credentials`)**: 最大 10 件 (`MAX_CREDENTIALS_PER_RECORD = 10`)
  - UI追加制御、Zodスキーマ、Convexミューテーション、CSVエクスポート・インポートの列定義（1〜10）で統一。
- **タグ数 (`tags`)**: 最大 20 個 (`MAX_TAGS_PER_RECORD = 20`)
  - UI入力制御、Zodスキーマ、Convex一括更新（`bulkUpdateRecords`）、CSVインポートで統一。
- **文字数上限**:
  - タイトル (`title`): 最大 255 文字（必須）
  - 読み仮名 (`titleReading`): 最大 255 文字
  - メモ (`memo`): 最大 10,000 文字
  - パスワードヒント平文: 最大 2,000 文字
  - 各タグ文字列: 最大 50 文字

---

## 6. お問い合わせ (`contacts`) エンティティ

`contacts` テーブルはユーザーからのお問い合わせを格納する単純な書き込み専用テーブル。アクセス制御は不要（認証不要で送信可能）で、読み取りは管理者運用のみを想定。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `name` | string | 送信者名 |
| `email` | string | 送信者メールアドレス |
| `category` | string | お問い合わせ種別 |
| `message` | string | 本文（最大3000文字） |
| `userId` | string? | Firebase UID（ログイン中の場合のみ） |
| `createdAt` | number | 送信日時（Unix ms） |
| `status` | `UNREAD`\|`READ`\|`RESOLVED` | 管理ステータス（初期値: `UNREAD`） |

- **スパム・乱用対策**:
  - **Honeypot**: 非表示フィールド（`hpConfirm`）による単純ボット排除
  - **グローバル/バースト制限**: Convex公式 `@convex-dev/rate-limiter` によるトークンバケット制限（1分間に最大5件回復、キャパシティ10件）
  - **同一メール短時間連投制限**: `by_email_createdAt` インデックスにより直近10分間で3件以上の同一メール送信をブロック
  - **入力バリデーション**: 厳格な型検証（お名前1〜100文字、メールRFC準拠、メッセージ5〜3000文字）
- **メール通知**: `createContact` 成功後、`ctx.scheduler.runAfter(0, ...)` で `sendNotificationEmail` internalAction を非同期実行。`ADMIN_EMAIL`（フォールバック: `RESEND_MAIL_FROM`）宛てに `ContactNotificationEmail` テンプレートで通知。`replyTo` に問い合わせ者メールを設定。
- **インデックス**: `by_createdAt`（管理一覧ソート用）、`by_email_createdAt`（メール別短時間レート制限用）

---

## 7. お知らせ (`NewsContent`) - microCMS `info` エンドポイント

お知らせはConvexではなくmicroCMSで管理。`NewsContent` 型（`cms.server.ts`）と同義の `InfoContent` エイリアスも提供。

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | microCMS コンテンツID |
| `slug` | string | URLスラッグ |
| `title` | string | お知らせタイトル |
| `content` | string | リッチテキスト（HTML文字列） |
| `published_at` | string? | カスタム公開日時フィールド |
| `thumbnail` | `{url, width, height}`? | サムネイル画像 |
| `publishedAt` | string | microCMS標準公開日時（MicroCMSBase） |

- **取得関数**: `fetchNewsListServer`（`info` エンドポイント、最大20件、`-publishedAt,-createdAt` 順）/ `fetchNewsDetailServer`（IDで1件取得）
- **キャッシュ**: `staleTime = 5分`（NEWS_STALE_TIME）
- **表示**: ヘッダーベル（`NewsBell` + Popover、未読バッジ付き）/ ユーザーメニュー / `/news` 一覧・`/news/$id` 詳細ページ（公開ルート）
- **未読管理**: localStorage の `poohma_last_read_news_time`（Unix ms）と最新記事の `published_at` を比較。ベル開封時に更新。

---

## 8. 監査ログ (`auditLogs`) エンティティ

`auditLogs` テーブルは、レコードの全操作（作成・更新・削除・ヒント閲覧・共有設定変更・管理者変更）を家族単位で時系列記録する書き込み専用テーブル。

### 記録トリガー・操作種別

| action | トリガー | familyId | targetAccountId |
| --- | --- | --- | --- |
| `RECORD_CREATE` | `createRecord` | ownerType=familyのとき | ownerType=userのとき |
| `RECORD_UPDATE` | `updateRecord` | ownerType=familyのとき | ownerType=userのとき |
| `RECORD_DELETE` | `deleteRecord` / `deleteRecords` | ownerType=familyのとき | ownerType=userのとき |
| `HINT_VIEW` | `logRecordHintView` | ownerType=familyのとき | ownerType=userのとき |
| `SHARE_SETTING_CHANGED` | `shareRecord` / `unshareRecord` | 常にfamilyIdあり | - |
| `ADMIN_CHANGED` | `addRecordAdmin` / `removeRecordAdmin` | 常にfamilyIdあり | - |

### データ保持・クリーンアップ

- **保持期間**: 180日（`RETENTION_MS = 180 * 24 * 60 * 60 * 1000`）
- **定期削除**: 24時間間隔cron（`cleanupOldAuditLogsInternal`）が `by_createdAt` インデックスで期限切れログを100件ずつバッチ削除。件数上限到達時は `ctx.scheduler.runAfter(0, ...)` で再帰実行。
- **actorDisplayNameの保存**: 脱退・アカウント削除後もログ一覧で権限者を識別できるよう、操作時点の表示名を参照切れに顧慮して保存する。取得時（`getFamilyAuditLogs` / `getRecordAuditLogs`）には DB から最新の `displayName` を上書きして返す。

### UI連携

- **レコード詳細画面** (`routes/(app)/records/$id.tsx`): `RecordAuditHistoryAccordion` コンポーネントが `getRecordAuditLogs`（最大30件）を購読し、アクセス・変更履歴をアコーディオンUIで表示。
- **家族画面** (`routes/(app)/family.tsx`): `FamilyAuditLogSection` コンポーネントが `getFamilyAuditLogs`（ページネーション）を購読し、家族のアクティビティログをアコーディオンUIで表示。
- **ヒント閲覧ログ記録**: `CredentialCard` コンポーネントの暗号復号成功時に `logRecordHintView` Mutationを非同期呼び出し（失敗してもUIに影響しない）。

---

## 9. 安定ID (`stableId`) と CSV 差分突合

PoohMa では、CSVエクスポート・インポートを単なるバックアップにとどまらず、手元での一括編集・差分更新ワークフローとして機能させるため、`stableId` を導入している。

### 9.1 `stableId` の役割と不変条件
- **環境非依存の安定識別子**: Convex の内部不透明ID（`_id`）と異なり、UUID v4 による永続的な識別子を `serviceRecords.stableId` および `credentials.stableId` に付与。
- **自動生成**: `createRecord`, `importRecords` による新規作成時に必ず `crypto.randomUUID()` で自動生成。
- **ワンショット・バックフィル**: 既存レコード・クレデンシャルには `migrations:backfillStableIds` によって一括付与（アプリ実行時の遅延パッチは行わない）。
- **インデックス**: `by_family_stableId`, `by_stableId`, `by_recordId_stableId` により高速な突合を実現。

### 9.2 CSV 差分インポートの判定ルール
- **CREATE**: `RecordId` が空または列なし。新規レコードとして登録（OGP・ふりがな自動補完、ヒント暗号化）。
- **UPDATE**: `RecordId` が一致し、DB上の値と差分がある場合。非空セルのみを更新。
- **SKIP**: 全項目一致、またはCSV側の全セルが空の場合。既存値を維持（空セルによる意図しないデータ削除を完全防止）。
- **ERROR**: 存在しない `RecordId`、CSV内での重複 `RecordId`、異なるレコードに属する `CredentialId`。
- **E2EE保護**: PasswordHint が空欄の場合は暗号化処理・パスコードアンロックをスキップし既存暗号ヒントを維持。平文入力時のみ再暗号化を実行。

