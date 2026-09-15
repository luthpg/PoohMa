import { EventEmitter } from "node:events";
import type http from "node:http";
import https from "node:https";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { computeSortKey } from "../src/utils/index-group";

const modules = import.meta.glob("../convex/**/*.ts");

// E2EE url-safety のモック
vi.mock("../src/utils/url-safety", () => {
  return {
    validateUrlSafety: vi.fn().mockResolvedValue("93.184.216.34"),
    isPrivateIp: vi.fn().mockReturnValue(false),
  };
});

// node:http / node:https のモック
vi.mock("node:http", () => {
  return {
    default: {
      request: vi.fn(),
    },
  };
});
vi.mock("node:https", () => {
  return {
    default: {
      request: vi.fn(),
    },
  };
});

describe("2.2.1 閲覧権限（ownerType）の境界値テスト (Convex版)", () => {
  it("「自分のみ (user)」「家族と共有 (family)」の設定が、DBクエリレベルで正しくフィルタリングされること", async () => {
    const t = convexTest(schema, modules);

    let family1Id!: Id<"families">;
    let userAId!: Id<"users">;

    // 1. 初期シードデータのインサート
    await t.run(async (ctx) => {
      // 家族1
      family1Id = await ctx.db.insert("families", {
        name: "Family 1",
        updatedAt: Date.now(),
      });

      // ユーザーA と ユーザーB (家族1所属)
      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId: family1Id,
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_b",
        email: "b@example.com",
        familyId: family1Id,
        updatedAt: Date.now(),
      });

      // ユーザーC (家族未所属)
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_c",
        email: "c@example.com",
        updatedAt: Date.now(),
      });

      // Aが個人レコードを作成
      await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId: family1Id,
        title: "Private Record A",
        sortKey: computeSortKey("Private Record A"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });

      // Aが家族共有レコードを作成
      await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId: family1Id,
        ownerFamilyId: family1Id,
        title: "Shared Record A",
        sortKey: computeSortKey("Shared Record A"),
        ownerType: "family",
        admins: [userAId],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    // ユーザーA自身のコンテキストでクエリ
    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const resA = await userA.query(api.records.getRecords, {});
    expect(resA).toHaveLength(2);

    // ユーザーBのコンテキストでクエリ (family共有レコードのみ取得できること)
    const userB = t.withIdentity({ subject: "user_b", email: "b@example.com" });
    const resB = await userB.query(api.records.getRecords, {});
    expect(resB).toHaveLength(1);
    expect(resB[0].title).toBe("Shared Record A");

    // ユーザーCのコンテキストでクエリ (取得できないこと)
    const userC = t.withIdentity({ subject: "user_c", email: "c@example.com" });
    const resC = await userC.query(api.records.getRecords, {});
    expect(resC).toHaveLength(0);
  });
});

describe("2.2.2. OGP取得処理のフェイルセーフとタイムアウト (Convex版)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("正常系", () => {
    it("正しい OGP メタタグを持つ HTML から、タイトル・画像・説明文を抽出できること", async () => {
      const mockHtml = `
        <html>
          <head>
            <meta property="og:title" content="テストサービスタイトル" />
            <meta property="og:image" content="https://example.com/ogp.png" />
            <meta property="og:description" content="テストサービスの詳細説明文です。" />
          </head>
        </html>
      `;

      vi.mocked(https.request).mockImplementation(
        (_options: unknown, callback: unknown) => {
          const mockReq = Object.assign(new EventEmitter(), {
            end: () => {
              process.nextTick(() => {
                const mockRes = Object.assign(new EventEmitter(), {
                  statusCode: 200,
                  headers: {},
                }) as unknown as http.IncomingMessage;

                (callback as (res: http.IncomingMessage) => void)(mockRes);

                mockRes.emit("data", Buffer.from(mockHtml));
                mockRes.emit("end");
              });
            },
            destroy: vi.fn(),
          });
          return mockReq as unknown as http.ClientRequest;
        },
      );

      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "user_ogp",
        email: "ogp@example.com",
      });
      const res = await user.action(api.actions.getOgpInfo, {
        url: "https://example.com",
      });

      expect(res.title).toBe("テストサービスタイトル");
      expect(res.image).toBe("https://example.com/ogp.png");
      expect(res.description).toBe("テストサービスの詳細説明文です。");
    });
  });
});

