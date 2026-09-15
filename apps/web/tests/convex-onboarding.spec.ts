import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

describe("オンボーディング Convexバックエンドテスト", () => {
  it("completeOnboarding: バージョンが正しく更新され、巻き戻しが防止されること", async () => {
    const t = convexTest(schema, modules);

    let userId!: Id<"users">;
    await t.run(async (ctx) => {
      userId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_test",
        email: "user@example.com",
        updatedAt: Date.now(),
      });
    });

    const asUser = t.withIdentity({ subject: "user_test" });

    // 初回完了: version 1
    const res1 = await asUser.mutation(api.onboarding.completeOnboarding, {
      version: 1,
    });
    expect(res1.success).toBe(true);
    expect(res1.onboardingVersion).toBe(1);

    const userAfter1 = await t.run(async (ctx) => ctx.db.get(userId));
    expect(userAfter1?.onboardingVersion).toBe(1);

    // 巻き戻し試行: version 0 -> 反映されず1のまま
    const res2 = await asUser.mutation(api.onboarding.completeOnboarding, {
      version: 0,
    });
    expect(res2.success).toBe(true);
    expect(res2.onboardingVersion).toBe(1);

    const userAfter2 = await t.run(async (ctx) => ctx.db.get(userId));
    expect(userAfter2?.onboardingVersion).toBe(1);

    // バージョンアップ: version 2
    const res3 = await asUser.mutation(api.onboarding.completeOnboarding, {
      version: 2,
    });
    expect(res3.success).toBe(true);
    expect(res3.onboardingVersion).toBe(2);

    const userAfter3 = await t.run(async (ctx) => ctx.db.get(userId));
    expect(userAfter3?.onboardingVersion).toBe(2);
  });

  it("insertSampleRecords & purgeSampleData: サンプルレコードが投入され、isSampleのみ一括削除されること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;
    let userId!: Id<"users">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });
      userId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_family_member",
        email: "member@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      // 既存の通常レコード（非サンプル）を作成しておく
      const normalRecordId = await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "通常のサービス",
        userId: "user_family_member",
        accountId: userId,
        familyId,
        sortKey: "つ",
        ownerType: "user",
        admins: [],
        tags: ["通常"],
        isSample: false,
        revision: 0,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("credentials", {
        recordId: normalRecordId,
        stableId: crypto.randomUUID(),
        label: "本物アカウント",
        loginId: "real_user",
        order: 0,
        updatedAt: Date.now(),
      });
    });

    const asUser = t.withIdentity({ subject: "user_family_member" });

    // サンプルレコード投入
    const insertRes = await asUser.mutation(
      api.onboarding.insertSampleRecords,
      {
        records: [
          {
            title: "【サンプル】オンライン動画サービス",
            titleReading: "おんらいんどうがさーびす",
            url: "https://example.com/video",
            tags: ["サンプル", "エンタメ"],
            ownerType: "family",
            credentials: [
              {
                label: "家族共有アカウント",
                loginId: "family_sample@example.com",
                passwordHint: "家族共通パスワード",
              },
            ],
          },
          {
            title: "【サンプル】ネットバンキング",
            titleReading: "ねっとばんきんぐ",
            tags: ["サンプル", "金融"],
            ownerType: "user",
            credentials: [
              {
                label: "代表口座",
                loginId: "user_bank_sample",
              },
            ],
          },
        ],
      },
    );

    expect(insertRes.recordIds).toHaveLength(2);

    // DB内に投入されたレコードとcredentialsを確認
    await t.run(async (ctx) => {
      const samples = await ctx.db
        .query("serviceRecords")
        .withIndex("by_family_isSample", (q) =>
          q.eq("familyId", familyId).eq("isSample", true),
        )
        .collect();
      expect(samples).toHaveLength(2);

      for (const r of samples) {
        const creds = await ctx.db
          .query("credentials")
          .withIndex("by_recordId", (q) => q.eq("recordId", r._id))
          .collect();
        expect(creds.length).toBeGreaterThan(0);
      }
    });

    // purgeSampleData の実行
    const purgeRes = await asUser.mutation(api.onboarding.purgeSampleData, {});
    expect(purgeRes.deletedCount).toBe(2);

    // サンプルレコードがすべて削除され、通常レコードとcredentialsは残っていること
    await t.run(async (ctx) => {
      const remainingSamples = await ctx.db
        .query("serviceRecords")
        .withIndex("by_family_isSample", (q) =>
          q.eq("familyId", familyId).eq("isSample", true),
        )
        .collect();
      expect(remainingSamples).toHaveLength(0);

      const normalRecords = await ctx.db
        .query("serviceRecords")
        .withIndex("by_family_sortKey", (q) => q.eq("familyId", familyId))
        .collect();
      expect(normalRecords).toHaveLength(1);
      expect(normalRecords[0].title).toBe("通常のサービス");

      const normalCreds = await ctx.db
        .query("credentials")
        .withIndex("by_recordId", (q) => q.eq("recordId", normalRecords[0]._id))
        .collect();
      expect(normalCreds).toHaveLength(1);
      expect(normalCreds[0].loginId).toBe("real_user");
    });
  });
});
