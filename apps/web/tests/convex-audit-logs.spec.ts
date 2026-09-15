import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { computeSortKey } from "../src/utils/index-group";

const modules = import.meta.glob("../convex/**/*.ts");

describe("監査ログ (Audit Log) & 最終更新者機能の統合テスト", () => {
  // 1. 暗号化境界テスト (Zero-Knowledge)
  it("暗号化境界: レコード作成・更新・閲覧時に auditLogs の metadata に平文ヒントや暗号資材が保存されないこと", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Security Family",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_audit_actor",
        email: "actor@example.com",
        displayName: "監査アクター",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const actorClient = t.withIdentity({
      subject: "user_audit_actor",
      email: "actor@example.com",
    });

    const secretPlainHint = "ThisIsUltraSecretHint123";
    const dummyCipher = "bW9ja0VuY3J5cHRlZEJhc2U2NA==";
    const dummyIv = "bW9ja0l2MTIzNDbJ";

    // 作成実行
    const recordId = await actorClient.mutation(api.records.createRecord, {
      title: "Secret Vault",
      ownerType: "family",
      credentials: [
        {
          label: "Master Account",
          loginId: "admin",
          passwordHint: secretPlainHint,
          passwordHintIv: dummyIv,
          passwordHintDekEncrypted: dummyCipher,
          passwordHintDekIv: dummyIv,
        },
      ],
      tags: ["security"],
    });

    // 更新実行
    await actorClient.mutation(api.records.updateRecord, {
      id: recordId,
      revision: 0,
      data: {
        title: "Secret Vault (Updated)",
        ownerType: "family",
        credentials: [
          {
            label: "Master Account",
            loginId: "admin_updated",
            passwordHint: secretPlainHint,
            passwordHintIv: dummyIv,
            passwordHintDekEncrypted: dummyCipher,
            passwordHintDekIv: dummyIv,
          },
        ],
        tags: ["security", "updated"],
      },
    });

    // ヒント閲覧実行
    await actorClient.mutation(api.records.logRecordHintView, { recordId });

    // auditLogs 全件取得して走査
    await t.run(async (ctx) => {
      const logs = await ctx.db.query("auditLogs").collect();
      expect(logs.length).toBeGreaterThanOrEqual(3);

      for (const log of logs) {
        const serialized = JSON.stringify(log);
        expect(serialized).not.toContain(secretPlainHint);
        expect(serialized).not.toContain(dummyCipher);
        expect(serialized).not.toContain(dummyIv);

        if (log.action === "RECORD_UPDATE") {
          expect(log.metadata?.changedFields).toBeDefined();
          expect(Array.isArray(log.metadata?.changedFields)).toBe(true);
        }
      }
    });
  });

  // 2. 可視性・認可テスト (Drive型ACL)
  it("認可分離: 個人レコードのログは本人のみ閲覧可能であり、共有レコードのログは家族メンバー間で共有されること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let otherFamilyId!: Id<"families">;
    let userAId!: Id<"users">;
    let personalRecordId!: Id<"serviceRecords">;
    let sharedRecordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Shared Family",
        updatedAt: Date.now(),
      });
      otherFamilyId = await ctx.db.insert("families", {
        name: "Attacker Family",
        updatedAt: Date.now(),
      });
      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        displayName: "ユーザーA",
        familyId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_b",
        email: "b@example.com",
        displayName: "ユーザーB",
        familyId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_c_attacker",
        email: "c@example.com",
        displayName: "他家族C",
        familyId: otherFamilyId,
        updatedAt: Date.now(),
      });

      // 個人レコード作成
      personalRecordId = await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "A's Private Bank",
        sortKey: computeSortKey("A's Private Bank"),
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });

      // 家族共有レコード作成
      sharedRecordId = await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "Family Wi-Fi",
        sortKey: computeSortKey("Family Wi-Fi"),
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerType: "family",
        ownerFamilyId: familyId,
        admins: [userAId],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const clientA = t.withIdentity({
      subject: "user_a",
      email: "a@example.com",
    });
    const clientB = t.withIdentity({
      subject: "user_b",
      email: "b@example.com",
    });
    const clientC = t.withIdentity({
      subject: "user_c_attacker",
      email: "c@example.com",
    });

    // A が個人レコードと共有レコードのヒントを閲覧
    await clientA.mutation(api.records.logRecordHintView, {
      recordId: personalRecordId,
    });
    await clientA.mutation(api.records.logRecordHintView, {
      recordId: sharedRecordId,
    });

    // 同一家族の B がレコード別履歴を取得
    const sharedLogsForB = await clientB.query(api.records.getRecordAuditLogs, {
      recordId: sharedRecordId,
    });
    expect(sharedLogsForB).toHaveLength(1);
    expect(sharedLogsForB[0].actorDisplayName).toBe("ユーザーA");
    expect(sharedLogsForB[0].action).toBe("HINT_VIEW");

    // B が A の個人レコードの履歴を取得しようとすると拒否されること
    await expect(
      clientB.query(api.records.getRecordAuditLogs, {
        recordId: personalRecordId,
      }),
    ).rejects.toThrow("Access denied");

    // 他家族の C が共有レコードの履歴を取得しようとすると拒否されること
    await expect(
      clientC.query(api.records.getRecordAuditLogs, {
        recordId: sharedRecordId,
      }),
    ).rejects.toThrow("Access denied");

    // 家族アクティビティ一覧に個人レコードの閲覧ログが含まれないこと
    const familyLogs = await clientB.query(api.records.getFamilyAuditLogs, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const logRecordIds = familyLogs.page.map((l) => l.recordId);
    expect(logRecordIds).toContain(sharedRecordId);
    expect(logRecordIds).not.toContain(personalRecordId);
  });

  // 3. 参照切れフォールバックテスト
  it("参照切れ耐性: ユーザーが退会・アカウント削除された後でも、auditLogs が例外を起こさず表示名を維持すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let deletedUserAccountId!: Id<"users">;
    let remainingUserAccountId!: Id<"users">;
    let sharedRecordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Fallback Test Family",
        updatedAt: Date.now(),
      });
      deletedUserAccountId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_to_be_deleted",
        email: "deleted@example.com",
        displayName: "退会予定パパ",
        familyId,
        updatedAt: Date.now(),
      });
      remainingUserAccountId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_remaining",
        email: "remaining@example.com",
        displayName: "残存ママ",
        familyId,
        updatedAt: Date.now(),
      });

      sharedRecordId = await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "Shared Account",
        sortKey: computeSortKey("Shared Account"),
        userId: "user_to_be_deleted",
        accountId: deletedUserAccountId,
        familyId,
        ownerType: "family",
        ownerFamilyId: familyId,
        admins: [deletedUserAccountId, remainingUserAccountId],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const deletedClient = t.withIdentity({
      subject: "user_to_be_deleted",
      email: "deleted@example.com",
    });
    const remainingClient = t.withIdentity({
      subject: "user_remaining",
      email: "remaining@example.com",
    });

    // 退会予定ユーザーがログを生成
    await deletedClient.mutation(api.records.logRecordHintView, {
      recordId: sharedRecordId,
    });

    // ユーザーが退会（deleteAccount）
    await deletedClient.mutation(api.users.deleteAccount, {});

    // 残存ユーザーが家族アクティビティを取得
    const familyLogs = await remainingClient.query(
      api.records.getFamilyAuditLogs,
      {
        paginationOpts: { numItems: 10, cursor: null },
      },
    );

    expect(familyLogs.page.length).toBeGreaterThan(0);
    const targetLog = familyLogs.page.find(
      (l) => l.recordId === sharedRecordId,
    );
    expect(targetLog).toBeDefined();
    // 参照切れ時でもスナップショットされた表示名が返却されること
    expect(targetLog?.actorDisplayName).toBe("退会予定パパ");
  });

  // 4. 長期間未更新レコード抽出テスト (FR-REC-16)
  it("長期間未更新判定: 180日以上更新がないレコードのみが getStaleRecords で抽出されること", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const oneHundredEightyOneDaysAgo = now - 181 * 24 * 60 * 60 * 1000;
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

    let userAccountId!: Id<"users">;

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Stale Test Family",
        updatedAt: now,
      });
      userAccountId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_stale",
        email: "stale@example.com",
        familyId,
        updatedAt: now,
      });

      // 181日前の古いレコード
      await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "Old Untouched Record",
        sortKey: computeSortKey("Old Untouched Record"),
        userId: "user_stale",
        accountId: userAccountId,
        familyId,
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: oneHundredEightyOneDaysAgo,
      });

      // 10日前の新しいレコード
      await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "Fresh Record",
        sortKey: computeSortKey("Fresh Record"),
        userId: "user_stale",
        accountId: userAccountId,
        familyId,
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: tenDaysAgo,
      });

      // サンプルレコード（抽出対象外）
      await ctx.db.insert("serviceRecords", {
        stableId: crypto.randomUUID(),
        title: "Sample Old Record",
        sortKey: computeSortKey("Sample Old Record"),
        userId: "user_stale",
        accountId: userAccountId,
        familyId,
        ownerType: "user",
        admins: [],
        tags: [],
        isSample: true,
        updatedAt: oneHundredEightyOneDaysAgo,
      });
    });

    const client = t.withIdentity({
      subject: "user_stale",
      email: "stale@example.com",
    });

    const staleRecords = await client.query(api.records.getStaleRecords, {
      staleDays: 180,
    });

    expect(staleRecords).toHaveLength(1);
    expect(staleRecords[0].title).toBe("Old Untouched Record");
    expect(staleRecords[0].staleDays).toBeGreaterThanOrEqual(180);
  });

  // 5. クリーンアップ Cron テスト
  it("ライフサイクル: 180日以上前の古い監査ログが cleanupOldAuditLogsInternal で削除されること", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const oneHundredEightyOneDaysAgo = now - 181 * 24 * 60 * 60 * 1000;
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

    let oldLogId!: Id<"auditLogs">;
    let recentLogId!: Id<"auditLogs">;

    await t.run(async (ctx) => {
      oldLogId = await ctx.db.insert("auditLogs", {
        userId: "test_user",
        actorDisplayName: "テストアクター",
        ownerType: "family",
        action: "RECORD_UPDATE",
        createdAt: oneHundredEightyOneDaysAgo,
      });

      recentLogId = await ctx.db.insert("auditLogs", {
        userId: "test_user",
        actorDisplayName: "テストアクター",
        ownerType: "family",
        action: "RECORD_UPDATE",
        createdAt: tenDaysAgo,
      });
    });

    // 定期クリーンアップ実行
    await t.mutation(internal.records.cleanupOldAuditLogsInternal, {});

    await t.run(async (ctx) => {
      expect(await ctx.db.get(oldLogId)).toBeNull();
      expect(await ctx.db.get(recentLogId)).not.toBeNull();
    });
  });
});