describe("2.2.3 CSVインポートのバリデーションと境界値 (Convex版)", () => {
  it("正常なデータ行と不正なデータ行が混在する場合、部分インポートが行われ失敗詳細が返ること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "CSV Test Family",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "csv_user",
        email: "csv@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "csv_user",
      email: "csv@example.com",
    });

    // 正常2件 + タイトル空の不正1件
    const rows = [
      {
        title: "Netflix",
        url: "https://netflix.com",
        ownerType: "user" as const,
        credentials: [],
        tags: [],
      },
      {
        title: "",
        url: "https://invalid.com",
        ownerType: "user" as const,
        credentials: [],
        tags: [],
      }, // タイトル空 → 失敗
      {
        title: "Amazon Prime",
        url: "https://amazon.co.jp",
        ownerType: "family" as const,
        adminEmails: ["csv@example.com"],
        credentials: [],
        tags: [],
      },
    ];

    const result = await user.mutation(api.records.importRecords, {
      records: rows,
    });

    expect(result.successes).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].row).toBe(2);
    expect(result.failures[0].reason).toContain("タイトル");

    // DBに2件登録されていること
    await t.run(async (ctx) => {
      const records = await ctx.db
        .query("serviceRecords")
        .withIndex("by_userId", (q) => q.eq("userId", "csv_user"))
        .collect();
      expect(records).toHaveLength(2);
      const titles = records.map((r) => r.title).sort();
      expect(titles).toEqual(["Amazon Prime", "Netflix"]);
    });
  });

  it("501件のデータを渡した場合、500件上限エラーがスローされること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Limit Test Family",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "limit_user",
        email: "limit@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "limit_user",
      email: "limit@example.com",
    });

    const rows = Array.from({ length: 501 }, (_, i) => ({
      title: `Record ${i + 1}`,
      ownerType: "user" as const,
      credentials: [],
      tags: [],
    }));

    await expect(
      user.mutation(api.records.importRecords, { records: rows }),
    ).rejects.toThrow("最大500行");
  });

  it("家族未所属のユーザーが実行した場合、エラーがスローされること", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "no_family_user",
        email: "nofamily@example.com",
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "no_family_user",
      email: "nofamily@example.com",
    });

    const rows = [
      {
        title: "Test",
        ownerType: "user" as const,
        credentials: [],
        tags: [],
      },
    ];

    await expect(
      user.mutation(api.records.importRecords, { records: rows }),
    ).rejects.toThrow("User does not belong to a family");
  });

  it("タグ数が上限（20個）を超える行はインポートに失敗し、詳細が返ること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Tag Limit Test Family",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "tag_limit_user",
        email: "taglimit@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "tag_limit_user",
      email: "taglimit@example.com",
    });

    const rows = [
      {
        title: "20 Tags Record",
        ownerType: "user" as const,
        credentials: [],
        tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
      },
      {
        title: "21 Tags Record",
        ownerType: "user" as const,
        credentials: [],
        tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      },
    ];

    const result = await user.mutation(api.records.importRecords, {
      records: rows,
    });

    expect(result.successes).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].row).toBe(2);
    expect(result.failures[0].reason).toContain("20個まで");
  });
});

describe("Drive型ACLモデルのCRUDと共有機能テスト", () => {
  it("getOwnedRecords は自分が所有する個人レコードと自分が管理者である共有レコードを返し、adminEmailsを付与すること", async () => {
    const t = convexTest(schema, modules);
    let family1Id!: Id<"families">;
    let userAId!: Id<"users">;
    let userBId!: Id<"users">;

    await t.run(async (ctx) => {
      family1Id = await ctx.db.insert("families", {
        name: "Family 1",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId: family1Id,
        updatedAt: Date.now(),
      });

      userBId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_b",
        email: "b@example.com",
        familyId: family1Id,
        updatedAt: Date.now(),
      });

      // User A personal record
      await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId: family1Id,
        title: "A's Private",
        sortKey: computeSortKey("A's Private"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });

      // User B shared record where only B is admin
      await ctx.db.insert("serviceRecords", {
        userId: "user_b",
        accountId: userBId,
        familyId: family1Id,
        ownerFamilyId: family1Id,
        title: "B's Shared",
        sortKey: computeSortKey("B's Shared"),
        ownerType: "family",
        admins: [userBId],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });

    // getRecords returns both
    const allRecords = await userA.query(api.records.getRecords, {});
    expect(allRecords).toHaveLength(2);

    // getOwnedRecords returns only records manageable by A (A's Private)
    const ownedRecords = await userA.query(api.records.getOwnedRecords, {});
    expect(ownedRecords).toHaveLength(1);
    expect(ownedRecords[0].title).toBe("A's Private");
    expect(ownedRecords[0].adminEmails).toBeDefined();
  });

  it("ワンタップ共有 (shareRecord) とワンタップ解除 (unshareRecord) が正しく動作すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let recordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "viewer",
        userId: "user_b",
        email: "b@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        title: "Record To Share",
        sortKey: computeSortKey("Record To Share"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const userB = t.withIdentity({ subject: "user_b", email: "b@example.com" });

    // 共有前: B は閲覧不可
    await expect(
      userB.query(api.records.getRecordDetail, { id: recordId }),
    ).rejects.toThrow("Access denied");

    // A がワンタップ共有
    await userA.mutation(api.records.shareRecord, { id: recordId });

    // 共有後: B も閲覧可能
    const sharedDetail = await userB.query(api.records.getRecordDetail, {
      id: recordId,
    });
    expect(sharedDetail.title).toBe("Record To Share");

    // B は管理者ではないため unshare 不可
    await expect(
      userB.mutation(api.records.unshareRecord, { id: recordId }),
    ).rejects.toThrow("Access denied");

    // A は管理者なので unshare 可能
    await userA.mutation(api.records.unshareRecord, { id: recordId });

    // 解除後: B は再度閲覧不可
    await expect(
      userB.query(api.records.getRecordDetail, { id: recordId }),
    ).rejects.toThrow("Access denied");
  });

  it("管理者追加 (addRecordAdmin) と管理者解除 (removeRecordAdmin) が正しく動作すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let userBId!: Id<"users">;
    let sharedRecordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      userBId = await ctx.db.insert("users", {
        familyRole: "viewer",
        userId: "user_b",
        email: "b@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      sharedRecordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "Shared Record",
        sortKey: computeSortKey("Shared Record"),
        ownerType: "family",
        admins: [userAId],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const userB = t.withIdentity({ subject: "user_b", email: "b@example.com" });

    // A が B を管理者に昇格
    await userA.mutation(api.records.addRecordAdmin, {
      id: sharedRecordId,
      targetAccountId: userBId,
    });

    // B を管理者から解除
    await userA.mutation(api.records.removeRecordAdmin, {
      id: sharedRecordId,
      targetAccountId: userBId,
    });

    // B は解除されたので削除不可（Access denied）
    await expect(
      userB.mutation(api.records.deleteRecord, { id: sharedRecordId }),
    ).rejects.toThrow("Access denied");

    // A は管理者のままなので削除可能
    await expect(
      userA.mutation(api.records.deleteRecord, { id: sharedRecordId }),
    ).resolves.not.toThrow();
  });

  it("一括共有 (bulkShareRecords) と一括解除 (bulkUnshareRecords) が正しく動作すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let r1Id!: Id<"serviceRecords">;
    let r2Id!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      r1Id = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        title: "R1",
        sortKey: computeSortKey("R1"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });

      r2Id = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        title: "R2",
        sortKey: computeSortKey("R2"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });

    // 一括共有
    const shareRes = await userA.mutation(api.records.bulkShareRecords, {
      ids: [r1Id, r2Id],
    });
    expect(shareRes.sharedCount).toBe(2);

    await t.run(async (ctx) => {
      const r1 = await ctx.db.get(r1Id);
      expect(r1?.ownerType).toBe("family");

      const r2 = await ctx.db.get(r2Id);
      expect(r2?.ownerType).toBe("family");
    });

    const detail1 = await userA.query(api.records.getRecordDetail, {
      id: r1Id,
    });
    expect(detail1.adminUsers?.some((u) => u._id === userAId)).toBe(true);

    // 一括解除
    const unshareRes = await userA.mutation(api.records.bulkUnshareRecords, {
      ids: [r1Id, r2Id],
    });
    expect(unshareRes.unsharedCount).toBe(2);

    await t.run(async (ctx) => {
      const r1 = await ctx.db.get(r1Id);
      expect(r1?.ownerType).toBe("user");
      expect(r1?.admins).toEqual([]);

      const r2 = await ctx.db.get(r2Id);
      expect(r2?.ownerType).toBe("user");
      expect(r2?.admins).toEqual([]);
    });
  });

  it("Zodによる文字数制限バリデーションが機能し、違反した入力ではエラーが返ること", async () => {
    const t = convexTest(schema, modules);
    let family1Id!: Id<"families">;

    await t.run(async (ctx) => {
      family1Id = await ctx.db.insert("families", {
        name: "Family 1",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId: family1Id,
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });

    // Title exceeds 255 chars
    await expect(
      userA.mutation(api.records.createRecord, {
        title: "a".repeat(256),
        ownerType: "user",
        credentials: [],
        tags: [],
      }),
    ).rejects.toThrow("Validation failed");

    // Credential label exceeds 100 chars
    await expect(
      userA.mutation(api.records.createRecord, {
        title: "Valid Title",
        ownerType: "user",
        credentials: [
          {
            id: "cred1",
            label: "a".repeat(101),
          },
        ],
        tags: [],
      }),
    ).rejects.toThrow("Validation failed");
  });

  it("updateRecord で titleReading を指定しない更新を行った場合、既存の titleReading が保持されること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let recordId!: Id<"serviceRecords">;
    let userAId!: Id<"users">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        title: "Amazon",
        titleReading: "あまぞん",
        sortKey: computeSortKey("Amazon", "あまぞん"),
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });

    // titleReading を含めずに更新を実行
    await userA.mutation(api.records.updateRecord, {
      id: recordId,
      revision: 0,
      data: {
        title: "Amazon Renewed",
        ownerType: "user",
        credentials: [],
        tags: [],
      },
    });

    await t.run(async (ctx) => {
      const updated = await ctx.db.get(recordId);
      expect(updated?.title).toBe("Amazon Renewed");
      expect(updated?.titleReading).toBe("あまぞん");
    });
  });
});

