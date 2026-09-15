import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import { computeSortKey } from "../src/utils/index-group";
import {
  CredentialInputSchema,
  MAX_CREDENTIALS_PER_RECORD,
  MAX_TAGS_PER_RECORD,
  RecordInputSchema,
} from "../src/utils/schemas";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { logAuditEvent } from "./auditLogs";
import {
  authenticatedMutation,
  authenticatedQuery,
  familyBoundMutation,
  familyBoundQuery,
  recordAdminMutation,
} from "./customBuilders";
import {
  getEffectiveAdmins,
  getEffectiveOwnerFamilyId,
  getEffectiveOwnerType,
  isRecordAdmin,
  requireAdminAccess,
  requireContentAccess,
} from "./rls";

const ConvexCredentialInputSchema = CredentialInputSchema.extend({
  id: z.string().optional(),
});

export const EDIT_SESSION_TTL_MS = 5 * 60 * 1000; // 5分
export const EDIT_HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30秒

const ConvexRecordInputSchema = RecordInputSchema.extend({
  credentials: z
    .array(ConvexCredentialInputSchema)
    .max(
      MAX_CREDENTIALS_PER_RECORD,
      `アカウント情報は${MAX_CREDENTIALS_PER_RECORD}件まで登録できます`,
    ),
});

/**
 * レコードに紐づくクレデンシャル一覧を取得するヘルパー
 */
export async function getCredentialsForRecord(
  ctx: { db: QueryCtx["db"] | MutationCtx["db"] },
  recordId: Id<"serviceRecords">,
): Promise<Doc<"credentials">[]> {
  const creds = await ctx.db
    .query("credentials")
    .withIndex("by_recordId", (i) => i.eq("recordId", recordId))
    .collect();
  return creds.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * レコードに紐づく全クレデンシャルをカスケード削除するヘルパー
 */
export async function deleteCredentialsForRecord(
  ctx: { db: MutationCtx["db"] },
  recordId: Id<"serviceRecords">,
) {
  const creds = await ctx.db
    .query("credentials")
    .withIndex("by_recordId", (i) => i.eq("recordId", recordId))
    .collect();
  for (const c of creds) {
    await ctx.db.delete(c._id);
  }
}

/**
 * ユーザーがアクセス可能な可視レコード（または所有レコード）を取得するヘルパー
 * by_family_sortKey インデックスにより他家族のデータをスキャンせず高速取得
 */
async function collectVisibleRecords(
  ctx: { db: QueryCtx["db"] },
  user: Doc<"users">,
  ownedOnly = false,
): Promise<Doc<"serviceRecords">[]> {
  if (user.familyId) {
    const familyRecords = await ctx.db
      .query("serviceRecords")
      .withIndex("by_family_sortKey", (i) => i.eq("familyId", user.familyId))
      .collect();

    if (ownedOnly) {
      return familyRecords.filter((r) => {
        const ownerType = getEffectiveOwnerType(r);
        const ownerFamilyId = getEffectiveOwnerFamilyId(r);
        const admins = getEffectiveAdmins(r);
        return (
          (ownerType === "user" && r.accountId === user._id) ||
          (ownerType === "family" &&
            ownerFamilyId === user.familyId &&
            admins.includes(user._id))
        );
      });
    }
    return familyRecords.filter((r) => {
      const ownerType = getEffectiveOwnerType(r);
      const ownerFamilyId = getEffectiveOwnerFamilyId(r);
      return (
        (ownerType === "family" && ownerFamilyId === user.familyId) ||
        (ownerType === "user" && r.accountId === user._id)
      );
    });
  }

  // 家族未所属の場合
  const personalRecords = await ctx.db
    .query("serviceRecords")
    .withIndex("by_accountId", (i) => i.eq("accountId", user._id))
    .collect();

  return personalRecords.filter((r) => getEffectiveOwnerType(r) === "user");
}

/**
 * Convex の同時実行 I/O 上限（1,000 ops）を安全に回避するための有界並行マッピングヘルパー
 * 各チャンク（既定64件）内を Promise.all で並列処理し、チャンク間は順次処理する
 */
export async function asyncMapBounded<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
  chunkSize = 64,
): Promise<U[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("chunkSize must be a positive integer");
  }

  const results: U[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

function sortRecords<T extends Doc<"serviceRecords">>(
  records: T[],
  sort: string | undefined,
): void {
  records.sort((a, b) => {
    if (sort === "name-asc")
      return (a.titleReading || a.title).localeCompare(
        b.titleReading || b.title,
      );
    if (sort === "name-desc")
      return (b.titleReading || b.title).localeCompare(
        a.titleReading || a.title,
      );
    if (sort === "url-asc") return (a.url || "").localeCompare(b.url || "");
    if (sort === "url-desc") return (b.url || "").localeCompare(a.url || "");
    if (sort === "date-asc" || sort === "updatedAt-asc")
      return a.updatedAt - b.updatedAt;
    if (sort === "date-desc" || sort === "updatedAt-desc")
      return b.updatedAt - a.updatedAt;
    return (a.sortKey || a.title).localeCompare(b.sortKey || b.title);
  });
}

// === Queries ===

export const getRecords = authenticatedQuery({
  args: {
    q: v.optional(v.string()),
    tag: v.optional(v.string()),
    sort: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;

    let records = await collectVisibleRecords(ctx, user);

    if (args.tag) {
      records = records.filter((r) => r.tags.includes(args.tag as string));
    }

    // クレデンシャル検索が不要な場合は、結合前に必要件数まで絞り込む
    if (!args.q) {
      sortRecords(records, args.sort);
      if (args.limit !== undefined && args.limit > 0) {
        records = records.slice(0, args.limit);
      }
    }

    // 各レコードに紐づく credentials を小さなバッチ（Bounded Concurrency: 32件）で取得
    // 一覧表示・検索に必要なフィールド（_id, label, loginId）のみを結合し、暗号化データは除外してペイロードを軽量化
    const recordsWithCredentials = await asyncMapBounded(
      records,
      async (record) => {
        const creds = await getCredentialsForRecord(ctx, record._id);
        const mappedCreds = creds.map((c) => ({
          _id: c._id,
          id: c._id,
          label: c.label,
          loginId: c.loginId,
        }));
        return {
          ...record,
          revision: record.revision ?? 0,
          credentials: mappedCreds,
        };
      },
      32,
    );

    let filtered = recordsWithCredentials;

    if (args.q) {
      const q = args.q.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.memo?.toLowerCase().includes(q) ||
          r.credentials.some(
            (c) =>
              c.label?.toLowerCase().includes(q) ||
              c.loginId?.toLowerCase().includes(q),
          ),
      );
    }

    if (args.q) {
      // ソート（args.sort 未指定時も sortKey による既定ソートを適用）
      sortRecords(filtered, args.sort);
      if (args.limit !== undefined && args.limit > 0) {
        filtered = filtered.slice(0, args.limit);
      }
    }

    return filtered;
  },
});

/**
 * 大量レコードを安全に分割取得するためのページネーション対応クエリ
 * Convex の usePaginatedQuery に準拠し、1回の実行でページ内のレコードのみ credential 読み取りを実行する
 */
