import { v } from "convex/values";
import { computeSortKey } from "../src/utils/index-group";
import type { Id } from "./_generated/dataModel";
import { authenticatedMutation, familyBoundMutation } from "./customBuilders";
import { deleteCredentialsForRecord } from "./records";

/**
 * オンボーディング完了状態を記録
 * 既存の onboardingVersion より大きいバージョンのみを反映（巻き戻し防止）
 */
export const completeOnboarding = authenticatedMutation({
  args: {
    accountId: v.optional(v.id("users")),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const { user } = ctx;
    const currentVersion = user.onboardingVersion ?? 0;

    if (args.version > currentVersion) {
      await ctx.db.patch(user._id, {
        onboardingVersion: args.version,
        updatedAt: Date.now(),
      });
    }

    return {
      success: true,
      onboardingVersion: Math.max(currentVersion, args.version),
    };
  },
});

/**
 * クライアント側で暗号化されたサンプルレコードを一括投入
 */
export const insertSampleRecords = familyBoundMutation({
  args: {
    accountId: v.optional(v.id("users")),
    records: v.array(
      v.object({
        title: v.string(),
        titleReading: v.optional(v.string()),
        url: v.optional(v.string()),
        ogpImage: v.optional(v.string()),
        ogpDescription: v.optional(v.string()),
        memo: v.optional(v.string()),
        tags: v.array(v.string()),
        ownerType: v.optional(v.union(v.literal("user"), v.literal("family"))),
        credentials: v.array(
          v.object({
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
    const { user, familyId } = ctx;

    // 1. 同一家族の既存サンプルレコードを取得
    const familySamples = await ctx.db
      .query("serviceRecords")
      .withIndex("by_family_isSample", (q) =>
        q.eq("familyId", familyId).eq("isSample", true),
      )
      .collect();

    // 2. クリーンアップ対象の選別:
    //    - 家族共有サンプル (ownerType === "family") は家族単位で重複を防ぐため削除
    //    - 個人所有サンプル (ownerType === "user") は操作中アカウントのもののみ削除
    const recordsToDelete = familySamples.filter(
      (r) => r.ownerType === "family" || r.accountId === user._id,
    );

    for (const record of recordsToDelete) {
      await deleteCredentialsForRecord(ctx, record._id);
      await ctx.db.delete(record._id);
    }

    const now = Date.now();
    const createdRecordIds: Id<"serviceRecords">[] = [];

    for (const recordData of args.records) {
      const isFamily = recordData.ownerType !== "user";
      const sortKey = computeSortKey({
        titleReading: recordData.titleReading,
        title: recordData.title,
      });

      const recordId = await ctx.db.insert("serviceRecords", {
        title: recordData.title,
        titleReading: recordData.titleReading,
        url: recordData.url,
        ogpImage: recordData.ogpImage,
        ogpDescription: recordData.ogpDescription,
        memo: recordData.memo,
        userId: user.userId,
        accountId: user._id,
        familyId,
        sortKey,
        ownerType: isFamily ? "family" : "user",
        ownerFamilyId: isFamily ? familyId : undefined,
        admins: isFamily ? [user._id] : [],
        tags: recordData.tags,
        stableId: crypto.randomUUID(),
        isSample: true,
        revision: 0,
        updatedAt: now,
      });

      // credentials テーブルへ挿入
      for (let i = 0; i < recordData.credentials.length; i++) {
        const c = recordData.credentials[i];
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

      createdRecordIds.push(recordId);
    }

    return { recordIds: createdRecordIds };
  },
});

/**
 * 当該ファミリー内のサンプルデータ（isSample === true）を一括削除
 */
export const purgeSampleData = familyBoundMutation({
  args: {
    accountId: v.optional(v.id("users")),
  },
  handler: async (ctx) => {
    const { familyId } = ctx;
    const sampleRecords = await ctx.db
      .query("serviceRecords")
      .withIndex("by_family_isSample", (q) =>
        q.eq("familyId", familyId).eq("isSample", true),
      )
      .collect();

    let deletedCount = 0;
    for (const record of sampleRecords) {
      // サンプルレコードかつ同一家族であることを保証し、通常レコード用の strict な requireAdminAccess はバイパスする
      if (record.familyId !== familyId || !record.isSample) {
        continue;
      }
      await deleteCredentialsForRecord(ctx, record._id);
      await ctx.db.delete(record._id);
      deletedCount++;
    }

    return { deletedCount };
  },
});