describe("件数境界値テスト", () => {
  it("createRecordで11件のcredentialsを送信するとバリデーションエラーになること", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_cap",
        email: "cap@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "user_cap",
      email: "cap@example.com",
    });

    await expect(
      user.mutation(api.records.createRecord, {
        title: "Too many credentials",
        ownerType: "user",
        credentials: Array.from({ length: 11 }, (_, i) => ({
          id: `cred_${i}`,
          label: `Cred${i}`,
        })),
        tags: [],
      }),
    ).rejects.toThrow("Validation failed");
  });

  it("createRecordで10件ちょうどのcredentialsは登録できること", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Test Family",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_cap2",
        email: "cap2@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "user_cap2",
      email: "cap2@example.com",
    });

    await expect(
      user.mutation(api.records.createRecord, {
        title: "Exactly 10 credentials",
        ownerType: "user",
        credentials: Array.from({ length: 10 }, (_, i) => ({
          id: `cred_${i}`,
          label: `Cred${i}`,
        })),
        tags: [],
      }),
    ).resolves.toBeDefined();
  });

  it("createCredential: 途中のクレデンシャル削除後もorderが重複せず既存の最大値+1で採番されること", async () => {
    const t = convexTest(schema, modules);
    let recordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Order Test Family",
        updatedAt: Date.now(),
      });
      const accountId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_order",
        email: "order@example.com",
        familyId,
        updatedAt: Date.now(),
      });
      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_order",
        accountId,
        familyId,
        title: "Order Test Record",
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "user_order",
      email: "order@example.com",
    });

    // 2件追加 (order: 0, 1)
    const cred0Id = await user.mutation(api.records.createCredential, {
      recordId,
      label: "Cred 0",
    });
    const cred1Id = await user.mutation(api.records.createCredential, {
      recordId,
      label: "Cred 1",
    });

    // 最初の1件（order: 0）を削除（残るは order: 1 のみ、件数1）
    await user.mutation(api.records.deleteCredential, { id: cred0Id });

    // 新たに1件追加（件数ベースだと 1 になり重複するが、max+1 なら 2 になる）
    const cred2Id = await user.mutation(api.records.createCredential, {
      recordId,
      label: "Cred 2",
    });

    await t.run(async (ctx) => {
      const cred1 = await ctx.db.get(cred1Id);
      const cred2 = await ctx.db.get(cred2Id);
      expect(cred1?.order).toBe(1);
      expect(cred2?.order).toBe(2);
    });
  });
});