export const getRecordsPaginated = authenticatedQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    q: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;

    const baseQuery = user.familyId
      ? ctx.db
          .query("serviceRecords")
          .withIndex("by_family_sortKey", (i) =>
            i.eq("familyId", user.familyId),
          )
      : ctx.db
          .query("serviceRecords")
          .withIndex("by_accountId", (i) => i.eq("accountId", user._id));

    const paginated = await baseQuery.paginate(args.paginationOpts);

    // 家族内での閲覧権限（他人の個人レコードを除外）をフィルタリング
    const visiblePage = paginated.page.filter((r) => {
      const ownerType = getEffectiveOwnerType(r);
      const ownerFamilyId = getEffectiveOwnerFamilyId(r);
      if (user.familyId) {
        return (
          (ownerType === "family" && ownerFamilyId === user.familyId) ||
          (ownerType === "user" && r.accountId === user._id)
        );
      }
      return ownerType === "user" && r.accountId === user._id;
    });

    let records = visiblePage;
    if (args.tag) {
      records = records.filter((r) => r.tags.includes(args.tag as string));
    }

    // ページ内レコードの credentials のみを小さなバッチ（32件）で取得
    const recordsWithCredentials = await asyncMapBounded(
      records,
      async (record) => {
        const creds = await getCredentialsForRecord(ctx, record._id);
        const mappedCreds = creds.map((c) => ({
          _id: c._id,
          id: c._id,
          label: c.label,
          loginId: c.loginId,
        }));
        return {
          ...record,
          revision: record.revision ?? 0,
          credentials: mappedCreds,
        };
      },
      32,
    );

    let filtered = recordsWithCredentials;
    if (args.q) {
      const q = args.q.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.memo?.toLowerCase().includes(q) ||
          r.credentials.some(
            (c) =>
              c.label?.toLowerCase().includes(q) ||
              c.loginId?.toLowerCase().includes(q),
          ),
      );
    }

    return {
      ...paginated,
      page: filtered,
    };
  },
});

export const getRecordDetail = authenticatedQuery({
  args: { id: v.id("serviceRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) {
      throw new Error("Record not found");
    }

    // アクセス権のチェック（IDOR対策）
    requireContentAccess(ctx.user, record);

    const recordOwner = await ctx.db.get(record.accountId);

    // 管理者ユーザー一覧の情報を取得（動的マージ）
    let adminDocs: (Doc<"users"> | null)[] = [];
    if (record.ownerType === "family" && record.ownerFamilyId) {
      const familyAdmins = await ctx.db
        .query("users")
        .filter((q) =>
          q.and(
            q.eq(q.field("familyId"), record.ownerFamilyId),
            q.eq(q.field("familyRole"), "admin"),
          ),
        )
        .collect();

      const individualAdmins = await Promise.all(
        (record.admins ?? []).map((adminId) => ctx.db.get(adminId)),
      );

      const allAdminsMap = new Map<Id<"users">, Doc<"users">>();
      for (const u of familyAdmins) {
        allAdminsMap.set(u._id, u);
      }
      for (const u of individualAdmins) {
        if (u) allAdminsMap.set(u._id, u);
      }
      adminDocs = Array.from(allAdminsMap.values());
    } else {
      adminDocs = await Promise.all(
        (record.admins ?? []).map((adminId) => ctx.db.get(adminId)),
      );
    }
    const admins = adminDocs
      .filter((u): u is Doc<"users"> => u != null)
      .map((u) => ({
        _id: u._id,
        displayName: u.displayName,
        email: u.email,
      }));

    // credentialsテーブルからクレデンシャル一覧を取得
    const creds = await getCredentialsForRecord(ctx, record._id);
    const mappedCredentials = creds.map((c) => ({
      _id: c._id,
      id: c._id,
      label: c.label,
      loginId: c.loginId,
      passwordHint: c.passwordHint,
      passwordHintIv: c.passwordHintIv,
      passwordHintDekEncrypted: c.passwordHintDekEncrypted,
      passwordHintDekIv: c.passwordHintDekIv,
    }));

    const lastUpdateUser = record.updatedByAccountId
      ? await ctx.db.get("users", record.updatedByAccountId)
      : null;

    return {
      ...record,
      revision: record.revision ?? 0,
      credentials: mappedCredentials,
      user: recordOwner
        ? {
            displayName: recordOwner.displayName,
            email: recordOwner.email,
          }
        : null,
      adminUsers: admins,
      lastUpdateUser,
    };
  },
});

export const getAvailableTags = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    const { user } = ctx;
    const visibleRecords = await collectVisibleRecords(ctx, user);
    const tagsSet = new Set<string>();
    for (const r of visibleRecords) {
      for (const t of r.tags) {
        tagsSet.add(t);
      }
    }

    return Array.from(tagsSet).sort();
  },
});

export const getOwnedRecords = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    const { user } = ctx;
    const records = await collectVisibleRecords(ctx, user, true);

    const members = user.familyId
      ? await ctx.db
          .query("users")
          .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
          .collect()
      : [user];
    const emailById = new Map(members.map((m) => [m._id, m.email]));

    // 各レコードの管理者メールアドレスとクレデンシャルを付与
    return Promise.all(
      records.map(async (r) => {
        const admins = getEffectiveAdmins(r);
        const creds = await getCredentialsForRecord(ctx, r._id);
        return {
          ...r,
          credentials: creds.map((c) => ({
            _id: c._id,
            id: c._id,
            label: c.label,
            loginId: c.loginId,
            passwordHint: c.passwordHint,
            passwordHintIv: c.passwordHintIv,
            passwordHintDekEncrypted: c.passwordHintDekEncrypted,
            passwordHintDekIv: c.passwordHintDekIv,
          })),
          adminEmails: admins
            .map((id) => emailById.get(id))
            .filter((email): email is string => !!email),
        };
      }),
    );
  },
});

// === Mutations ===

export const createRecord = familyBoundMutation({
  args: {
    title: v.string(),
    titleReading: v.optional(v.string()),
    url: v.optional(v.string()),
    ogpImage: v.optional(v.string()),
    ogpDescription: v.optional(v.string()),
    memo: v.optional(v.string()),
    ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
    credentials: v.array(
      v.object({
        id: v.optional(v.string()),
        label: v.optional(v.string()),
        loginId: v.optional(v.string()),
        passwordHint: v.optional(v.string()),
        passwordHintIv: v.optional(v.string()),
        passwordHintDekEncrypted: v.optional(v.string()),
        passwordHintDekIv: v.optional(v.string()),
      }),
    ),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const parsed = ConvexRecordInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Validation failed: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    const { user } = ctx;
    const isFamily = args.ownerType === "family";
    const sortKey = computeSortKey({
      titleReading: args.titleReading,
      title: args.title,
    });
    const now = Date.now();

    const recordId = await ctx.db.insert("serviceRecords", {
      title: args.title,
      titleReading: args.titleReading,
      url: args.url,
      ogpImage: args.ogpImage,
      ogpDescription: args.ogpDescription,
      memo: args.memo,
      userId: user.userId,
      accountId: user._id,
      familyId: user.familyId,
      sortKey,
      ownerType: isFamily ? "family" : "user",
      ownerFamilyId: isFamily ? user.familyId : undefined,
      admins: isFamily && user.familyRole === "viewer" ? [user._id] : [],
      tags: args.tags,
      stableId: crypto.randomUUID(),
      revision: 0,
      updatedAt: now,
      updatedByAccountId: user._id,
    });

    // credentials テーブルへ挿入
    for (let i = 0; i < args.credentials.length; i++) {
      const c = args.credentials[i];
      await ctx.db.insert("credentials", {
        recordId,
        stableId: crypto.randomUUID(),
        label: c.label,
        loginId: c.loginId,
        passwordHint: c.passwordHint,
        passwordHintIv: c.passwordHintIv,
        passwordHintDekEncrypted: c.passwordHintDekEncrypted,
        passwordHintDekIv: c.passwordHintDekIv,
        order: i,
        updatedAt: now,
      });
    }

    await logAuditEvent(ctx, {
      actor: user,
      recordId,
      ownerType: isFamily ? "family" : "user",
      ownerFamilyId: isFamily ? user.familyId : undefined,
      action: "RECORD_CREATE",
      metadata: {
        targetTitle: args.title,
      },
    });

    return recordId;
  },
});

