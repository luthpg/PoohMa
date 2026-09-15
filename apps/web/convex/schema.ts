import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  families: defineTable({
    name: v.string(),
    masterKeyEncrypted: v.optional(v.string()),
    masterKeyIv: v.optional(v.string()),
    masterKeySalt: v.optional(v.string()),
    kdfIterations: v.optional(v.number()),
    cryptoVersion: v.optional(v.number()),
    // リカバリーキット用フィールド
    recoveryMasterKeyEncrypted: v.optional(v.string()),
    recoveryMasterKeyIv: v.optional(v.string()),
    recoveryMasterKeySalt: v.optional(v.string()),
    recoveryCodeHash: v.optional(v.string()), // 正規化リカバリーコードのSHA-256ハッシュ（サーバー検証用）
    recoveryKdfIterations: v.optional(v.number()),
    recoveryCryptoVersion: v.optional(v.number()),
    recoveryIssuedAt: v.optional(v.number()),
    recoveryIssuedByAccountId: v.optional(v.id("users")),
    updatedAt: v.number(),
  }),

  recoveryOtps: defineTable({
    accountId: v.id("users"),
    familyId: v.id("families"),
    codeHash: v.string(), // SHA-256 ハッシュ（平文保存しない）
    expiresAt: v.number(), // 有効期限（発行から10分）
    attempts: v.number(), // 試行回数（最大5回）
    lastSentAt: v.number(), // 再送レート制限用（60秒インターバル）
  })
    .index("by_accountId", ["accountId"])
    .index("by_familyId_accountId", ["familyId", "accountId"]),

  recoverySessions: defineTable({
    accountId: v.id("users"),
    familyId: v.id("families"),
    sessionTokenHash: v.string(), // SHA-256 ハッシュ
    expiresAt: v.number(), // 有効期限（10分）
  })
    .index("by_accountId", ["accountId"])
    .index("by_familyId_accountId", ["familyId", "accountId"]),

  loginEvents: defineTable({
    accountId: v.id("users"),
    userId: v.string(),
    deviceId: v.string(),
    deviceName: v.optional(v.string()),
    browser: v.optional(v.string()),
    os: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    location: v.optional(v.string()),
    isNewDevice: v.boolean(),
    loginAt: v.number(),
  })
    .index("by_accountId", ["accountId"])
    .index("by_accountId_deviceId", ["accountId", "deviceId"])
    .index("by_loginAt", ["loginAt"]),

  users: defineTable({
    userId: v.string(), // Firebase UID
    email: v.string(),
    displayName: v.optional(v.string()),
    photoURL: v.optional(v.string()),
    familyId: v.optional(v.id("families")),
    familyRole: v.union(v.literal("admin"), v.literal("viewer")),
    onboardingVersion: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_familyId", ["familyId"]),

  familyMigrations: defineTable({
    userId: v.string(), // Firebase UID
    accountId: v.id("users"), // 作成元 PoohMa アカウント ID
    sourceFamilyId: v.optional(v.id("families")),
    targetFamilyId: v.id("families"),
    serviceRecordIds: v.array(v.id("serviceRecords")),
    status: v.union(
      v.literal("PREPARED"),
      v.literal("COMPLETED"),
      v.literal("EXPIRED"),
      v.literal("ABORTED"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_accountId", ["accountId"])
    .index("by_status", ["status"]),

  pendingExportVaults: defineTable({
    accountId: v.id("users"), // 被キックユーザーのアカウント ID (users._id)
    userId: v.string(), // Firebase UID (監査・照会用)
    oldFamilyId: v.id("families"), // キック元の家族 ID
    oldFamilyName: v.string(), // キック元の家族名（表示用スナップショット）
    masterKeyEncrypted: v.string(), // 旧家族パスコード由来鍵でラップされた旧マスターキー
    masterKeyIv: v.string(),
    masterKeySalt: v.string(),
    kdfIterations: v.optional(v.number()), // PBKDF2 反復回数
    cryptoVersion: v.optional(v.number()), // 暗号化バージョン
    createdAt: v.number(),
    expiresAt: v.number(), // 有効期限（作成から30日）
  })
    .index("by_accountId", ["accountId"])
    .index("by_userId", ["userId"]),

  familyInvites: defineTable({
    familyId: v.id("families"),
    code: v.string(), // crypto.randomUUID() 等の高エントロピー文字列
    createdBy: v.string(), // 発行者の Firebase UID
    createdAt: v.number(),
    expiresAt: v.number(), // 発行時に選択した TTL に基づき算出
    revokedAt: v.optional(v.number()), // セットされていれば即無効
    useCount: v.number(), // この招待経由で作成された参加申請数（監査用）
  })
    .index("by_code", ["code"])
    .index("by_familyId", ["familyId"]),

  joinRequests: defineTable({
    familyId: v.id("families"),
    userId: v.string(), // 申請者の Firebase UID
    accountId: v.id("users"), // 申請元 PoohMa Account ID
    invitedByCode: v.optional(v.id("familyInvites")),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_familyId_status", ["familyId", "status"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_familyId_userId", ["familyId", "userId"])
    .index("by_accountId_status", ["accountId", "status"])
    .index("by_familyId_accountId", ["familyId", "accountId"])
    .index("by_invitedByCode", ["invitedByCode"]),

  serviceRecords: defineTable({
    title: v.string(),
    titleReading: v.optional(v.string()),
    url: v.optional(v.string()),
    ogpImage: v.optional(v.string()),
    ogpDescription: v.optional(v.string()),
    memo: v.optional(v.string()),
    userId: v.string(), // 作成者の Firebase UID (監査・表示用)
    accountId: v.id("users"), // 作成元 / 個人オーナーの PoohMa アカウント ID (主識別子)
    familyId: v.optional(v.id("families")), // 暗号化スコープ / 所属家族 ID

    sortKey: v.optional(v.string()), // 五十音・アルファベット順位プレフィックス付きソートキー
    ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
    ownerFamilyId: v.optional(v.id("families")), // ownerType === "family" のとき
    admins: v.optional(v.array(v.id("users"))), // ownerType === "family" のときの管理者 PoohMa アカウント ID 配列

    updatedByAccountId: v.optional(v.id("users")), // 最終更新を行ったアカウントID
    lastViewedAt: v.optional(v.number()), // 最終ヒント閲覧日時 (epoch ms)
    lastViewedByAccountId: v.optional(v.id("users")), // 最終ヒント閲覧者アカウントID

    // タグを配列として埋め込み
    tags: v.array(v.string()),

    stableId: v.string(), // CSV差分インポート・エクスポート用 UUID v4
    revision: v.optional(v.number()), // 楽観的ロック用（既存レコードは 0 として扱う）
    isSample: v.optional(v.boolean()), // オンボーディング用サンプルデータ識別フラグ
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_accountId", ["accountId"])
    .index("by_family_sortKey", ["familyId", "sortKey"])
    .index("by_family_isSample", ["familyId", "isSample"])
    .index("by_ownerType_accountId", ["ownerType", "accountId"])
    .index("by_ownerType_ownerFamilyId", ["ownerType", "ownerFamilyId"])
    .index("by_family_updatedAt", ["familyId", "updatedAt"])
    .index("by_ownerType_accountId_updatedAt", [
      "ownerType",
      "accountId",
      "updatedAt",
    ])
    .index("by_family_stableId", ["familyId", "stableId"])
    .index("by_stableId", ["stableId"]),

  credentials: defineTable({
    recordId: v.id("serviceRecords"),
    stableId: v.string(), // CSV差分インポート・エクスポート用 UUID v4
    label: v.optional(v.string()),
    loginId: v.optional(v.string()),
    passwordHint: v.optional(v.string()),
    passwordHintIv: v.optional(v.string()),
    passwordHintDekEncrypted: v.optional(v.string()),
    passwordHintDekIv: v.optional(v.string()),
    order: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_recordId", ["recordId"])
    .index("by_recordId_stableId", ["recordId", "stableId"])
    .index("by_stableId", ["stableId"]),

  recordEditingSessions: defineTable({
    recordId: v.id("serviceRecords"),
    accountId: v.id("users"), // 編集者の PoohMa アカウント ID
    updatedAt: v.number(), // 最終ハートビート時刻
  })
    .index("by_recordId", ["recordId"])
    .index("by_accountId", ["accountId"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_recordId_accountId", ["recordId", "accountId"]),

  contacts: defineTable({
    name: v.string(),
    email: v.string(),
    category: v.string(),
    message: v.string(),
    userId: v.optional(v.string()),
    createdAt: v.number(),
    status: v.union(
      v.literal("UNREAD"),
      v.literal("READ"),
      v.literal("RESOLVED"),
    ),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_email_createdAt", ["email", "createdAt"]),

  auditLogs: defineTable({
    familyId: v.optional(v.id("families")), // 家族共有レコードまたは家族内操作の場合に設定
    accountId: v.optional(v.id("users")), // 操作者のアカウントID (削除された場合は参照切れ考慮)
    userId: v.string(), // 操作者の Firebase UID
    actorDisplayName: v.string(), // 操作時点の表示名 (脱退・削除後の表示維持用)
    recordId: v.optional(v.id("serviceRecords")), // 対象レコードID (削除後も特定可能)
    ownerType: v.union(v.literal("user"), v.literal("family")), // 操作時点の所有種別
    ownerFamilyId: v.optional(v.id("families")), // ownerType === "family" の対象家族ID
    targetAccountId: v.optional(v.id("users")), // ownerType === "user" の所有者アカウントID
    action: v.union(
      v.literal("RECORD_CREATE"),
      v.literal("RECORD_UPDATE"),
      v.literal("RECORD_DELETE"),
      v.literal("HINT_VIEW"),
      v.literal("SHARE_SETTING_CHANGED"),
      v.literal("ADMIN_CHANGED"),
    ),
    metadata: v.optional(
      v.object({
        targetTitle: v.optional(v.string()), // レコード名（削除後もログ一覧で識別可能）
        changedFields: v.optional(v.array(v.string())), // 変更されたフィールド名配列
        detail: v.optional(v.string()), // 管理者追加/解除等の付加情報
      }),
    ),
    createdAt: v.number(), // 記録日時 (epoch ms)
  })
    .index("by_family_createdAt", ["familyId", "createdAt"])
    .index("by_recordId_createdAt", ["recordId", "createdAt"])
    .index("by_targetAccountId_createdAt", ["targetAccountId", "createdAt"])
    .index("by_createdAt", ["createdAt"]), // 定期パージ用
});