describe("2.2.8 CSVエクスポート（fetchRecordsForExport）の権限・整合性検証", () => {
  it("未認証時に Unauthenticated エラーをスローすること", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.records.fetchRecordsForExport, {}),
    ).rejects.toThrow("Unauthenticated");
  });

  it("自身の所有レコード（個人・自身が管理者の家族レコード）のみ取得され、クレデンシャルと管理者メールが付与されること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let userBId!: Id<"users">;
    let personalRecAId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Export Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_export_a",
        email: "export_a@example.com",
        displayName: "エクスポートA",
        familyId,
        updatedAt: Date.now(),
      });

      userBId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_export_b",
        email: "export_b@example.com",
        displayName: "エクスポートB",
        familyId,
        updatedAt: Date.now(),
      });

      // Aの個人レコード
      personalRecAId = await ctx.db.insert("serviceRecords", {
        title: "A Personal Record",
        userId: "user_export_a",
        accountId: userAId,
        familyId,
        ownerType: "user",
        tags: [],
        updatedAt: Date.now(),
      });

      // Aが管理者の家族共有レコード
      await ctx.db.insert("serviceRecords", {
        title: "Shared Admin A Record",
        userId: "user_export_a",
        accountId: userAId,
        familyId,
        ownerType: "family",
        ownerFamilyId: familyId,
        admins: [userAId],
        tags: [],
        updatedAt: Date.now(),
      });

      // Bが管理者の家族共有レコード（Aは管理者ではない）
      await ctx.db.insert("serviceRecords", {
        title: "Shared Admin B Record",
        userId: "user_export_b",
        accountId: userBId,
        familyId,
        ownerType: "family",
        ownerFamilyId: familyId,
        admins: [userBId],
        tags: [],
        updatedAt: Date.now(),
      });

      // Bの個人レコード
      await ctx.db.insert("serviceRecords", {
        title: "B Personal Record",
        userId: "user_export_b",
        accountId: userBId,
        familyId,
        ownerType: "user",
        tags: [],
        updatedAt: Date.now(),
      });

      // Aの個人レコードにクレデンシャルを追加
      await ctx.db.insert("credentials", {
        recordId: personalRecAId,
        label: "Main Login",
        loginId: "a_login_id",
        passwordHint: "hint_text",
        passwordHintIv: "iv_text",
        order: 0,
        updatedAt: Date.now(),
      });
    });

    const userAClient = t.withIdentity({
      subject: "user_export_a",
      email: "export_a@example.com",
    });

    // ユーザーAでエクスポート実行
    const results = await userAClient.mutation(
      api.records.fetchRecordsForExport,
      {
        accountId: userAId,
        deviceName: "Test Device",
        browser: "Chrome",
        os: "Windows",
      },
    );

    // Aの個人レコードとAが管理者の家族レコードの2件のみ取得されること
    expect(results).toHaveLength(2);
    const titles = results.map((r) => r.title);
    expect(titles).toContain("A Personal Record");
    expect(titles).toContain("Shared Admin A Record");
    expect(titles).not.toContain("Shared Admin B Record");
    expect(titles).not.toContain("B Personal Record");

    // クレデンシャルと管理者メールの検証
    const personalRec = results.find((r) => r.title === "A Personal Record");
    expect(personalRec?.credentials).toHaveLength(1);
    expect(personalRec?.credentials[0].loginId).toBe("a_login_id");

    const sharedRec = results.find((r) => r.title === "Shared Admin A Record");
    expect(sharedRec?.adminEmails).toEqual(["export_a@example.com"]);
  });

  it("他人の accountId を指定した場合は Unauthorized で拒否されること", async () => {
    const t = convexTest(schema, modules);

    let userBId!: Id<"users">;

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_legit_a",
        email: "legit_a@example.com",
        updatedAt: Date.now(),
      });

      userBId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_victim_b",
        email: "victim_b@example.com",
        updatedAt: Date.now(),
      });
    });

    const userAClient = t.withIdentity({
      subject: "user_legit_a",
      email: "legit_a@example.com",
    });

    // ユーザーAがユーザーBの accountId を指定してエクスポートを試みる
    await expect(
      userAClient.mutation(api.records.fetchRecordsForExport, {
        accountId: userBId,
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("同時編集検知と楽観的ロック競合防止（FR-REC-15）", () => {
  it("編集セッションの開始・ハートビート・終了・アクティブ編集者一覧が正しく動作すること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let userBId!: Id<"users">;
    let recordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Family Concurrency",
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

      userBId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_b",
        email: "b@example.com",
        displayName: "ユーザーB",
        familyId,
        updatedAt: Date.now(),
      });

      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "Concurrent Record",
        sortKey: computeSortKey("Concurrent Record"),
        ownerType: "family",
        admins: [userAId],
        tags: [],
        updatedAt: 1000,
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const userB = t.withIdentity({ subject: "user_b", email: "b@example.com" });

    // 初期状態では編集者なし
    let editors = await userA.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(0);

    // 1. ユーザーAが編集セッションを開始
    await userA.mutation(api.records.startEditingSession, { recordId });

    editors = await userB.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(1);
    expect(editors[0].accountId).toBe(userAId);
    expect(editors[0].displayName).toBe("ユーザーA");
    expect(editors[0].email).toBe("a@example.com");
    expect(editors[0].isCurrentAccount).toBe(false); // Bから見た場合

    const sessionUpdatedAtA = editors[0].updatedAt;

    // 2. ユーザーBも編集セッションを開始（複数人の同時編集）
    await userB.mutation(api.records.startEditingSession, { recordId });

    editors = await userA.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(2);
    const editorIds = editors.map((e) => e.accountId);
    expect(editorIds).toContain(userAId);
    expect(editorIds).toContain(userBId);

    // 3. ハートビートで更新日時が更新されること
    const heartbeatAt = sessionUpdatedAtA + 1;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(heartbeatAt);
    await userA.mutation(api.records.heartbeatEditingSession, { recordId });
    dateNowSpy.mockRestore();
    const editorsAfterHeartbeat = await userA.query(
      api.records.getActiveEditors,
      { recordId },
    );
    const updatedSessionA = editorsAfterHeartbeat.find(
      (e) => e.accountId === userAId,
    );
    expect(updatedSessionA?.updatedAt).toBeGreaterThan(sessionUpdatedAtA);

    // 4. ユーザーAが編集を終了
    await userA.mutation(api.records.endEditingSession, { recordId });
    editors = await userB.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(1);
    expect(editors[0].accountId).toBe(userBId);
  });

  it("TTL（5分）を超過したセッションが getActiveEditors から自動除外されること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let recordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Family TTL",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "TTL Record",
        sortKey: computeSortKey("TTL Record"),
        ownerType: "family",
        admins: [userAId],
        tags: [],
        updatedAt: 1000,
      });

      // 6分前の期限切れセッションを手動挿入
      await ctx.db.insert("recordEditingSessions", {
        recordId,
        accountId: userAId,
        updatedAt: Date.now() - 6 * 60 * 1000,
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });

    // 期限切れセッションは取得されないこと
    const editors = await userA.query(api.records.getActiveEditors, {
      recordId,
    });
    expect(editors).toHaveLength(0);

    // ハートビートで復活（現在時刻に更新）
    await userA.mutation(api.records.heartbeatEditingSession, { recordId });
    const activeEditors = await userA.query(api.records.getActiveEditors, {
      recordId,
    });
    expect(activeEditors).toHaveLength(1);
    expect(activeEditors[0].accountId).toBe(userAId);
  });

  it("cleanupExpiredEditingSessionsInternal が期限切れセッションだけを削除すること", async () => {
    const t = convexTest(schema, modules);
    const now = 10 * 60 * 1000;

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Cleanup Family",
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "cleanup_user",
        email: "cleanup@example.com",
        familyId,
        updatedAt: now,
      });
      const recordId = await ctx.db.insert("serviceRecords", {
        userId: "cleanup_user",
        accountId,
        familyId,
        title: "Cleanup Record",
        ownerType: "user",
        admins: [],
        tags: [],
        updatedAt: now,
      });

      await ctx.db.insert("recordEditingSessions", {
        recordId,
        accountId,
        updatedAt: now - 5 * 60 * 1000 - 1,
      });
      await ctx.db.insert("recordEditingSessions", {
        recordId,
        accountId,
        updatedAt: now - 5 * 60 * 1000,
      });
    });

    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await t.mutation(
      internal.records.cleanupExpiredEditingSessionsInternal,
      {},
    );
    dateNowSpy.mockRestore();

    expect(result).toEqual({ deletedCount: 1 });
    const sessions = await t.run((ctx) =>
      ctx.db.query("recordEditingSessions").collect(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].updatedAt).toBe(now - 5 * 60 * 1000);
  });

  it("updateRecord で古い revision を渡した場合に CONFLICT エラーで更新が拒否され、一致時は成功してセッションが消去されること", async () => {
    const t = convexTest(schema, modules);

    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let recordId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Family Conflict",
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

      recordId = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "Original Title",
        sortKey: computeSortKey("Original Title"),
        ownerType: "family",
        admins: [userAId],
        tags: [],
        revision: 0,
        updatedAt: 5000,
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const userB = t.withIdentity({ subject: "user_b", email: "b@example.com" });

    // ユーザーAがセッション開始して保存
    await userA.mutation(api.records.startEditingSession, { recordId });
    let editors = await userA.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(1);

    // ユーザーAが revision: 0 で正常更新
    const firstUpdateDateNowSpy = vi.spyOn(Date, "now").mockReturnValue(6000);
    await userA.mutation(api.records.updateRecord, {
      id: recordId,
      revision: 0,
      data: {
        title: "Title updated by A",
        tags: [],
        credentials: [],
      },
    });
    firstUpdateDateNowSpy.mockRestore();

    // Aの保存完了に伴い、編集セッションが自動削除されること
    editors = await userA.query(api.records.getActiveEditors, { recordId });
    expect(editors).toHaveLength(0);

    // DBの updatedAt が進んでいることを確認
    const recordAfterA = await t.run((ctx) => ctx.db.get(recordId));
    expect(recordAfterA?.title).toBe("Title updated by A");
    const newUpdatedAt = recordAfterA?.updatedAt;
    expect(newUpdatedAt).toBeGreaterThan(5000);
    expect(recordAfterA?.revision).toBe(1);

    // ユーザーBが以前の古い revision: 0 を渡して更新を試みると競合拒否されること
    await expect(
      userB.mutation(api.records.updateRecord, {
        id: recordId,
        revision: 0,
        data: {
          title: "Title updated by B (conflicted)",
          tags: [],
          credentials: [],
        },
      }),
    ).rejects.toThrow("CONFLICT");

    // レコードはBの変更で上書きされていないこと
    const recordAfterConflict = await t.run((ctx) => ctx.db.get(recordId));
    expect(recordAfterConflict?.title).toBe("Title updated by A");

    // 通常更新で revision を省略した場合は拒否されること
    await expect(
      userB.mutation(api.records.updateRecord, {
        id: recordId,
        data: {
          title: "Title updated without revision",
          tags: [],
          credentials: [],
        },
      }),
    ).rejects.toThrow("REVISION_REQUIRED");

    // force: true を指定した場合は、revision を省略しても上書きできること
    const forceUpdateDateNowSpy = vi.spyOn(Date, "now").mockReturnValue(6000);
    await userB.mutation(api.records.updateRecord, {
      id: recordId,
      force: true,
      data: {
        title: "Title force updated by B",
        tags: [],
        credentials: [],
      },
    });
    forceUpdateDateNowSpy.mockRestore();

    const recordAfterForce = await t.run((ctx) => ctx.db.get(recordId));
    expect(recordAfterForce?.title).toBe("Title force updated by B");
    expect(recordAfterForce?.revision).toBe(2);
    expect(recordAfterForce?.updatedAt).toBe(newUpdatedAt);
  });

  it("getRecords が暗号化フィールドを除外した軽量クレデンシャルを返し、64件超のチャンク境界を跨いでも正しく全件取得できること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Chunk Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_chunk_a",
        email: "chunk_a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      // チャンクサイズ（64件）を超える 70 件のレコードと各クレデンシャルを一括投入
      for (let i = 0; i < 70; i++) {
        const recId = await ctx.db.insert("serviceRecords", {
          userId: "user_chunk_a",
          accountId: userAId,
          familyId,
          title: `Service ${i.toString().padStart(3, "0")}`,
          sortKey: `01_service_${i.toString().padStart(3, "0")}`,
          ownerType: "family",
          ownerFamilyId: familyId,
          admins: [userAId],
          tags: ["chunk-test"],
          updatedAt: Date.now() + i,
        });

        await ctx.db.insert("credentials", {
          recordId: recId,
          label: `Label ${i}`,
          loginId: `user${i}@example.com`,
          passwordHint: `secret-hint-${i}`,
          passwordHintIv: `iv-${i}`,
          passwordHintDekEncrypted: `dek-${i}`,
          passwordHintDekIv: `dek-iv-${i}`,
          order: 0,
          updatedAt: Date.now() + i,
        });
      }
    });

    const userA = t.withIdentity({
      subject: "user_chunk_a",
      email: "chunk_a@example.com",
    });

    const records = await userA.query(api.records.getRecords, {
      tag: "chunk-test",
    });

    // 64 件チャンクを跨いで全 70 件が漏れなく取得できていること
    expect(records).toHaveLength(70);

    // 各レコードの credentials を検証
    for (const record of records) {
      expect(record.credentials).toHaveLength(1);
      const cred = record.credentials[0];

      // 一覧表示・検索用のフィールドが存在すること
      expect(cred._id).toBeDefined();
      expect(cred.label).toBeDefined();
      expect(cred.loginId).toBeDefined();

      // 暗号化フィールド（passwordHint*）が除外されていること
      expect((cred as Record<string, unknown>).passwordHint).toBeUndefined();
      expect((cred as Record<string, unknown>).passwordHintIv).toBeUndefined();
      expect(
        (cred as Record<string, unknown>).passwordHintDekEncrypted,
      ).toBeUndefined();
      expect(
        (cred as Record<string, unknown>).passwordHintDekIv,
      ).toBeUndefined();
    }
  });

  it("getRecords が limit 引数を尊重し、指定された件数に制限して返却すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Limit Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_limit_a",
        email: "limit_a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      for (let i = 0; i < 5; i++) {
        const recordId = await ctx.db.insert("serviceRecords", {
          userId: "user_limit_a",
          accountId: userAId,
          familyId,
          title: `Limit Service ${i}`,
          sortKey: `01_service_${i}`,
          ownerType: "family",
          ownerFamilyId: familyId,
          admins: [userAId],
          tags: ["limit-test"],
          updatedAt: Date.now() + i,
        });

        await ctx.db.insert("credentials", {
          recordId,
          label: `Limit Credential ${i}`,
          updatedAt: Date.now() + i,
        });
      }
    });

    const userA = t.withIdentity({
      subject: "user_limit_a",
      email: "limit_a@example.com",
    });

    const records = await userA.query(api.records.getRecords, {
      tag: "limit-test",
      sort: "date-desc",
      limit: 2,
    });

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.title)).toEqual([
      "Limit Service 4",
      "Limit Service 3",
    ]);
    expect(records.map((record) => record.credentials[0]?.label)).toEqual([
      "Limit Credential 4",
      "Limit Credential 3",
    ]);
  });

  it("getRecordsPaginated が Convex ページネーションに準拠してページ分割と credentials 取得を実行できること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Paginated Test Family",
        updatedAt: Date.now(),
      });

      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_paginated_a",
        email: "paginated_a@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      for (let i = 0; i < 5; i++) {
        const recId = await ctx.db.insert("serviceRecords", {
          userId: "user_paginated_a",
          accountId: userAId,
          familyId,
          title: `Paginated Service ${i}`,
          sortKey: `01_service_${i}`,
          ownerType: "family",
          ownerFamilyId: familyId,
          admins: [userAId],
          tags: ["paginated-test"],
          updatedAt: Date.now() + i,
        });

        await ctx.db.insert("credentials", {
          recordId: recId,
          label: `Cred ${i}`,
          loginId: `user${i}@example.com`,
          passwordHint: `hint-${i}`,
          order: 0,
          updatedAt: Date.now() + i,
        });
      }
    });

    const userA = t.withIdentity({
      subject: "user_paginated_a",
      email: "paginated_a@example.com",
    });

    // 1ページ目: 2件取得
    const page1 = await userA.query(api.records.getRecordsPaginated, {
      tag: "paginated-test",
      paginationOpts: {
        numItems: 2,
        cursor: null,
      },
    });

    expect(page1.page).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeDefined();
    expect(page1.page[0].credentials).toHaveLength(1);
    expect(page1.page[0].credentials[0].label).toBe("Cred 0");
    expect(
      (page1.page[0].credentials[0] as Record<string, unknown>).passwordHint,
    ).toBeUndefined();

    // 2ページ目: 前回の continueCursor を渡して 2件取得
    const page2 = await userA.query(api.records.getRecordsPaginated, {
      tag: "paginated-test",
      paginationOpts: {
        numItems: 2,
        cursor: page1.continueCursor,
      },
    });

    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(false);
    expect(page2.continueCursor).toBeDefined();

    // 3ページ目: 残り 1件取得
    const page3 = await userA.query(api.records.getRecordsPaginated, {
      tag: "paginated-test",
      paginationOpts: {
        numItems: 2,
        cursor: page2.continueCursor,
      },
    });

    expect(page3.page).toHaveLength(1);
    expect(page3.isDone).toBe(true);
  });

  it("bulkSetRecordAdmin: 共有レコードに対して閲覧者メンバーの管理者設定・解除が一括で動作すること", async () => {
    const t = convexTest(schema, modules);
    let familyId!: Id<"families">;
    let userAId!: Id<"users">;
    let viewerId!: Id<"users">;
    let rec1Id!: Id<"serviceRecords">;
    let rec2Id!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "Bulk Admin Family",
        updatedAt: Date.now(),
      });
      userAId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "user_a",
        email: "a@example.com",
        familyId,
        updatedAt: Date.now(),
      });
      viewerId = await ctx.db.insert("users", {
        familyRole: "viewer",
        userId: "viewer_b",
        email: "b@example.com",
        familyId,
        updatedAt: Date.now(),
      });

      rec1Id = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "Shared 1",
        sortKey: computeSortKey("Shared 1"),
        ownerType: "family",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });
      rec2Id = await ctx.db.insert("serviceRecords", {
        userId: "user_a",
        accountId: userAId,
        familyId,
        ownerFamilyId: familyId,
        title: "Shared 2",
        sortKey: computeSortKey("Shared 2"),
        ownerType: "family",
        admins: [],
        tags: [],
        updatedAt: Date.now(),
      });
    });

    const userA = t.withIdentity({ subject: "user_a", email: "a@example.com" });
    const viewerUser = t.withIdentity({
      subject: "viewer_b",
      email: "b@example.com",
    });

    // 一括で viewerId を管理者に追加
    const addRes = await userA.mutation(api.records.bulkSetRecordAdmin, {
      ids: [rec1Id, rec2Id],
      targetAccountId: viewerId,
      makeAdmin: true,
    });
    expect(addRes.count).toBe(2);

    await t.run(async (ctx) => {
      const r1 = await ctx.db.get(rec1Id);
      expect(r1?.admins).toContain(viewerId);
      const r2 = await ctx.db.get(rec2Id);
      expect(r2?.admins).toContain(viewerId);
    });

    // 個別管理者付与後は viewerUser が recordAdminMutation (例: addRecordAdmin) を実行できること
    await viewerUser.mutation(api.records.addRecordAdmin, {
      id: rec1Id,
      targetAccountId: viewerId,
    });

    // 一括で viewerId を管理者から解除
    const removeRes = await userA.mutation(api.records.bulkSetRecordAdmin, {
      ids: [rec1Id, rec2Id],
      targetAccountId: viewerId,
      makeAdmin: false,
    });
    expect(removeRes.count).toBe(2);

    await t.run(async (ctx) => {
      const r1 = await ctx.db.get(rec1Id);
      expect(r1?.admins).not.toContain(viewerId);
      const r2 = await ctx.db.get(rec2Id);
      expect(r2?.admins).not.toContain(viewerId);
    });

    // 管理者解除後は同じ操作が Access denied で拒否されること
    await expect(
      viewerUser.mutation(api.records.addRecordAdmin, {
        id: rec1Id,
        targetAccountId: viewerId,
      }),
    ).rejects.toThrow("Access denied");
  });
});