export const updateRecord = familyBoundMutation({
  args: {
    id: v.id("serviceRecords"),
    revision: v.optional(v.number()),
    force: v.optional(v.boolean()),
    data: v.object({
      title: v.string(),
      titleReading: v.optional(v.string()),
      url: v.optional(v.string()),
      ogpImage: v.optional(v.string()),
      ogpDescription: v.optional(v.string()),
      memo: v.optional(v.string()),
      ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
      credentials: v.array(
        v.object({
          id: v.optional(v.string()),
          label: v.optional(v.string()),
          loginId: v.optional(v.string()),
          passwordHint: v.optional(v.string()),
          passwordHintIv: v.optional(v.string()),
          passwordHintDekEncrypted: v.optional(v.string()),
          passwordHintDekIv: v.optional(v.string()),
        }),
      ),
      tags: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const parsed = ConvexRecordInputSchema.safeParse(args.data);
    if (!parsed.success) {
      throw new Error(
        `Validation failed: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    // コンテンツ編集権限の確認（管理者権限が必要）
    requireAdminAccess(ctx.user, record);

    // 楽観的ロック検証（force: true の場合はバイパス）
    if (!args.force) {
      if (args.revision === undefined) {
        throw new Error("REVISION_REQUIRED: revision is required");
      }
      if (!Number.isSafeInteger(args.revision) || args.revision < 0) {
        throw new Error(
          "REVISION_INVALID: revision must be a non-negative integer",
        );
      }
      if ((record.revision ?? 0) !== args.revision) {
        throw new Error(
          "CONFLICT: レコードが他のユーザーによって更新されました",
        );
      }
    }

    const now = Date.now();
    const patchData: Partial<Doc<"serviceRecords">> = {
      title: args.data.title,
      titleReading:
        args.data.titleReading !== undefined
          ? args.data.titleReading
          : record.titleReading,
      url: args.data.url,
      ogpImage: args.data.ogpImage,
      ogpDescription: args.data.ogpDescription,
      memo: args.data.memo,
      tags: args.data.tags,
      revision: (record.revision ?? 0) + 1,
      updatedAt: now,
      updatedByAccountId: ctx.user._id,
    };

    // ソートキーの更新
    patchData.sortKey = computeSortKey({
      titleReading: patchData.titleReading,
      title: patchData.title ?? record.title,
    });

    // ownerType の変更制御
    const currentOwnerType = getEffectiveOwnerType(record);

    // credentials の同期前スナップショットを取得し、監査ログの差分判定に使用する
    const existingCreds = await ctx.db
      .query("credentials")
      .withIndex("by_recordId", (i) => i.eq("recordId", args.id))
      .collect();
    const existingMap = new Map(existingCreds.map((c) => [c._id as string, c]));

    const diffFields: string[] = [];
    if (record.title !== args.data.title) diffFields.push("title");
    if (
      record.titleReading !==
      (args.data.titleReading !== undefined
        ? args.data.titleReading
        : record.titleReading)
    )
      diffFields.push("titleReading");
    if (record.url !== args.data.url) diffFields.push("url");
    if (record.memo !== args.data.memo) diffFields.push("memo");
    if (
      args.data.ownerType !== undefined &&
      currentOwnerType !== args.data.ownerType
    )
      diffFields.push("ownerType");
    if (
      JSON.stringify([...record.tags].sort()) !==
      JSON.stringify([...args.data.tags].sort())
    )
      diffFields.push("tags");

    const seenCredentialIds = new Set<string>();
    const credentialsChanged =
      existingCreds.length !== args.data.credentials.length ||
      args.data.credentials.some((credential, index) => {
        const normalizedId = credential.id
          ? ctx.db.normalizeId("credentials", credential.id)
          : null;
        if (!normalizedId || seenCredentialIds.has(normalizedId)) return true;

        seenCredentialIds.add(normalizedId);
        const existing = existingMap.get(normalizedId);
        return (
          !existing ||
          existing.order !== index ||
          existing.label !== credential.label ||
          existing.loginId !== credential.loginId ||
          existing.passwordHint !== credential.passwordHint ||
          existing.passwordHintIv !== credential.passwordHintIv ||
          existing.passwordHintDekEncrypted !==
            credential.passwordHintDekEncrypted ||
          existing.passwordHintDekIv !== credential.passwordHintDekIv
        );
      });
    if (credentialsChanged) diffFields.push("credentials");

    if (
      args.data.ownerType !== undefined &&
      args.data.ownerType !== currentOwnerType
    ) {
      if (currentOwnerType === "user" && args.data.ownerType === "family") {
        if (record.accountId !== ctx.user._id) {
          throw new Error("Forbidden: Only the owner can share this record");
        }
        patchData.ownerType = "family";
        patchData.ownerFamilyId = ctx.user.familyId;
        patchData.admins = [ctx.user._id];
      } else if (
        currentOwnerType === "family" &&
        args.data.ownerType === "user"
      ) {
        requireAdminAccess(ctx.user, record);
        patchData.ownerType = "user";
        patchData.userId = ctx.user.userId;
        patchData.accountId = ctx.user._id;
        patchData.ownerFamilyId = undefined;
        patchData.admins = [];
      }
    }

    await ctx.db.patch(args.id, patchData);

    // credentials の同期
    const retainedIds = new Set<string>();

    for (let i = 0; i < args.data.credentials.length; i++) {
      const c = args.data.credentials[i];
      const normalizedId = c.id
        ? ctx.db.normalizeId("credentials", c.id)
        : null;

      if (normalizedId && existingMap.has(normalizedId)) {
        // 既存クレデンシャルの更新
        retainedIds.add(normalizedId);
        await ctx.db.patch(normalizedId, {
          label: c.label,
          loginId: c.loginId,
          passwordHint: c.passwordHint,
          passwordHintIv: c.passwordHintIv,
          passwordHintDekEncrypted: c.passwordHintDekEncrypted,
          passwordHintDekIv: c.passwordHintDekIv,
          order: i,
          updatedAt: now,
        });
      } else {
        // 新規クレデンシャルの作成
        const newId = await ctx.db.insert("credentials", {
          recordId: args.id,
          label: c.label,
          loginId: c.loginId,
          passwordHint: c.passwordHint,
          passwordHintIv: c.passwordHintIv,
          passwordHintDekEncrypted: c.passwordHintDekEncrypted,
          passwordHintDekIv: c.passwordHintDekIv,
          order: i,
          updatedAt: now,
        });
        retainedIds.add(newId);
      }
    }

    // 削除されたクレデンシャルを物理削除
    for (const cred of existingCreds) {
      if (!retainedIds.has(cred._id)) {
        await ctx.db.delete(cred._id);
      }
    }

    // 保存完了に伴い、自身の編集セッションを自動クリーンアップ
    const existingSession = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_recordId_accountId", (i) =>
        i.eq("recordId", args.id).eq("accountId", ctx.user._id),
      )
      .unique();
    if (existingSession) {
      await ctx.db.delete(existingSession._id);
    }

    await logAuditEvent(ctx, {
      actor: ctx.user,
      record,
      recordId: args.id,
      ownerType: currentOwnerType,
      ownerFamilyId:
        currentOwnerType === "family" ? ctx.user.familyId : undefined,
      targetAccountId: currentOwnerType === "family" ? undefined : ctx.user._id,
      action: "RECORD_UPDATE",
      metadata: {
        targetTitle: record.title,
        changedFields: diffFields,
      },
    });
  },
});

// === クレデンシャル単位の個別CRUD ===

/**
 * テスト用
 */
export const createCredential = familyBoundMutation({
  args: {
    recordId: v.id("serviceRecords"),
    label: v.optional(v.string()),
    loginId: v.optional(v.string()),
    passwordHint: v.optional(v.string()),
    passwordHintIv: v.optional(v.string()),
    passwordHintDekEncrypted: v.optional(v.string()),
    passwordHintDekIv: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");
    requireAdminAccess(ctx.user, record);

    const existingCreds = await ctx.db
      .query("credentials")
      .withIndex("by_recordId", (i) => i.eq("recordId", args.recordId))
      .collect();

    if (existingCreds.length >= MAX_CREDENTIALS_PER_RECORD) {
      throw new Error(
        `アカウント情報は${MAX_CREDENTIALS_PER_RECORD}件まで登録できます`,
      );
    }

    const now = Date.now();
    const defaultOrder =
      existingCreds.length > 0
        ? Math.max(...existingCreds.map((c) => c.order ?? 0)) + 1
        : 0;

    const credId = await ctx.db.insert("credentials", {
      recordId: args.recordId,
      label: args.label,
      loginId: args.loginId,
      passwordHint: args.passwordHint,
      passwordHintIv: args.passwordHintIv,
      passwordHintDekEncrypted: args.passwordHintDekEncrypted,
      passwordHintDekIv: args.passwordHintDekIv,
      order: args.order ?? defaultOrder,
      updatedAt: now,
    });

    await ctx.db.patch(args.recordId, { updatedAt: now });
    return credId;
  },
});

/**
 * テスト用
 */
export const updateCredential = familyBoundMutation({
  args: {
    id: v.id("credentials"),
    label: v.optional(v.string()),
    loginId: v.optional(v.string()),
    passwordHint: v.optional(v.string()),
    passwordHintIv: v.optional(v.string()),
    passwordHintDekEncrypted: v.optional(v.string()),
    passwordHintDekIv: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cred = await ctx.db.get(args.id);
    if (!cred) throw new Error("Credential not found");

    const record = await ctx.db.get(cred.recordId);
    if (!record) throw new Error("Record not found");
    requireAdminAccess(ctx.user, record);

    const now = Date.now();
    await ctx.db.patch(args.id, {
      label: args.label,
      loginId: args.loginId,
      passwordHint: args.passwordHint,
      passwordHintIv: args.passwordHintIv,
      passwordHintDekEncrypted: args.passwordHintDekEncrypted,
      passwordHintDekIv: args.passwordHintDekIv,
      order: args.order !== undefined ? args.order : cred.order,
      updatedAt: now,
    });

    await ctx.db.patch(record._id, { updatedAt: now });
  },
});

/**
 * テスト用
 */
export const deleteCredential = familyBoundMutation({
  args: { id: v.id("credentials") },
  handler: async (ctx, args) => {
    const cred = await ctx.db.get(args.id);
    if (!cred) throw new Error("Credential not found");

    const record = await ctx.db.get(cred.recordId);
    if (!record) throw new Error("Record not found");
    requireAdminAccess(ctx.user, record);

    await ctx.db.delete(args.id);
    await ctx.db.patch(record._id, { updatedAt: Date.now() });
  },
});

export const deleteRecord = familyBoundMutation({
  args: { id: v.id("serviceRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    // 個人所有者または家族管理者のみ削除可能
    requireAdminAccess(ctx.user, record);

    const recordTitle = `${record.title}`;
    const ownerType = getEffectiveOwnerType(record);
    const ownerFamilyId =
      ownerType === "family" ? record.ownerFamilyId : undefined;
    const targetAccountId = ownerType === "user" ? record.accountId : undefined;

    // カスケード削除
    await deleteCredentialsForRecord(ctx, args.id);
    await ctx.db.delete(args.id);

    //ログ記録
    await logAuditEvent(ctx, {
      actor: ctx.user,
      recordId: args.id,
      ownerType,
      ownerFamilyId,
      targetAccountId,
      action: "RECORD_DELETE",
      metadata: {
        targetTitle: recordTitle,
      },
    });
  },
});

export const deleteRecords = familyBoundMutation({
  args: { ids: v.array(v.id("serviceRecords")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const record = await ctx.db.get(id);
      if (!record) continue;

      const recordTitle = `${record.title}`;
      const ownerType = getEffectiveOwnerType(record);
      const ownerFamilyId =
        ownerType === "family" ? record.ownerFamilyId : undefined;
      const targetAccountId =
        ownerType === "user" ? record.accountId : undefined;

      requireAdminAccess(ctx.user, record);
      await deleteCredentialsForRecord(ctx, id);
      await ctx.db.delete(id);

      //ログ記録
      await logAuditEvent(ctx, {
        actor: ctx.user,
        recordId: id,
        ownerType,
        ownerFamilyId,
        targetAccountId,
        action: "RECORD_DELETE",
        metadata: {
          targetTitle: recordTitle,
        },
      });
    }
  },
});

/**
 * 個人レコードをワンタップで家族共有へ移行
 */
export const shareRecord = familyBoundMutation({
  args: { id: v.id("serviceRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    if (record.ownerType !== "user" || record.accountId !== ctx.user._id) {
      throw new Error(
        "Forbidden: Only the personal owner can share this record",
      );
    }

    await ctx.db.patch(args.id, {
      ownerType: "family",
      ownerFamilyId: ctx.user.familyId,
      admins: ctx.user.familyRole === "viewer" ? [ctx.user._id] : [],
      updatedAt: Date.now(),
    });

    //ログ記録
    await logAuditEvent(ctx, {
      actor: ctx.user,
      recordId: args.id,
      ownerType: "family",
      ownerFamilyId: ctx.user.familyId,
      targetAccountId: undefined,
      action: "SHARE_SETTING_CHANGED",
      metadata: {
        changedFields: ["ownerType", "ownerFamilyId", "admins"],
      },
    });

    const family = await ctx.db.get(ctx.familyId);
    const familyName = family?.name ?? "家族";
    const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";

    await ctx.scheduler.runAfter(
      0,
      internal.actions.sendTemplatedEmailInternal,
      {
        email: ctx.user.email,
        payload: {
          template: "shareSettingChanged",
          props: {
            displayName: ctx.user.displayName || "メンバー",
            familyName,
            changedByDisplayName: ctx.user.displayName || "メンバー",
            changedAt: Date.now(),
            changeSummary: `「${record.title}」が家族共有に設定されました`,
            ctaUrl: `${appUrl}/records`,
          },
        },
      },
    );
  },
});

/**
 * 共有レコードをワンタップで共有解除（実行者が新個人所有者）
 */
export const unshareRecord = familyBoundMutation({
  args: { id: v.id("serviceRecords") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Record not found");

    requireAdminAccess(ctx.user, record);

    await ctx.db.patch(args.id, {
      ownerType: "user",
      userId: ctx.user.userId,
      accountId: ctx.user._id,
      ownerFamilyId: undefined,
      admins: [],
      updatedAt: Date.now(),
    });

    //ログ記録
    await logAuditEvent(ctx, {
      actor: ctx.user,
      recordId: args.id,
      ownerType: "family",
      ownerFamilyId: ctx.user.familyId,
      targetAccountId: undefined,
      action: "SHARE_SETTING_CHANGED",
      metadata: {
        changedFields: ["ownerType", "ownerFamilyId", "admins"],
      },
    });

    const family = await ctx.db.get(ctx.familyId);
    const familyName = family?.name ?? "家族";
    const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";

    await ctx.scheduler.runAfter(
      0,
      internal.actions.sendTemplatedEmailInternal,
      {
        email: ctx.user.email,
        payload: {
          template: "shareSettingChanged",
          props: {
            displayName: ctx.user.displayName || "メンバー",
            familyName,
            changedByDisplayName: ctx.user.displayName || "メンバー",
            changedAt: Date.now(),
            changeSummary: `「${record.title}」の共有が解除され、個人所有に変更されました`,
            ctaUrl: `${appUrl}/records`,
          },
        },
      },
    );
  },
});

/**
 * 共有レコードの管理者を同一家族内メンバーから追加
 */
export const addRecordAdmin = recordAdminMutation({
  args: {
    targetAccountId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const record = ctx.record;

    const targetUser = await ctx.db.get(args.targetAccountId);
    if (!targetUser || targetUser.familyId !== ctx.user.familyId) {
      throw new Error("Target user is not a member of this family");
    }

    if (targetUser.familyRole === "admin") {
      throw new Error("ファミリー管理者はすでにあらゆるレコードの管理者です");
    }

    const admins = record.admins ?? [];
    if (!admins.includes(args.targetAccountId)) {
      const newAdmins = [...admins, args.targetAccountId];
      await ctx.db.patch(record._id, {
        admins: newAdmins,
        updatedAt: Date.now(),
      });

      //ログ記録
      await logAuditEvent(ctx, {
        actor: ctx.user,
        recordId: record._id,
        ownerType: "family",
        ownerFamilyId: ctx.user.familyId,
        targetAccountId: undefined,
        action: "ADMIN_CHANGED",
        metadata: {
          changedFields: ["admins"],
          detail: `管理者追加: ${targetUser.displayName}`,
        },
      });

      const family = ctx.familyId ? await ctx.db.get(ctx.familyId) : null;
      const familyName = family?.name ?? "家族";
      const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";
      const now = Date.now();

      // 新管理者一覧の全メンバーに通知
      for (const adminId of newAdmins) {
        const adminDoc = await ctx.db.get(adminId);
        if (adminDoc) {
          await ctx.scheduler.runAfter(
            0,
            internal.actions.sendTemplatedEmailInternal,
            {
              email: adminDoc.email,
              payload: {
                template: "recordAdminChanged",
                props: {
                  displayName: adminDoc.displayName || "メンバー",
                  familyName,
                  accountName: record.title,
                  event: "added",
                  changedAccountDisplayName:
                    targetUser.displayName || "メンバー",
                  changedByDisplayName: ctx.user.displayName || "メンバー",
                  changedAt: now,
                  ctaUrl: `${appUrl}/records`,
                },
              },
            },
          );
        }
      }
    }
  },
});

/**
 * 共有レコードの管理者を降格（最後の1人の削除は拒否）
 */
export const removeRecordAdmin = recordAdminMutation({
  args: {
    targetAccountId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const record = ctx.record;

    const targetUser = await ctx.db.get(args.targetAccountId);
    if (!targetUser) {
      throw new Error("Target user not found");
    }

    if (targetUser.familyRole === "admin") {
      throw new Error("ファミリー管理者は閲覧者に変更できません");
    }

    const admins = record.admins ?? [];
    if (!admins.includes(args.targetAccountId)) {
      throw new Error("Target user is not an administrator of this record");
    }

    // 家族内にファミリー管理者が存在するか確認
    const hasDefaultAdmin = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(
          q.eq(q.field("familyId"), ctx.user.familyId),
          q.eq(q.field("familyRole"), "admin"),
        ),
      )
      .first();

    if (!hasDefaultAdmin && admins.length <= 1) {
      throw new Error("管理者が0人になるため削除できません");
    }

    const newAdmins = admins.filter((id) => id !== args.targetAccountId);
    await ctx.db.patch(record._id, {
      admins: newAdmins,
      updatedAt: Date.now(),
    });

    //ログ記録
    await logAuditEvent(ctx, {
      actor: ctx.user,
      recordId: record._id,
      ownerType: "family",
      ownerFamilyId: ctx.user.familyId,
      targetAccountId: undefined,
      action: "ADMIN_CHANGED",
      metadata: {
        changedFields: ["admins"],
        detail: `管理者削除: ${targetUser.displayName}`,
      },
    });

    const family = ctx.familyId ? await ctx.db.get(ctx.familyId) : null;
    const familyName = family?.name ?? "家族";
    const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";
    const now = Date.now();

    // 削除された本人を含む関係者に通知
    const notifyUserIds = Array.from(
      new Set([...newAdmins, args.targetAccountId]),
    );
    for (const userId of notifyUserIds) {
      const userDoc = await ctx.db.get(userId);
      if (userDoc) {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.sendTemplatedEmailInternal,
          {
            email: userDoc.email,
            payload: {
              template: "recordAdminChanged",
              props: {
                displayName: userDoc.displayName || "メンバー",
                familyName,
                accountName: record.title,
                event: "removed",
                changedAccountDisplayName: targetUser.displayName || "メンバー",
                changedByDisplayName: ctx.user.displayName || "メンバー",
                changedAt: now,
                ctaUrl: `${appUrl}/records`,
              },
            },
          },
        );
      }
    }
  },
});

/**
 * 個人所有レコードを一括共有
 */
export const bulkShareRecords = familyBoundMutation({
  args: { ids: v.array(v.id("serviceRecords")) },
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const record = await ctx.db.get(id);
      if (
        record &&
        record.ownerType === "user" &&
        record.accountId === ctx.user._id
      ) {
        await ctx.db.patch(id, {
          ownerType: "family",
          ownerFamilyId: ctx.user.familyId,
          admins: ctx.user.familyRole === "viewer" ? [ctx.user._id] : [],
          updatedAt: Date.now(),
        });
        count++;
      }
    }

    if (count > 0) {
      const family = await ctx.db.get(ctx.familyId);
      const familyName = family?.name ?? "家族";
      const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";

      await ctx.scheduler.runAfter(
        0,
        internal.actions.sendTemplatedEmailInternal,
        {
          email: ctx.user.email,
          payload: {
            template: "shareSettingChanged",
            props: {
              displayName: ctx.user.displayName || "メンバー",
              familyName,
              changedByDisplayName: ctx.user.displayName || "メンバー",
              changedAt: Date.now(),
              changeSummary: `${count}件のアカウント情報が家族共有に設定されました`,
              ctaUrl: `${appUrl}/records`,
            },
          },
        },
      );
    }

    return { success: true, count, sharedCount: count };
  },
});

/**
 * 共有レコードを一括共有解除
 */
export const bulkUnshareRecords = familyBoundMutation({
  args: { ids: v.array(v.id("serviceRecords")) },
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const record = await ctx.db.get(id);
      if (
        record &&
        record.ownerType === "family" &&
        isRecordAdmin(ctx.user, record)
      ) {
        await ctx.db.patch(id, {
          ownerType: "user",
          userId: ctx.user.userId,
          accountId: ctx.user._id,
          ownerFamilyId: undefined,
          admins: [],
          updatedAt: Date.now(),
        });
        count++;
      }
    }

    if (count > 0) {
      const family = await ctx.db.get(ctx.familyId);
      const familyName = family?.name ?? "家族";
      const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";

      await ctx.scheduler.runAfter(
        0,
        internal.actions.sendTemplatedEmailInternal,
        {
          email: ctx.user.email,
          payload: {
            template: "shareSettingChanged",
            props: {
              displayName: ctx.user.displayName || "メンバー",
              familyName,
              changedByDisplayName: ctx.user.displayName || "メンバー",
              changedAt: Date.now(),
              changeSummary: `${count}件のアカウント情報の家族共有が解除されました`,
              ctaUrl: `${appUrl}/records`,
            },
          },
        },
      );
    }

    return { success: true, count, unsharedCount: count };
  },
});

/**
 * 選択した家族共有レコードに対して、対象の閲覧者メンバーの管理者設定／解除を一括実行
 */
export const bulkSetRecordAdmin = familyBoundMutation({
  args: {
    ids: v.array(v.id("serviceRecords")),
    targetAccountId: v.id("users"),
    makeAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const targetUser = await ctx.db.get(args.targetAccountId);
    if (!targetUser || targetUser.familyId !== ctx.user.familyId) {
      throw new Error("Target user is not a member of this family");
    }

    if (targetUser.familyRole === "admin") {
      throw new Error("ファミリー管理者の権限は変更できません");
    }

    let count = 0;
    for (const id of args.ids) {
      const record = await ctx.db.get(id);
      if (record?.ownerType !== "family") continue;

      // 実行者に管理権限があるレコードのみ対象
      if (!isRecordAdmin(ctx.user, record)) continue;

      const admins = record.admins ?? [];
      const hasAdmin = admins.includes(args.targetAccountId);

      if (args.makeAdmin && !hasAdmin) {
        await ctx.db.patch(id, {
          admins: [...admins, args.targetAccountId],
          updatedAt: Date.now(),
        });
        count++;
      } else if (!args.makeAdmin && hasAdmin) {
        await ctx.db.patch(id, {
          admins: admins.filter((adminId) => adminId !== args.targetAccountId),
          updatedAt: Date.now(),
        });
        count++;
      }
    }

    return { success: true, count };
  },
});

/**
 * CSVエクスポート用レコード取得（サーバー側で取得と同時に通知をスケジュール・スキップ防止）
 */
export const fetchRecordsForExport = authenticatedMutation({
  args: {
    deviceName: v.optional(v.string()),
    browser: v.optional(v.string()),
    os: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;
    const records = await collectVisibleRecords(ctx, user, true);

    const members = user.familyId
      ? await ctx.db
          .query("users")
          .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
          .collect()
      : [user];
    const emailById = new Map(members.map((m) => [m._id, m.email]));

    const appUrl = process.env.APP_URL || "https://poohma.ciderlabs.link";

    // エクスポート実行通知メールをスケジュール（サーバー側確実発火）
    await ctx.scheduler.runAfter(
      0,
      internal.actions.sendTemplatedEmailInternal,
      {
        email: user.email,
        payload: {
          template: "csvExported",
          props: {
            displayName: user.displayName || "メンバー",
            exportedAt: Date.now(),
            recordCount: records.length,
            deviceName: args.deviceName,
            browser: args.browser,
            os: args.os,
            ipAddress: args.ipAddress,
            location: args.location,
            ctaUrl: `${appUrl}/settings`,
          },
        },
      },
    );

    return Promise.all(
      records.map(async (r) => {
        const admins = getEffectiveAdmins(r);
        const creds = await getCredentialsForRecord(ctx, r._id);
        return {
          ...r,
          stableId: r.stableId,
          credentials: creds.map((c) => ({
            _id: c._id,
            id: c._id,
            stableId: c.stableId,
            label: c.label,
            loginId: c.loginId,
            passwordHint: c.passwordHint,
            passwordHintIv: c.passwordHintIv,
            passwordHintDekEncrypted: c.passwordHintDekEncrypted,
            passwordHintDekIv: c.passwordHintDekIv,
          })),
          adminEmails: (admins ?? [])
            .map((id) => emailById.get(id))
            .filter((email): email is string => !!email),
        };
      }),
    );
  },
});

export const importRecords = familyBoundMutation({
  args: {
    records: v.array(
      v.object({
        title: v.string(),
        titleReading: v.optional(v.string()),
        url: v.optional(v.string()),
        ogpImage: v.optional(v.string()),
        ogpDescription: v.optional(v.string()),
        memo: v.optional(v.string()),
        ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
        admins: v.optional(v.array(v.string())),
        adminEmails: v.optional(v.array(v.string())),
        credentials: v.array(
          v.object({
            id: v.optional(v.string()),
            label: v.optional(v.string()),
            loginId: v.optional(v.string()),
            passwordHint: v.optional(v.string()),
            passwordHintIv: v.optional(v.string()),
            passwordHintDekEncrypted: v.optional(v.string()),
            passwordHintDekIv: v.optional(v.string()),
          }),
        ),
        tags: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;

    if (args.records.length > 500) {
      throw new Error(
        "一度にインポートできるデータは最大500行までです。ファイルを分割して再度お試しください。",
      );
    }

    // 家族内メンバーを事前に取得してメールアドレスからPoohMa IDを逆引き可能にする
    const familyMembers = user.familyId
      ? await ctx.db
          .query("users")
          .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
          .collect()
      : [];

    const emailToAccountMap = new Map<string, Id<"users">[]>();
    for (const m of familyMembers) {
      if (m.email) {
        const lower = m.email.toLowerCase();
        const existing = emailToAccountMap.get(lower) || [];
        existing.push(m._id);
        emailToAccountMap.set(lower, existing);
      }
    }

    const failures: { row: number; reason: string }[] = [];
    let successes = 0;

    for (let i = 0; i < args.records.length; i++) {
      const record = args.records[i];
      try {
        const parsed = ConvexRecordInputSchema.safeParse(record);
        if (!parsed.success) {
          failures.push({
            row: i + 1,
            reason: parsed.error.issues
              .map((issue) => issue.message)
              .join(", "),
          });
          continue;
        }

        const isFamily = record.ownerType === "family";
        const sortKey = computeSortKey({
          titleReading: record.titleReading,
          title: record.title,
        });

        let resolvedAdmins: Id<"users">[] = [];
        if (isFamily) {
          const resolvedSet = new Set<Id<"users">>();
          // インポート実行者を必ず含める
          resolvedSet.add(user._id);

          const candidateEmails = record.adminEmails ?? record.admins ?? [];
          if (candidateEmails.length > 0) {
            for (const email of candidateEmails) {
              const matched = emailToAccountMap.get(email.toLowerCase());
              if (matched) {
                for (const accId of matched) {
                  resolvedSet.add(accId);
                }
              }
            }
          }
          resolvedAdmins = Array.from(resolvedSet);
        }

        const now = Date.now();
        const recordId = await ctx.db.insert("serviceRecords", {
          title: record.title,
          titleReading: record.titleReading,
          url: record.url,
          ogpImage: record.ogpImage,
          ogpDescription: record.ogpDescription,
          memo: record.memo,
          userId: user.userId,
          accountId: user._id,
          familyId: user.familyId,
          sortKey,
          ownerType: isFamily ? "family" : "user",
          ownerFamilyId: isFamily ? user.familyId : undefined,
          admins: resolvedAdmins,
          tags: record.tags,
          stableId: crypto.randomUUID(),
          revision: 0,
          updatedAt: now,
        });

        for (let j = 0; j < record.credentials.length; j++) {
          const cred = record.credentials[j];
          await ctx.db.insert("credentials", {
            recordId,
            stableId: crypto.randomUUID(),
            label: cred.label,
            loginId: cred.loginId,
            passwordHint: cred.passwordHint,
            passwordHintIv: cred.passwordHintIv,
            passwordHintDekEncrypted: cred.passwordHintDekEncrypted,
            passwordHintDekIv: cred.passwordHintDekIv,
            order: j,
            updatedAt: now,
          });
        }

        successes++;
      } catch (_err) {
        failures.push({
          row: i + 1,
          reason: "データベースへの保存時にエラーが発生しました",
        });
      }
    }

    return { successes, failures };
  },
});

export const bulkUpdateRecords = familyBoundMutation({
  args: {
    ids: v.array(v.id("serviceRecords")),
    data: v.object({
      tags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const record = await ctx.db.get(id);
      if (!record) continue;

      requireContentAccess(ctx.user, record);

      if (args.data.tags !== undefined) {
        const newTags = Array.from(
          new Set([...record.tags, ...args.data.tags]),
        );
        if (newTags.length > MAX_TAGS_PER_RECORD) {
          throw new Error(
            `タグは${MAX_TAGS_PER_RECORD}個まで登録できます (レコード「${record.title}」で超過)`,
          );
        }
        await ctx.db.patch(id, {
          tags: newTags,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

// === 同時編集セッション管理（FR-REC-15） ===

export const startEditingSession = familyBoundMutation({
  args: {
    recordId: v.id("serviceRecords"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");

    requireContentAccess(ctx.user, record);

    const now = Date.now();
    const existingSession = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_recordId_accountId", (i) =>
        i.eq("recordId", args.recordId).eq("accountId", ctx.user._id),
      )
      .unique();

    if (existingSession) {
      await ctx.db.patch(existingSession._id, { updatedAt: now });
    } else {
      await ctx.db.insert("recordEditingSessions", {
        recordId: args.recordId,
        accountId: ctx.user._id,
        updatedAt: now,
      });
    }
  },
});

export const heartbeatEditingSession = familyBoundMutation({
  args: {
    recordId: v.id("serviceRecords"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");

    requireContentAccess(ctx.user, record);

    const now = Date.now();
    const existingSession = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_recordId_accountId", (i) =>
        i.eq("recordId", args.recordId).eq("accountId", ctx.user._id),
      )
      .unique();

    if (existingSession) {
      await ctx.db.patch(existingSession._id, { updatedAt: now });
    } else {
      await ctx.db.insert("recordEditingSessions", {
        recordId: args.recordId,
        accountId: ctx.user._id,
        updatedAt: now,
      });
    }
  },
});

export const endEditingSession = familyBoundMutation({
  args: {
    recordId: v.id("serviceRecords"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) return;

    requireContentAccess(ctx.user, record);

    const existingSession = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_recordId_accountId", (i) =>
        i.eq("recordId", args.recordId).eq("accountId", ctx.user._id),
      )
      .unique();

    if (existingSession) {
      await ctx.db.delete(existingSession._id);
    }
  },
});

export const getActiveEditors = authenticatedQuery({
  args: {
    recordId: v.id("serviceRecords"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) return [];

    requireContentAccess(ctx.user, record);

    const sessions = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_recordId", (i) => i.eq("recordId", args.recordId))
      .collect();

    const now = Date.now();
    const activeSessions = sessions.filter(
      (s) => now - s.updatedAt < EDIT_SESSION_TTL_MS,
    );

    const editors = await Promise.all(
      activeSessions.map(async (s) => {
        const userDoc = await ctx.db.get(s.accountId);
        return {
          sessionId: s._id,
          accountId: s.accountId,
          displayName: userDoc?.displayName,
          email: userDoc?.email,
          updatedAt: s.updatedAt,
          isCurrentAccount: s.accountId === ctx.user._id,
        };
      }),
    );

    return editors;
  },
});

export const cleanupExpiredEditingSessionsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EDIT_SESSION_TTL_MS;
    const expiredSessions = await ctx.db
      .query("recordEditingSessions")
      .withIndex("by_updatedAt", (q) => q.lt("updatedAt", cutoff))
      .take(500);

    for (const session of expiredSessions) {
      await ctx.db.delete(session._id);
    }

    return { deletedCount: expiredSessions.length };
  },
});

/** パスワードヒントの閲覧履歴と最終閲覧者を記録する。 */
export const logRecordHintView = familyBoundMutation({
  args: {
    recordId: v.id("serviceRecords"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");

    // 閲覧権限のチェック (個人レコードまたは家族共有)
    requireContentAccess(ctx.user, record);

    const now = Date.now();
    await ctx.db.patch(record._id, {
      lastViewedAt: now,
      lastViewedByAccountId: ctx.user._id,
    });

    await logAuditEvent(ctx, {
      actor: ctx.user,
      record,
      ownerType: record.ownerType ?? "user",
      ownerFamilyId: record.ownerFamilyId,
      targetAccountId: record.accountId,
      action: "HINT_VIEW",
      metadata: {
        targetTitle: record.title,
      },
    });

    return { success: true, viewedAt: now };
  },
});

/** 家族共有レコードの監査ログを新しい順に取得する。 */
export const getFamilyAuditLogs = familyBoundQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { familyId } = ctx;

    const paginatedLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_family_createdAt", (q) => q.eq("familyId", familyId))
      .order("desc")
      .paginate(args.paginationOpts);

    const pageWithActors = await Promise.all(
      paginatedLogs.page.map(async (log) => {
        let actorName = log.actorDisplayName;
        if (log.accountId) {
          const actorDoc = await ctx.db.get(log.accountId);
          if (actorDoc) {
            actorName = actorDoc.displayName || actorDoc.email || actorName;
          }
        }
        return {
          ...log,
          actorDisplayName: actorName,
        };
      }),
    );

    return {
      ...paginatedLogs,
      page: pageWithActors,
    };
  },
});

/** 閲覧権限を確認し、単一レコードの監査ログを新しい順に取得する。 */
export const getRecordAuditLogs = authenticatedQuery({
  args: {
    recordId: v.id("serviceRecords"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);
    if (!record) throw new Error("Record not found");

    requireContentAccess(ctx.user, record);

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_recordId_createdAt", (q) =>
        q.eq("recordId", args.recordId),
      )
      .order("desc")
      .take(limit);

    return await Promise.all(
      logs.map(async (log) => {
        let actorName = log.actorDisplayName;
        if (log.accountId) {
          const actorDoc = await ctx.db.get(log.accountId);
          if (actorDoc) {
            actorName = actorDoc.displayName || actorDoc.email || actorName;
          }
        }
        return {
          ...log,
          actorDisplayName: actorName,
        };
      }),
    );
  },
});

/** 指定日数以上更新されていない、閲覧可能なレコードを取得する。 */
export const getStaleRecords = authenticatedQuery({
  args: {
    staleDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = args.staleDays ?? 180;
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

    const visibleRecords = await collectVisibleRecords(ctx, ctx.user);
    const staleRecords = visibleRecords.filter(
      (record) => !record.isSample && record.updatedAt < threshold,
    );

    return staleRecords.map((r) => ({
      _id: r._id,
      title: r.title,
      ownerType: r.ownerType ?? "user",
      updatedAt: r.updatedAt,
      staleDays: Math.floor((Date.now() - r.updatedAt) / (1000 * 60 * 60 * 24)),
    }));
  },
});

/** 保持期間を超えた監査ログをバッチ単位で削除する。 */
export const cleanupOldAuditLogsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - RETENTION_MS;
    const oldLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(100);

    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
    }

    if (oldLogs.length === 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.records.cleanupOldAuditLogsInternal,
        {},
      );
    }
  },
});

/**
 * CSV差分インポート突合用の軽量レコード取得クエリ
 * patterns.md #15 最小権限原則: 暗号化データ（密文・IV・DEK）は含めず、差分突合に必要な平文メタデータのみを返却
 */
export const getRecordsForDiffImport = authenticatedQuery({
  args: {
    accountId: v.optional(v.id("users")),
  },
  handler: async (ctx) => {
    const { user } = ctx;
    const records = await collectVisibleRecords(ctx, user, true);

    const members = user.familyId
      ? await ctx.db
          .query("users")
          .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
          .collect()
      : [user];
    const emailById = new Map(members.map((m) => [m._id, m.email]));

    return Promise.all(
      records.map(async (r) => {
        const admins = getEffectiveAdmins(r);
        const creds = await getCredentialsForRecord(ctx, r._id);
        return {
          _id: r._id,
          stableId: r.stableId || "",
          title: r.title,
          url: r.url,
          memo: r.memo,
          ownerType: r.ownerType,
          adminEmails: (admins ?? [])
            .map((id) => emailById.get(id))
            .filter((email): email is string => !!email),
          tags: r.tags,
          credentials: creds.map((c) => ({
            _id: c._id,
            stableId: c.stableId || "",
            label: c.label,
            loginId: c.loginId,
            hasPasswordHint: !!(c.passwordHint && c.passwordHintIv),
          })),
        };
      }),
    );
  },
});

/**
 * 差分プレビューで選択・承認された変更を一括反映するミューテーション
 */
export const applyImportDiff = familyBoundMutation({
  args: {
    accountId: v.optional(v.id("users")),
    creates: v.array(
      v.object({
        title: v.string(),
        titleReading: v.optional(v.string()),
        url: v.optional(v.string()),
        ogpImage: v.optional(v.string()),
        ogpDescription: v.optional(v.string()),
        memo: v.optional(v.string()),
        ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
        admins: v.optional(v.array(v.string())),
        adminEmails: v.optional(v.array(v.string())),
        tags: v.array(v.string()),
        credentials: v.array(
          v.object({
            id: v.optional(v.string()),
            label: v.optional(v.string()),
            loginId: v.optional(v.string()),
            passwordHint: v.optional(v.string()),
            passwordHintIv: v.optional(v.string()),
            passwordHintDekEncrypted: v.optional(v.string()),
            passwordHintDekIv: v.optional(v.string()),
          }),
        ),
      }),
    ),
    updates: v.array(
      v.object({
        stableId: v.string(),
        title: v.optional(v.string()),
        titleReading: v.optional(v.string()),
        url: v.optional(v.string()),
        memo: v.optional(v.string()),
        ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
        adminEmails: v.optional(v.array(v.string())),
        tags: v.optional(v.array(v.string())),
        credentials: v.array(
          v.object({
            stableId: v.optional(v.string()),
            label: v.optional(v.string()),
            loginId: v.optional(v.string()),
            passwordHint: v.optional(v.string()),
            passwordHintIv: v.optional(v.string()),
            passwordHintDekEncrypted: v.optional(v.string()),
            passwordHintDekIv: v.optional(v.string()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;
    const totalCount = args.creates.length + args.updates.length;
    if (totalCount > 500) {
      throw new Error(
        "一度に反映できるデータは最大500件までです。ファイルを分割して再度お試しください。",
      );
    }

    // 家族内メンバーの解決マップ構築
    const familyMembers = user.familyId
      ? await ctx.db
          .query("users")
          .withIndex("by_familyId", (q) => q.eq("familyId", user.familyId))
          .collect()
      : [];

    const emailToAccountMap = new Map<string, Id<"users">[]>();
    for (const m of familyMembers) {
      if (m.email) {
        const lower = m.email.toLowerCase();
        const existing = emailToAccountMap.get(lower) || [];
        existing.push(m._id);
        emailToAccountMap.set(lower, existing);
      }
    }

    const now = Date.now();
    let createdCount = 0;
    let updatedCount = 0;

    // 1. CREATE の処理
    for (const item of args.creates) {
      const isFamily = item.ownerType === "family";
      const sortKey = computeSortKey({
        titleReading: item.titleReading,
        title: item.title,
      });

      const resolvedAdmins: Id<"users">[] = [];
      if (isFamily && item.adminEmails && item.adminEmails.length > 0) {
        for (const email of item.adminEmails) {
          const accounts = emailToAccountMap.get(email.toLowerCase());
          if (accounts && accounts.length > 0) {
            resolvedAdmins.push(accounts[0]);
          }
        }
      }

      const recordId = await ctx.db.insert("serviceRecords", {
        title: item.title,
        titleReading: item.titleReading,
        url: item.url,
        ogpImage: item.ogpImage,
        ogpDescription: item.ogpDescription,
        memo: item.memo,
        userId: user.userId,
        accountId: user._id,
        familyId: user.familyId,
        sortKey,
        ownerType: isFamily ? "family" : "user",
        ownerFamilyId: isFamily ? user.familyId : undefined,
        admins: resolvedAdmins,
        tags: item.tags,
        stableId: crypto.randomUUID(),
        revision: 0,
        updatedAt: now,
      });

      for (let j = 0; j < item.credentials.length; j++) {
        const cred = item.credentials[j];
        await ctx.db.insert("credentials", {
          recordId,
          stableId: crypto.randomUUID(),
          label: cred.label,
          loginId: cred.loginId,
          passwordHint: cred.passwordHint,
          passwordHintIv: cred.passwordHintIv,
          passwordHintDekEncrypted: cred.passwordHintDekEncrypted,
          passwordHintDekIv: cred.passwordHintDekIv,
          order: j,
          updatedAt: now,
        });
      }
      createdCount++;
    }

    // 2. UPDATE の処理
    for (const item of args.updates) {
      // stableId で既存レコードを検索
      const record = await ctx.db
        .query("serviceRecords")
        .withIndex("by_family_stableId", (q) =>
          q.eq("familyId", user.familyId).eq("stableId", item.stableId),
        )
        .first();

      if (!record) {
        throw new Error(
          `更新対象のレコードが見つかりません (stableId: ${item.stableId})`,
        );
      }

      // 編集権限の確認
      requireAdminAccess(user, record);

      const patchData: Partial<Doc<"serviceRecords">> = {
        updatedAt: now,
        updatedByAccountId: user._id,
      };

      if (item.title !== undefined) {
        patchData.title = item.title;
        patchData.sortKey = computeSortKey({
          titleReading: item.titleReading ?? record.titleReading,
          title: item.title,
        });
      }
      if (item.titleReading !== undefined) {
        patchData.titleReading = item.titleReading;
        patchData.sortKey = computeSortKey({
          titleReading: item.titleReading,
          title: item.title ?? record.title,
        });
      }
      if (item.url !== undefined) patchData.url = item.url;
      if (item.memo !== undefined) patchData.memo = item.memo;
      if (item.tags !== undefined) patchData.tags = item.tags;

      if (item.ownerType !== undefined) {
        patchData.ownerType = item.ownerType;
        patchData.ownerFamilyId =
          item.ownerType === "family" ? user.familyId : undefined;
      }
      if (item.adminEmails !== undefined) {
        const resolvedAdmins: Id<"users">[] = [];
        for (const email of item.adminEmails) {
          const accounts = emailToAccountMap.get(email.toLowerCase());
          if (accounts && accounts.length > 0) {
            resolvedAdmins.push(accounts[0]);
          }
        }
        patchData.admins = resolvedAdmins;
      }

      await ctx.db.patch(record._id, patchData);

      // クレデンシャルの更新
      const existingCreds = await getCredentialsForRecord(ctx, record._id);
      const credByStableId = new Map(
        existingCreds
          .filter((c) => !!c.stableId)
          .map((c) => [c.stableId as string, c]),
      );

      for (let j = 0; j < item.credentials.length; j++) {
        const credInput = item.credentials[j];
        const targetCred = credInput.stableId
          ? credByStableId.get(credInput.stableId)
          : undefined;

        if (targetCred) {
          // 既存クレデンシャルの更新
          const credPatch: Partial<Doc<"credentials">> = {
            updatedAt: now,
          };
          if (credInput.label !== undefined) credPatch.label = credInput.label;
          if (credInput.loginId !== undefined)
            credPatch.loginId = credInput.loginId;
          if (credInput.passwordHint && credInput.passwordHintIv) {
            credPatch.passwordHint = credInput.passwordHint;
            credPatch.passwordHintIv = credInput.passwordHintIv;
            credPatch.passwordHintDekEncrypted =
              credInput.passwordHintDekEncrypted;
            credPatch.passwordHintDekIv = credInput.passwordHintDekIv;
          }
          await ctx.db.patch(targetCred._id, credPatch);
        } else if (!credInput.stableId) {
          // 新規クレデンシャルの追加
          await ctx.db.insert("credentials", {
            recordId: record._id,
            stableId: crypto.randomUUID(),
            label: credInput.label,
            loginId: credInput.loginId,
            passwordHint: credInput.passwordHint,
            passwordHintIv: credInput.passwordHintIv,
            passwordHintDekEncrypted: credInput.passwordHintDekEncrypted,
            passwordHintDekIv: credInput.passwordHintDekIv,
            order: existingCreds.length + j,
            updatedAt: now,
          });
        }
      }
      updatedCount++;
    }

    if (createdCount > 0 || updatedCount > 0) {
      await logAuditEvent(ctx, {
        actor: user,
        ownerType: "family",
        ownerFamilyId: user.familyId,
        action: "RECORD_UPDATE",
        metadata: {
          detail: `CSV差分インポート (新規作成: ${createdCount}件, 更新: ${updatedCount}件)`,
        },
      });
    }

    return { createdCount, updatedCount };
  },
});