describe("2.2.14 CSV差分インポート・安定ID（stableId）・マイグレーション検証", () => {
  it("backfillStableIds: stableId未設定のレコードとクレデンシャルにUUIDが一括付与されること", async () => {
    const t = convexTest(schema, modules);
    let recId!: Id<"serviceRecords">;
    let credId!: Id<"credentials">;

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Backfill Family",
        updatedAt: Date.now(),
      });
      const userId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "backfill_user",
        email: "backfill@example.com",
        familyId,
        updatedAt: Date.now(),
      });
      recId = await ctx.db.insert("serviceRecords", {
        title: "No StableId Service",
        userId: "backfill_user",
        accountId: userId,
        familyId,
        tags: [],
        updatedAt: Date.now(),
      });
      credId = await ctx.db.insert("credentials", {
        recordId: recId,
        label: "Login",
        loginId: "user@example.com",
        updatedAt: Date.now(),
      });
    });

    // マイグレーション実行前は stableId が未定義
    await t.run(async (ctx) => {
      const r = await ctx.db.get(recId);
      expect(r?.stableId).toBeUndefined();
      const c = await ctx.db.get(credId);
      expect(c?.stableId).toBeUndefined();
    });

    // backfillStableIds を実行
    const result = await t.mutation(api.migrations.backfillStableIds, {});
    expect(result.recordsUpdated).toBe(1);
    expect(result.credentialsUpdated).toBe(1);

    // 実行後は UUID が格納されていること
    await t.run(async (ctx) => {
      const r = await ctx.db.get(recId);
      expect(r?.stableId).toBeDefined();
      expect(typeof r?.stableId).toBe("string");
      expect(r?.stableId?.length).toBeGreaterThan(10);

      const c = await ctx.db.get(credId);
      expect(c?.stableId).toBeDefined();
      expect(typeof c?.stableId).toBe("string");
    });
  });

  it("getRecordsForDiffImport: 差分突合用に平文メタデータのみを取得し、暗号文は除外されること", async () => {
    const t = convexTest(schema, modules);
    const stableUUID = "11111111-2222-3333-4444-555555555555";

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Diff Family",
        updatedAt: Date.now(),
      });
      const userId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "diff_user",
        email: "diff@example.com",
        familyId,
        updatedAt: Date.now(),
      });
      const recId = await ctx.db.insert("serviceRecords", {
        title: "Diff Target Service",
        url: "https://diff.example.com",
        memo: "Original Memo",
        userId: "diff_user",
        accountId: userId,
        familyId,
        stableId: stableUUID,
        tags: ["work"],
        updatedAt: Date.now(),
      });
      await ctx.db.insert("credentials", {
        recordId: recId,
        stableId: "cred-uuid-1",
        label: "Main",
        loginId: "admin@diff.com",
        passwordHint: "encrypted_secret",
        passwordHintIv: "iv_secret",
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "diff_user",
      email: "diff@example.com",
    });

    const records = await user.query(api.records.getRecordsForDiffImport, {});
    expect(records.length).toBe(1);
    const r = records[0];
    expect(r.stableId).toBe(stableUUID);
    expect(r.title).toBe("Diff Target Service");
    expect(r.url).toBe("https://diff.example.com");
    expect(r.memo).toBe("Original Memo");
    expect(r.credentials.length).toBe(1);
    expect(r.credentials[0].stableId).toBe("cred-uuid-1");
    expect(r.credentials[0].label).toBe("Main");
    expect(r.credentials[0].hasPasswordHint).toBe(true);

    // 暗号文・IVが返却されていないこと（patterns.md #15 最小権限原則）
    expect(
      (r.credentials[0] as Record<string, unknown>).passwordHint,
    ).toBeUndefined();
    expect(
      (r.credentials[0] as Record<string, unknown>).passwordHintIv,
    ).toBeUndefined();
  });

  it("applyImportDiff: 新規作成と差分更新が同一トランザクションで安全に反映されること", async () => {
    const t = convexTest(schema, modules);
    const existingStableId = "22222222-3333-4444-5555-666666666666";
    const existingCredStableId = "cred-existing-uuid-1";

    let familyId!: Id<"families">;
    let existingRecId!: Id<"serviceRecords">;

    await t.run(async (ctx) => {
      familyId = await ctx.db.insert("families", {
        name: "ApplyDiff Family",
        updatedAt: Date.now(),
      });
      const userId = await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "apply_user",
        email: "apply@example.com",
        familyId,
        updatedAt: Date.now(),
      });
      existingRecId = await ctx.db.insert("serviceRecords", {
        title: "Before Update Service",
        url: "https://before.com",
        memo: "Keep this memo",
        userId: "apply_user",
        accountId: userId,
        familyId,
        stableId: existingStableId,
        tags: ["old-tag"],
        updatedAt: Date.now(),
      });
      await ctx.db.insert("credentials", {
        recordId: existingRecId,
        stableId: existingCredStableId,
        label: "Old Label",
        loginId: "old@example.com",
        passwordHint: "keep_this_hint",
        passwordHintIv: "keep_this_iv",
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "apply_user",
      email: "apply@example.com",
    });

    // 1件新規(CREATE) + 1件更新(UPDATE)
    const result = await user.mutation(api.records.applyImportDiff, {
      creates: [
        {
          title: "New Created Service",
          url: "https://new.com",
          memo: "New memo",
          tags: ["new-tag"],
          credentials: [
            {
              label: "New Cred",
              loginId: "newuser@example.com",
            },
          ],
        },
      ],
      updates: [
        {
          stableId: existingStableId,
          title: "After Update Service", // タイトル変更
          // url, memo は undefined（既存値維持）
          credentials: [
            {
              stableId: existingCredStableId,
              label: "Updated Label", // ラベル更新（loginId, hintは維持）
            },
            {
              // stableId なし → 新規クレデンシャル追加
              label: "Added Sub Account",
              loginId: "sub@example.com",
            },
          ],
        },
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);

    // 反映後のDB状態を検証
    await t.run(async (ctx) => {
      // 1. 新規レコードの検証
      const newRecords = await ctx.db
        .query("serviceRecords")
        .withIndex("by_family_stableId", (q) => q.eq("familyId", familyId))
        .collect();
      expect(newRecords.length).toBe(2);

      const created = newRecords.find((r) => r.title === "New Created Service");
      expect(created).toBeDefined();
      expect(created?.stableId).toBeDefined();

      // 2. 更新レコードの検証
      const updated = await ctx.db.get(existingRecId);
      expect(updated?.title).toBe("After Update Service");
      // 未指定の項目が維持されていること（空セル上書き破壊の防止）
      expect(updated?.url).toBe("https://before.com");
      expect(updated?.memo).toBe("Keep this memo");

      // クレデンシャルの検証
      const creds = await ctx.db
        .query("credentials")
        .withIndex("by_recordId", (q) => q.eq("recordId", existingRecId))
        .collect();
      expect(creds.length).toBe(2);

      const updatedCred = creds.find(
        (c) => c.stableId === existingCredStableId,
      );
      expect(updatedCred?.label).toBe("Updated Label");
      expect(updatedCred?.loginId).toBe("old@example.com"); // 維持
      expect(updatedCred?.passwordHint).toBe("keep_this_hint"); // 維持

      const addedCred = creds.find((c) => c.label === "Added Sub Account");
      expect(addedCred).toBeDefined();
      expect(addedCred?.stableId).toBeDefined();
    });
  });

  it("applyImportDiff: 存在しないstableIdを指定した場合はエラーとなり全体がロールバックされること", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const familyId = await ctx.db.insert("families", {
        name: "Rollback Family",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("users", {
        familyRole: "admin",
        userId: "rollback_user",
        email: "rollback@example.com",
        familyId,
        updatedAt: Date.now(),
      });
    });

    const user = t.withIdentity({
      subject: "rollback_user",
      email: "rollback@example.com",
    });

    await expect(
      user.mutation(api.records.applyImportDiff, {
        creates: [],
        updates: [
          {
            stableId: "non-existent-uuid",
            title: "Invalid",
            credentials: [],
          },
        ],
      }),
    ).rejects.toThrow("更新対象のレコードが見つかりません");
  });
});
