import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { computeSortKey } from "../src/utils/index-group";

const modules = import.meta.glob("../convex/**/*.ts");

const seedTwoUserFamily_ = async (t: ReturnType<typeof convexTest>) => {
  let oldFamilyId!: Id<"families">;
  let userAId!: Id<"users">;
  let userBId!: Id<"users">;
  let recordAId!: Id<"serviceRecords">;
  let recordBId!: Id<"serviceRecords">;
  let credAId!: Id<"credentials">;
  let credBId!: Id<"credentials">;
  const dummyData = {
    a: {
      passwordHint: "SGVsbG9Xb3JsZAd0",
      passwordHintIv: "SGVsbG9Xb3JsZAd0",
      passwordHintDekEncrypted: "SGVsbG9Xb3JsZAd0",
      passwordHintDekIv: "SGVsbG9Xb3JsZAd0",
    },
    aReencrypted: {
      passwordHint: "SGVsbG9Xb3JsZAd1",
      passwordHintIv: "SGVsbG9Xb3JsZAd1",
      passwordHintDekEncrypted: "SGVsbG9Xb3JsZAd1",
      passwordHintDekIv: "SGVsbG9Xb3JsZAd1",
    },
    b: {
      passwordHint: "SGVsbG9Xb3JsZAd2",
      passwordHintIv: "SGVsbG9Xb3JsZAd2",
      passwordHintDekEncrypted: "SGVsbG9Xb3JsZAd2",
      passwordHintDekIv: "SGVsbG9Xb3JsZAd2",
    },
  };

  await t.run(async (ctx) => {
    oldFamilyId = await ctx.db.insert("families", {
      name: "F1",
      masterKeyEncrypted: "SGVsbG9Xb3JsZA==",
      masterKeyIv: "SGVsbG9Xb3JsZA==",
      masterKeySalt: "SGVsbG9Xb3JsZA==",
      updatedAt: Date.now(),
    });

    userAId = await ctx.db.insert("users", {
      familyRole: "admin",
      userId: "ua",
      email: "a@a.com",
      familyId: oldFamilyId,
      updatedAt: Date.now(),
    });

    userBId = await ctx.db.insert("users", {
      familyRole: "admin",
      userId: "ub",
      email: "b@b.com",
      familyId: oldFamilyId,
      updatedAt: Date.now(),
    });

    recordAId = await ctx.db.insert("serviceRecords", {
      stableId: crypto.randomUUID(),
      userId: "ua",
      accountId: userAId,
      familyId: oldFamilyId,
      title: "RA",
      sortKey: computeSortKey("RA"),
      ownerType: "user",
      admins: [],
      tags: [],
      updatedAt: Date.now(),
    });

    credAId = await ctx.db.insert("credentials", {
      recordId: recordAId,
      stableId: crypto.randomUUID(),
      label: "LabelA",
      loginId: "LoginA",
      passwordHint: dummyData.a.passwordHint,
      passwordHintIv: dummyData.a.passwordHintIv,
      passwordHintDekEncrypted: dummyData.a.passwordHintDekEncrypted,
      passwordHintDekIv: dummyData.a.passwordHintDekIv,
      order: 0,
      updatedAt: Date.now(),
    });

    recordBId = await ctx.db.insert("serviceRecords", {
      stableId: crypto.randomUUID(),
      userId: "ub",
      accountId: userBId,
      familyId: oldFamilyId,
      title: "RB",
      sortKey: computeSortKey("RB"),
      ownerType: "user",
      admins: [],
      tags: [],
      updatedAt: Date.now(),
    });

    credBId = await ctx.db.insert("credentials", {
      recordId: recordBId,
      stableId: crypto.randomUUID(),
      label: "LabelB",
      loginId: "LoginB",
      passwordHint: dummyData.b.passwordHint,
      passwordHintIv: dummyData.b.passwordHintIv,
      passwordHintDekEncrypted: dummyData.b.passwordHintDekEncrypted,
      passwordHintDekIv: dummyData.b.passwordHintDekIv,
      order: 0,
      updatedAt: Date.now(),
    });
  });

  return {
    oldFamilyId,
    userAId,
    userBId,
    recordAId,
    recordBId,
    credAId,
    credBId,
    dummyData,
  };
};

describe("2.1 家族管理とE2EE鍵ローテーションの統合テスト (Convex版)", () => {
  describe("2.1.1 家族の作成と所属ユーザーの更新", () => {
    it("家族作成時にトランザクションが機能し、作成したユーザーのfamilyIdが紐づくこと", async () => {
      const t = convexTest(schema, modules);

      // シードデータ（ユーザー）
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });

      const payload = {
        name: "田中家",
        masterKeyEncrypted: "SGVsbG9Xb3JsZA==",
        masterKeyIv: "SGVsbG9Xb3JsZA==",
        masterKeySalt: "SGVsbG9Xb3JsZA==",
      };

      const familyId = await userA.mutation(api.families.createFamily, payload);

      expect(familyId).toBeDefined();

      const user = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "user_a"))
          .unique();
      });

      expect(user?.familyId).toBe(familyId);
    });
  });

  describe("2.1.2 家族グループ変更時のレコード再暗号化（IDOR対策の検証）", () => {
    it("自分が所有するレコードのみが移行対象となり、他人のレコードは更新されないこと", async () => {
      const t = convexTest(schema, modules);

      const { oldFamilyId, recordAId, recordBId, credAId, credBId, dummyData } =
        await seedTwoUserFamily_(t);

      const userA = t.withIdentity({
        subject: "ua",
        email: "a@a.com",
      });

      // 1. 家族移行を準備する
      const prepareRes = await userA.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "F2",
          masterKeyEncrypted: "NEW_FAMILY_KEY",
          masterKeyIv: "NEW_FAMILY_IV",
          masterKeySalt: "NEW_FAMILY_SALT",
        },
      );

      expect(prepareRes.migrationId).toBeDefined();
      expect(prepareRes.targetFamilyId).toBeDefined();

      // 2. 再暗号化対象を取得する
      const migrationData = await userA.query(
        api.families.getMigrationForEncryption,
        {
          migrationId: prepareRes.migrationId,
        },
      );

      // userA の個人レコードだけが対象であること
      expect(migrationData.records).toHaveLength(1);
      expect(migrationData.records[0].id).toBe(recordAId);

      // userB のレコードは移行対象に含まれないこと
      expect(
        migrationData.records.some((record) => record.id === recordBId),
      ).toBe(false);

      // userA の credential が対象に含まれていること
      expect(migrationData.records[0].credentials).toHaveLength(1);
      expect(migrationData.records[0].credentials[0].id).toBe(credAId);

      // userB の credential が対象に含まれないこと
      expect(
        migrationData.records[0].credentials.some(
          (credential) => credential.id === credBId,
        ),
      ).toBe(false);

      // 3. クライアント側で再暗号化された結果を commit する
      //
      // 実際の暗号化・復号はブラウザE2Eテストで検証するため、
      // Convex単体テストでは再暗号化済みデータを受け取って
      // 正しいレコードに反映できることだけを検証する。
      const commitRes = await userA.mutation(
        api.families.commitFamilyMigration,
        {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: credAId,
              recordId: recordAId,
              passwordHint: dummyData.aReencrypted.passwordHint,
              passwordHintIv: dummyData.aReencrypted.passwordHintIv,
              passwordHintDekEncrypted:
                dummyData.aReencrypted.passwordHintDekEncrypted,
              passwordHintDekIv: dummyData.aReencrypted.passwordHintDekIv,
            },
          ],
        },
      );

      expect(commitRes.success).toBe(true);
      expect(commitRes.familyId).toBe(prepareRes.targetFamilyId);

      // 4. DB状態を検証する
      await t.run(async (ctx) => {
        // userA の所属Familyが変更されていること
        const updatedUserA = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "ua"))
          .unique();

        expect(updatedUserA?.familyId).toBe(prepareRes.targetFamilyId);

        // userA のレコードが新Familyへ移動していること
        const updatedRecordA = await ctx.db.get(recordAId);

        expect(updatedRecordA?.familyId).toBe(prepareRes.targetFamilyId);

        // userA のcredentialが更新されていること
        const updatedCredA = await ctx.db.get(credAId);

        expect(updatedCredA?.passwordHint).toBe(
          dummyData.aReencrypted.passwordHint,
        );
        expect(updatedCredA?.passwordHintIv).toBe(
          dummyData.aReencrypted.passwordHintIv,
        );
        expect(updatedCredA?.passwordHintDekEncrypted).toBe(
          dummyData.aReencrypted.passwordHintDekEncrypted,
        );
        expect(updatedCredA?.passwordHintDekIv).toBe(
          dummyData.aReencrypted.passwordHintDekIv,
        );

        // userB の所属Familyは変更されていないこと
        const updatedUserB = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "ub"))
          .unique();

        expect(updatedUserB?.familyId).toBe(oldFamilyId);

        // userB のレコードは変更されていないこと
        const updatedRecordB = await ctx.db.get(recordBId);

        expect(updatedRecordB?.familyId).toBe(oldFamilyId);

        // userB のcredentialは変更されていないこと
        const updatedCredB = await ctx.db.get(credBId);

        expect(updatedCredB?.passwordHint).toBe(dummyData.b.passwordHint);
        expect(updatedCredB?.passwordHintIv).toBe(dummyData.b.passwordHintIv);
        expect(updatedCredB?.passwordHintDekEncrypted).toBe(
          dummyData.b.passwordHintDekEncrypted,
        );
        expect(updatedCredB?.passwordHintDekIv).toBe(
          dummyData.b.passwordHintDekIv,
        );
      });
    });

    it("他ユーザーのcredential IDを直接指定したcommitを行っても、他ユーザーのデータが変更されないこと", async () => {
      const t = convexTest(schema, modules);

      const { recordAId, recordBId, credAId, credBId, dummyData } =
        await seedTwoUserFamily_(t);

      const userA = t.withIdentity({
        subject: "ua",
        email: "a@a.com",
      });

      const prepareRes = await userA.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "F2",
          masterKeyEncrypted: "NEW_FAMILY_KEY",
          masterKeyIv: "DDDDDDDDDDDDDDDD",
          masterKeySalt: "EEEEEEEEEEEEEEEE",
        },
      );

      const migrationData = await userA.query(
        api.families.getMigrationForEncryption,
        {
          migrationId: prepareRes.migrationId,
        },
      );

      // Bのrecordがmigration対象に含まれていないことを確認する。
      expect(
        migrationData.records.some((record) => record.id === recordBId),
      ).toBe(false);

      // 攻撃者がBのcredential IDを直接指定してcommit payloadに混入させる。
      await userA.mutation(api.families.commitFamilyMigration, {
        migrationId: prepareRes.migrationId,
        credentials: [
          {
            id: credAId,
            recordId: recordAId,
            passwordHint: "NEW_A",
            passwordHintIv: "FFFFFFFFFFFFFFFF",
            passwordHintDekEncrypted: "NEW_A_DEK",
            passwordHintDekIv: "GGGGGGGGGGGGGGGG",
          },
          {
            id: credBId,
            recordId: recordBId,
            passwordHint: "ATTACKED",
            passwordHintIv: "HHHHHHHHHHHHHHHH",
            passwordHintDekEncrypted: "ATTACKED_DEK",
            passwordHintDekIv: "IIIIIIIIIIIIIIII",
          },
        ],
      });

      await t.run(async (ctx) => {
        // A自身のcredentialは正常に更新される。
        const updatedCredA = await ctx.db.get(credAId);

        expect(updatedCredA?.passwordHint).toBe("NEW_A");
        expect(updatedCredA?.passwordHintIv).toBe("FFFFFFFFFFFFFFFF");
        expect(updatedCredA?.passwordHintDekEncrypted).toBe("NEW_A_DEK");
        expect(updatedCredA?.passwordHintDekIv).toBe("GGGGGGGGGGGGGGGG");

        // Bのcredentialは攻撃payloadによって変更されない。
        const unchangedCredB = await ctx.db.get(credBId);

        expect(unchangedCredB?.passwordHint).toBe(dummyData.b.passwordHint);
        expect(unchangedCredB?.passwordHintIv).toBe(dummyData.b.passwordHintIv);
        expect(unchangedCredB?.passwordHintDekEncrypted).toBe(
          dummyData.b.passwordHintDekEncrypted,
        );
        expect(unchangedCredB?.passwordHintDekIv).toBe(
          dummyData.b.passwordHintDekIv,
        );
      });
    });
  });

  describe("2.1.3 家族の承認制参加フローの検証", () => {
    it("家族への参加申請、一覧取得、承認、およびE2EE対応の参加完了ができること", async () => {
      const t = convexTest(schema, modules);

      let familyId!: Id<"families">;
      let applicantId!: Id<"users">;
      let recordId!: Id<"serviceRecords">;
      let credentialId!: Id<"credentials">;

      // シードデータ投入
      await t.run(async (ctx) => {
        // 既存家族と既存メンバー
        familyId = await ctx.db.insert("families", {
          name: "田中家",
          masterKeyEncrypted: "SGVsbG9Xb3JsZA==",
          masterKeyIv: "SGVsbG9Xb3JsZA==",
          masterKeySalt: "SGVsbG9Xb3JsZA==",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "member_a",
          email: "member_a@example.com",
          displayName: "メンバーA",
          familyId,
          updatedAt: Date.now(),
        });

        // 参加申請を行う新規ユーザー
        applicantId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant_b",
          email: "applicant_b@example.com",
          displayName: "申請者B",
          updatedAt: Date.now(),
        });

        // 参加者が所有する個人レコード
        recordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "applicant_b",
          accountId: applicantId,
          familyId: undefined,
          title: "Applicant Record",
          sortKey: computeSortKey("Applicant Record"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });

        // 参加者の個人credential
        credentialId = await ctx.db.insert("credentials", {
          recordId,
          stableId: crypto.randomUUID(),
          label: "Applicant Credential",
          loginId: "Applicant Login",
          passwordHint: "OLD_HINT",
          passwordHintIv: "OLD_IV",
          order: 0,
          updatedAt: Date.now(),
        });

        // 家族未所属の一般ユーザー
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "stranger",
          email: "stranger@example.com",
          displayName: "よそ者",
          updatedAt: Date.now(),
        });
      });

      const memberA = t.withIdentity({
        subject: "member_a",
        email: "member_a@example.com",
      });

      const applicantB = t.withIdentity({
        subject: "applicant_b",
        email: "applicant_b@example.com",
      });

      // 0. 招待コードを発行する
      const invite = await memberA.mutation(api.families.createFamilyInvite, {
        ttlMinutes: 1440,
      });
      expect(invite.code).toBeDefined();

      // 1. 申請前は getFamilyInfoByFamilyId で鍵を取得できないこと
      await expect(
        applicantB.query(api.families.getFamilyInfoByFamilyId, {
          familyId,
        }),
      ).rejects.toThrow("Access denied");

      // 2. 家族公開情報は取得できること
      const publicInfo = await applicantB.query(
        api.families.getFamilyPublicInfo,
        { code: invite.code },
      );
      expect(publicInfo.name).toBe("田中家");

      // 3. 参加申請を作成する
      const requestId = await applicantB.mutation(
        api.families.createJoinRequest,
        { code: invite.code },
      );
      expect(requestId).toBeDefined();

      // 4. 重複申請がエラーになること
      await expect(
        applicantB.mutation(api.families.createJoinRequest, {
          code: invite.code,
        }),
      ).rejects.toThrow("pending join request");

      // 5. 申請状態を確認できること
      const myRequest = await applicantB.query(
        api.families.getMyJoinRequest,
        {},
      );
      expect(myRequest?.status).toBe("pending");
      expect(myRequest?.familyName).toBe("田中家");

      // 6. 既存メンバーが保留中の申請一覧を取得できること
      const pendingRequests = await memberA.query(
        api.families.getPendingRequests,
        {},
      );
      expect(pendingRequests.length).toBe(1);
      expect(pendingRequests[0].userId).toBe("applicant_b");
      expect(pendingRequests[0].displayName).toBe("申請者B");

      // 7. 申請者以外の無関係なユーザーは保留中一覧を取得できないこと
      const stranger = t.withIdentity({
        subject: "stranger",
        email: "stranger@example.com",
      });

      await expect(
        stranger.query(api.families.getPendingRequests, {}),
      ).rejects.toThrow("User does not belong to a family");

      // 8. 既存メンバーが申請を承認すること
      await memberA.mutation(api.families.approveJoinRequest, {
        requestId,
      });

      // 9. 承認後は getFamilyInfoByFamilyId が通ること
      const infoAfterApproval = await applicantB.query(
        api.families.getFamilyInfoByFamilyId,
        { familyId },
      );
      expect(infoAfterApproval.masterKeyEncrypted).toBe("SGVsbG9Xb3JsZA==");

      // 10. 承認後にE2EE対応の家族Migrationを準備する
      const prepareRes = await applicantB.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "join",
          familyId,
        },
      );

      expect(prepareRes.migrationId).toBeDefined();
      expect(prepareRes.targetFamilyId).toBe(familyId);

      // 11. クライアント側で再暗号化する対象を取得する
      const migrationData = await applicantB.query(
        api.families.getMigrationForEncryption,
        {
          migrationId: prepareRes.migrationId,
        },
      );

      // 参加者自身の個人レコードだけが再暗号化対象であること
      expect(migrationData.records).toHaveLength(1);
      expect(migrationData.records[0].id).toBe(recordId);

      // 参加者自身のcredentialが対象に含まれること
      expect(migrationData.records[0].credentials).toHaveLength(1);
      expect(migrationData.records[0].credentials[0].id).toBe(credentialId);

      // 12. 再暗号化済みcredentialをcommitする
      //
      // 実際の暗号化・復号はブラウザE2Eテストで検証する。
      // Convex単体テストでは、サーバーがクライアントから受け取った
      // 再暗号化済みデータを正しいcredentialへ反映できることを検証する。
      const commitRes = await applicantB.mutation(
        api.families.commitFamilyMigration,
        {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: credentialId,
              recordId,
              passwordHint: "NEW_HINT",
              passwordHintIv: "NEW_IV",
            },
          ],
        },
      );

      expect(commitRes.success).toBe(true);
      expect(commitRes.familyId).toBe(familyId);

      // 13. 参加後はユーザーのfamilyIdが更新されていること
      const updatedApplicant = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "applicant_b"))
          .unique();
      });

      expect(updatedApplicant?.familyId).toBe(familyId);

      // 14. 個人レコードが新しいfamilyに所属していること
      const updatedRecord = await t.run(async (ctx) => {
        return await ctx.db.get(recordId);
      });

      expect(updatedRecord?.familyId).toBe(familyId);

      // 15. credentialが再暗号化済みデータに更新されていること
      const updatedCredential = await t.run(async (ctx) => {
        return await ctx.db.get(credentialId);
      });

      expect(updatedCredential?.passwordHint).toBe("NEW_HINT");
      expect(updatedCredential?.passwordHintIv).toBe("NEW_IV");

      // 16. 正式参加後は申請データが削除されていること
      const myRequestAfterJoin = await applicantB.query(
        api.families.getMyJoinRequest,
        {},
      );

      expect(myRequestAfterJoin).toBeNull();
    });

    it("参加申請を却下し、その後再申請ができること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "山田家",
          masterKeyEncrypted: "SGVsbG9Xb3JsZA==",
          masterKeyIv: "SGVsbG9Xb3JsZA==",
          masterKeySalt: "SGVsbG9Xb3JsZA==",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "member_y",
          email: "y@example.com",
          familyId,
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant_z",
          email: "z@example.com",
          updatedAt: Date.now(),
        });
      });

      const memberY = t.withIdentity({
        subject: "member_y",
        email: "y@example.com",
      });

      const applicantZ = t.withIdentity({
        subject: "applicant_z",
        email: "z@example.com",
      });

      // 0. 招待コードを発行する
      const invite = await memberY.mutation(
        api.families.createFamilyInvite,
        {},
      );

      expect(invite.code).toBeDefined();

      // 1. 参加申請する
      const requestId = await applicantZ.mutation(
        api.families.createJoinRequest,
        { code: invite.code },
      );

      expect(requestId).toBeDefined();

      // 2. 既存メンバーが申請を却下する
      await memberY.mutation(api.families.rejectJoinRequest, {
        requestId,
      });

      // 3. 却下された状態を確認する
      const status = await applicantZ.query(api.families.getMyJoinRequest, {});

      expect(status?.status).toBe("rejected");

      // 4. 却下状態を消去して再申請できるようにする
      await applicantZ.mutation(api.families.dismissRejectedRequest, {
        requestId,
      });

      // 5. 却下済み申請が消えていること
      const statusAfterDismiss = await applicantZ.query(
        api.families.getMyJoinRequest,
        {},
      );

      expect(statusAfterDismiss).toBeNull();
    });
  });

  describe("2.1.4 有効期限付き家族招待コード（Issue 132）のセキュリティとライフサイクル", () => {
    it("createFamilyInviteのTTLがサーバー側で15分〜30日にクランプされること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "佐藤家",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_sato",
          email: "sato@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const userSato = t.withIdentity({
        subject: "user_sato",
        email: "sato@example.com",
      });

      const before = Date.now();

      // 1. 0分（極小値）を指定 -> 15分（900秒 = 900,000ms）にクランプ
      const minInvite = await userSato.mutation(
        api.families.createFamilyInvite,
        { ttlMinutes: 0 },
      );
      expect(minInvite.expiresAt).toBeGreaterThanOrEqual(
        before + 14 * 60 * 1000,
      );
      expect(minInvite.expiresAt).toBeLessThanOrEqual(
        Date.now() + 16 * 60 * 1000,
      );

      // 2. 100日（極大値）を指定 -> 30日（43200分）にクランプ
      const maxInvite = await userSato.mutation(
        api.families.createFamilyInvite,
        { ttlMinutes: 100 * 24 * 60 },
      );
      const expected30DaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(maxInvite.expiresAt).toBeGreaterThanOrEqual(
        before + expected30DaysMs - 10000,
      );
      expect(maxInvite.expiresAt).toBeLessThanOrEqual(
        Date.now() + expected30DaysMs + 10000,
      );

      // 3. デフォルト指定 -> 7日（10080分）
      const defaultInvite = await userSato.mutation(
        api.families.createFamilyInvite,
        {},
      );
      const expected7DaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(defaultInvite.expiresAt).toBeGreaterThanOrEqual(
        before + expected7DaysMs - 10000,
      );
      expect(defaultInvite.expiresAt).toBeLessThanOrEqual(
        Date.now() + expected7DaysMs + 10000,
      );
    });

    it("createFamilyInviteは有限の整数でないTTLを拒否すること", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        const familyId = await ctx.db.insert("families", {
          name: "TTL検証家",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_ttl_validation",
          email: "ttl@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "user_ttl_validation",
        email: "ttl@example.com",
      });

      for (const ttlMinutes of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        await expect(
          user.mutation(api.families.createFamilyInvite, { ttlMinutes }),
        ).rejects.toThrow("ttlMinutes must be a finite integer");
      }
    });

    it("期限切れの招待コードで参加申請または情報取得を行うとエラーになること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      const expiredCode = "expired-uuid-1234";

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "期限切れ家",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("familyInvites", {
          familyId,
          code: expiredCode,
          createdBy: "creator_uid",
          createdAt: Date.now() - 100000,
          expiresAt: Date.now() - 1000, // 既に期限切れ
          useCount: 0,
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant_expired",
          email: "exp@example.com",
          updatedAt: Date.now(),
        });
      });

      const applicant = t.withIdentity({
        subject: "applicant_expired",
        email: "exp@example.com",
      });

      await expect(
        applicant.query(api.families.getFamilyPublicInfo, {
          code: expiredCode,
        }),
      ).rejects.toThrow("expired");

      await expect(
        applicant.mutation(api.families.createJoinRequest, {
          code: expiredCode,
        }),
      ).rejects.toThrow("expired");
    });

    it("無効化（revokedAt設定済み）の招待コードで参加申請を行うとエラーになること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      const revokedCode = "revoked-uuid-1234";

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "失効家",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("familyInvites", {
          familyId,
          code: revokedCode,
          createdBy: "creator_uid",
          createdAt: Date.now() - 10000,
          expiresAt: Date.now() + 100000,
          revokedAt: Date.now() - 5000, // 無効化済み
          useCount: 0,
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant_revoked",
          email: "rev@example.com",
          updatedAt: Date.now(),
        });
      });

      const applicant = t.withIdentity({
        subject: "applicant_revoked",
        email: "rev@example.com",
      });

      await expect(
        applicant.query(api.families.getFamilyPublicInfo, {
          code: revokedCode,
        }),
      ).rejects.toThrow("revoked");

      await expect(
        applicant.mutation(api.families.createJoinRequest, {
          code: revokedCode,
        }),
      ).rejects.toThrow("revoked");
    });

    it("自家族以外の招待コードを無効化できないこと（認可チェック）", async () => {
      const t = convexTest(schema, modules);
      let familyAId!: Id<"families">;
      let familyBId!: Id<"families">;
      let inviteAId!: Id<"familyInvites">;

      await t.run(async (ctx) => {
        familyAId = await ctx.db.insert("families", {
          name: "家族A",
          updatedAt: Date.now(),
        });
        familyBId = await ctx.db.insert("families", {
          name: "家族B",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          familyId: familyAId,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          familyId: familyBId,
          updatedAt: Date.now(),
        });
        inviteAId = await ctx.db.insert("familyInvites", {
          familyId: familyAId,
          code: "invite-a",
          createdBy: "user_a",
          createdAt: Date.now(),
          expiresAt: Date.now() + 100000,
          useCount: 0,
        });
      });

      const userB = t.withIdentity({
        subject: "user_b",
        email: "b@example.com",
      });

      await expect(
        userB.mutation(api.families.revokeFamilyInvite, {
          inviteId: inviteAId,
        }),
      ).rejects.toThrow("Invite not found or access denied");
    });

    it("参加申請作成時にuseCountが加算され、joinRequests.invitedByCodeに記録されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "鈴木家",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "member_suzuki",
          email: "suzuki@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant_suzuki",
          email: "suzuki_app@example.com",
          updatedAt: Date.now(),
        });
      });

      const member = t.withIdentity({
        subject: "member_suzuki",
        email: "suzuki@example.com",
      });
      const applicant = t.withIdentity({
        subject: "applicant_suzuki",
        email: "suzuki_app@example.com",
      });

      const invite = await member.mutation(api.families.createFamilyInvite, {});

      const requestId = await applicant.mutation(
        api.families.createJoinRequest,
        { code: invite.code },
      );

      // 申請レコードの検証
      const joinReq = await t.run(async (ctx) => {
        return await ctx.db.get(requestId);
      });
      expect(joinReq?.invitedByCode).toBe(invite._id);

      // 招待レコードの useCount 検証
      const updatedInvite = await t.run(async (ctx) => {
        return await ctx.db.get(invite._id);
      });
      expect(updatedInvite?.useCount).toBe(1);
    });

    it("アカウント削除で最後のメンバーが退会した際、familyInvitesがカスケード削除されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let userId!: Id<"users">;
      let inviteId!: Id<"familyInvites">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "孤立予定家族",
          updatedAt: Date.now(),
        });
        userId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "lone_user",
          email: "lone@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        inviteId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "lone-invite",
          createdBy: "lone_user",
          createdAt: Date.now(),
          expiresAt: Date.now() + 100000,
          useCount: 0,
        });
      });

      const user = t.withIdentity({
        subject: "lone_user",
        email: "lone@example.com",
      });

      await user.mutation(api.users.deleteAccount, { accountId: userId });

      const remainingFamily = await t.run(async (ctx) => ctx.db.get(familyId));
      expect(remainingFamily).toBeNull();

      const remainingInvite = await t.run(async (ctx) => ctx.db.get(inviteId));
      expect(remainingInvite).toBeNull();
    });

    it("cleanupExpiredFamilyInvitesInternalで30日以上前の失効・期限切れレコードが削除されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let oldExpiredId!: Id<"familyInvites">;
      let oldRevokedId!: Id<"familyInvites">;
      let referencedOldExpiredId!: Id<"familyInvites">;
      let recentExpiredId!: Id<"familyInvites">;
      let activeId!: Id<"familyInvites">;

      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "クリーンアップテスト家",
          updatedAt: now,
        });

        // 31日前に期限切れ
        oldExpiredId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "old-expired",
          createdBy: "u",
          createdAt: thirtyOneDaysAgo - 1000,
          expiresAt: thirtyOneDaysAgo,
          useCount: 0,
        });

        // 31日前に無効化
        oldRevokedId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "old-revoked",
          createdBy: "u",
          createdAt: thirtyOneDaysAgo - 10000,
          expiresAt: now + 100000,
          revokedAt: thirtyOneDaysAgo,
          useCount: 0,
        });

        // 参加申請の監査証跡から参照されているため削除対象外
        referencedOldExpiredId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "referenced-old-expired",
          createdBy: "u",
          createdAt: thirtyOneDaysAgo - 1000,
          expiresAt: thirtyOneDaysAgo,
          useCount: 1,
        });
        const applicantAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "applicant",
          email: "applicant@example.com",
          updatedAt: thirtyOneDaysAgo,
        });
        await ctx.db.insert("joinRequests", {
          familyId,
          userId: "applicant",
          accountId: applicantAccId,
          invitedByCode: referencedOldExpiredId,
          status: "approved",
          createdAt: thirtyOneDaysAgo,
          updatedAt: thirtyOneDaysAgo,
        });

        // 10日前に期限切れ（まだ削除対象外）
        recentExpiredId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "recent-expired",
          createdBy: "u",
          createdAt: tenDaysAgo - 1000,
          expiresAt: tenDaysAgo,
          useCount: 0,
        });

        // 現在有効（削除対象外）
        activeId = await ctx.db.insert("familyInvites", {
          familyId,
          code: "active-code",
          createdBy: "u",
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000,
          useCount: 0,
        });
      });

      await t.mutation(
        internal.families.cleanupExpiredFamilyInvitesInternal,
        {},
      );

      const rOldExpired = await t.run((ctx) => ctx.db.get(oldExpiredId));
      const rOldRevoked = await t.run((ctx) => ctx.db.get(oldRevokedId));
      const rReferencedOldExpired = await t.run((ctx) =>
        ctx.db.get(referencedOldExpiredId),
      );
      const rRecentExpired = await t.run((ctx) => ctx.db.get(recentExpiredId));
      const rActive = await t.run((ctx) => ctx.db.get(activeId));

      expect(rOldExpired).toBeNull();
      expect(rOldRevoked).toBeNull();
      expect(rReferencedOldExpired).toBeDefined();
      expect(rRecentExpired).toBeDefined();
      expect(rActive).toBeDefined();
    });
  });

  describe("2.1.5 prepare / commit フローによる安全な家族移行機能の検証", () => {
    it("prepare で移行対象が確定し、commit で一括更新・旧Family削除が行われること", async () => {
      const t = convexTest(schema, modules);

      let oldFamilyId!: Id<"families">;
      let userSoloId!: Id<"users">;

      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "旧田中家",
          updatedAt: Date.now(),
        });

        // ユーザーA (唯一のメンバー)
        userSoloId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_solo",
          email: "solo@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });

        const rSolo = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_solo",
          accountId: userSoloId,
          familyId: oldFamilyId,
          title: "Solo's Record",
          sortKey: computeSortKey("Solo's Record"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });

        await ctx.db.insert("credentials", {
          recordId: rSolo,
          stableId: crypto.randomUUID(),
          passwordHint: "old_hint",
          passwordHintIv: "old_iv",
          order: 0,
          updatedAt: Date.now(),
        });
      });

      const userSolo = t.withIdentity({
        subject: "user_solo",
        email: "solo@example.com",
      });

      // 1. prepare: 新家族作成
      const prepareRes = await userSolo.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新田中家",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      expect(prepareRes.migrationId).toBeDefined();

      // この時点ではまだユーザーの familyId もレコードの familyId も更新されていない
      const { userBeforeCommit, recordBeforeCommit, credBeforeCommit } =
        await t.run(async (ctx) => {
          const user = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", "user_solo"))
            .unique();
          const record = await ctx.db
            .query("serviceRecords")
            .withIndex("by_userId", (q) => q.eq("userId", "user_solo"))
            .unique();
          const cred = record
            ? await ctx.db
                .query("credentials")
                .withIndex("by_recordId", (q) => q.eq("recordId", record._id))
                .first()
            : null;
          return {
            userBeforeCommit: user,
            recordBeforeCommit: record,
            credBeforeCommit: cred,
          };
        });
      expect(userBeforeCommit?.familyId).toBe(oldFamilyId);
      expect(recordBeforeCommit?.familyId).toBe(oldFamilyId);
      expect(credBeforeCommit?.passwordHint).toBe("old_hint");
      expect(credBeforeCommit?.passwordHintIv).toBe("old_iv");

      // 2. getMigrationForEncryption で暗号化対象を取得
      const migrationData = await userSolo.query(
        api.families.getMigrationForEncryption,
        { migrationId: prepareRes.migrationId },
      );
      expect(migrationData.records.length).toBe(1);

      const targetCredId = migrationData.records[0].credentials[0].id;

      // 3. commit
      const commitRes = await userSolo.mutation(
        api.families.commitFamilyMigration,
        {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: targetCredId,
              passwordHint: "new_hint",
              passwordHintIv: "new_iv",
            },
          ],
        },
      );

      expect(commitRes.success).toBe(true);
      expect(commitRes.familyId).toBe(prepareRes.targetFamilyId);

      // 4. DB状態の検証
      await t.run(async (ctx) => {
        // ユーザーの familyId が更新されている
        const updatedUser = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "user_solo"))
          .unique();
        expect(updatedUser?.familyId).toBe(prepareRes.targetFamilyId);

        // レコードの familyId と credentials が更新されている
        const record = await ctx.db
          .query("serviceRecords")
          .withIndex("by_userId", (q) => q.eq("userId", "user_solo"))
          .unique();
        expect(record?.familyId).toBe(prepareRes.targetFamilyId);

        expect(record).not.toBeNull();
        if (!record) throw new Error("Record not found");

        const cred = await ctx.db
          .query("credentials")
          .withIndex("by_recordId", (q) => q.eq("recordId", record._id))
          .first();
        expect(cred?.passwordHint).toBe("new_hint");
        expect(cred?.passwordHintIv).toBe("new_iv");

        // 旧Familyはメンバー0人になったので削除されていること
        const deletedOldFamily = await ctx.db.get(oldFamilyId);
        expect(deletedOldFamily).toBeNull();
      });
    });

    it("再暗号化対象の credential 更新を省略した commit は拒否されること", async () => {
      const t = convexTest(schema, modules);
      let oldFamilyId!: Id<"families">;
      let userOmitId!: Id<"users">;
      let credADocId!: Id<"credentials">;

      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "省略テスト家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          updatedAt: Date.now(),
        });
        userOmitId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_omit",
          email: "omit@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });
        const rOmit = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          title: "省略テストレコード",
          sortKey: computeSortKey("省略テストレコード"),
          tags: [],
          userId: "user_omit",
          accountId: userOmitId,
          familyId: oldFamilyId,
          ownerType: "user",
          admins: [],
          updatedAt: Date.now(),
        });

        credADocId = await ctx.db.insert("credentials", {
          recordId: rOmit,
          stableId: crypto.randomUUID(),
          passwordHint: "hint_a",
          passwordHintIv: "iv_a",
          order: 0,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: rOmit,
          stableId: crypto.randomUUID(),
          passwordHint: "hint_b",
          passwordHintIv: "iv_b",
          order: 1,
          updatedAt: Date.now(),
        });
      });

      const userOmit = t.withIdentity({
        subject: "user_omit",
        email: "omit@example.com",
      });

      const prepareRes = await userOmit.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新省略テスト家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      // cred_a のみ更新し cred_b を省略 → commit は失敗すべき
      await expect(
        userOmit.mutation(api.families.commitFamilyMigration, {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: credADocId,
              passwordHint: "new_hint_a",
              passwordHintIv: "new_iv_a",
            },
          ],
        }),
      ).rejects.toThrow("Missing re-encrypted credential update");
    });

    it("旧Familyに他メンバーが残る場合は旧Familyが削除されないこと", async () => {
      const t = convexTest(schema, modules);
      let oldFamilyId!: Id<"families">;

      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "共有家族",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_leaving",
          email: "leaving@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_staying",
          email: "staying@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });
      });

      const userLeaving = t.withIdentity({
        subject: "user_leaving",
        email: "leaving@example.com",
      });

      const prepareRes = await userLeaving.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "独立家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      await userLeaving.mutation(api.families.commitFamilyMigration, {
        migrationId: prepareRes.migrationId,
        credentials: [],
      });

      // 検証: 旧Familyが削除されずに残っていること
      await t.run(async (ctx) => {
        const oldFamily = await ctx.db.get(oldFamilyId);
        expect(oldFamily).not.toBeNull();
      });
    });

    it("二重コミットが防止されること (COMPLETED 済みの migration は再コミットできない)", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_double",
          email: "double@example.com",
          updatedAt: Date.now(),
        });
      });

      const userDouble = t.withIdentity({
        subject: "user_double",
        email: "double@example.com",
      });

      const prepareRes = await userDouble.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "二重テスト家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      // 1回目のコミット
      await userDouble.mutation(api.families.commitFamilyMigration, {
        migrationId: prepareRes.migrationId,
        credentials: [],
      });

      // 2回目のコミットはエラーになること
      await expect(
        userDouble.mutation(api.families.commitFamilyMigration, {
          migrationId: prepareRes.migrationId,
          credentials: [],
        }),
      ).rejects.toThrow("Migration is not in PREPARED status");
    });

    it("複数の serviceRecord 間で cred.id が重複する場合に recordId を含めることで誤更新を防止できること", async () => {
      const t = convexTest(schema, modules);
      let record1Id!: Id<"serviceRecords">;
      let record2Id!: Id<"serviceRecords">;
      let userDupCredId!: Id<"users">;

      await t.run(async (ctx) => {
        userDupCredId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_dup_cred",
          email: "dup@example.com",
          updatedAt: Date.now(),
        });

        record1Id = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_dup_cred",
          accountId: userDupCredId,
          familyId: undefined,
          title: "Service 1",
          sortKey: computeSortKey("Service 1"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: record1Id,
          stableId: crypto.randomUUID(),
          passwordHint: "r1_hint_old",
          passwordHintIv: "iv1",
          order: 0,
          updatedAt: Date.now(),
        });

        record2Id = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_dup_cred",
          accountId: userDupCredId,
          familyId: undefined,
          title: "Service 2",
          sortKey: computeSortKey("Service 2"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: record2Id,
          stableId: crypto.randomUUID(),
          passwordHint: "r2_hint_old",
          passwordHintIv: "iv2",
          order: 0,
          updatedAt: Date.now(),
        });
      });

      const userDup = t.withIdentity({
        subject: "user_dup_cred",
        email: "dup@example.com",
      });

      const prepareRes = await userDup.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "重複キーテスト家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      const migrationData = await userDup.query(
        api.families.getMigrationForEncryption,
        { migrationId: prepareRes.migrationId },
      );
      const r1 = migrationData.records.find((r) => r._id === record1Id);
      const r2 = migrationData.records.find((r) => r._id === record2Id);
      if (!r1 || !r2) throw new Error("Records not found in migration data");
      const r1CredId = r1.credentials[0].id;
      const r2CredId = r2.credentials[0].id;

      // recordId を付与してコミット
      await userDup.mutation(api.families.commitFamilyMigration, {
        migrationId: prepareRes.migrationId,
        credentials: [
          {
            recordId: record1Id,
            id: r1CredId,
            passwordHint: "r1_hint_new",
            passwordHintIv: "iv1_new",
          },
          {
            recordId: record2Id,
            id: r2CredId,
            passwordHint: "r2_hint_new",
            passwordHintIv: "iv2_new",
          },
        ],
      });

      await t.run(async (ctx) => {
        const cred1 = await ctx.db.get(r1CredId as Id<"credentials">);
        const cred2 = await ctx.db.get(r2CredId as Id<"credentials">);

        expect(cred1?.passwordHint).toBe("r1_hint_new");
        expect(cred2?.passwordHint).toBe("r2_hint_new");
      });
    });

    it("再度 prepare を呼び出した際、古い PREPARED 移行が EXPIRED となり孤児 Family が削除されること", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_orphan",
          email: "orphan@example.com",
          updatedAt: Date.now(),
        });
      });

      const userOrphan = t.withIdentity({
        subject: "user_orphan",
        email: "orphan@example.com",
      });

      // 1回目の prepare (作成された targetFamilyId1 は放置される)
      const prep1 = await userOrphan.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "放置ファミリー",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      // 2回目の prepare
      const prep2 = await userOrphan.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "最終ファミリー",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      await t.run(async (ctx) => {
        // 1回目の migration は EXPIRED
        const m1 = await ctx.db.get(prep1.migrationId);
        expect(m1?.status).toBe("EXPIRED");

        // 1回目の targetFamilyId は孤児になったため削除されていること
        const f1 = await ctx.db.get(prep1.targetFamilyId);
        expect(f1).toBeNull();

        // 2回目の targetFamilyId は存在していること
        const f2 = await ctx.db.get(prep2.targetFamilyId);
        expect(f2).not.toBeNull();
      });
    });

    it("cleanupExpiredMigrationsInternal を実行した際、期限切れの PREPARED 移行が EXPIRED となり孤児 Family が削除されること", async () => {
      const t = convexTest(schema, modules);
      let expiredFamilyId!: Id<"families">;
      let expiredMigrationId!: Id<"familyMigrations">;

      await t.run(async (ctx) => {
        const userAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_cron_test",
          email: "cron@example.com",
          updatedAt: Date.now(),
        });

        expiredFamilyId = await ctx.db.insert("families", {
          name: "期限切れ孤児ファミリー",
          updatedAt: Date.now(),
        });

        // 過去の期限切れ PREPARED レコードをダミー挿入
        expiredMigrationId = await ctx.db.insert("familyMigrations", {
          userId: "user_cron_test",
          accountId: userAccId,
          targetFamilyId: expiredFamilyId,
          serviceRecordIds: [],
          status: "PREPARED",
          createdAt: Date.now() - 3600 * 1000,
          expiresAt: Date.now() - 1800 * 1000, // 過去の時刻
        });
      });

      // cleanupExpiredMigrationsInternal の実行
      await t.mutation(internal.families.cleanupExpiredMigrationsInternal, {});

      await t.run(async (ctx) => {
        const migration = await ctx.db.get(expiredMigrationId);
        expect(migration?.status).toBe("EXPIRED");

        const family = await ctx.db.get(expiredFamilyId);
        expect(family).toBeNull();
      });
    });

    it("prepare 後に暗号化クレデンシャルを持つレコードが追加された場合、commitFamilyMigrationが競合エラーとなり何も書き換わらないこと", async () => {
      const t = convexTest(schema, modules);
      let oldFamilyId!: Id<"families">;
      let userMidId!: Id<"users">;
      let recordBeforeId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "旧家族",
          updatedAt: Date.now(),
        });

        userMidId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_mid",
          email: "mid@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });

        // prepare 前に存在するレコード
        recordBeforeId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          title: "テストレコード1",
          sortKey: computeSortKey("テストレコード1"),
          tags: [],
          userId: "user_mid",
          accountId: userMidId,
          familyId: oldFamilyId,
          ownerType: "user",
          admins: [],
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: recordBeforeId,
          stableId: crypto.randomUUID(),
          passwordHint: "before_hint",
          passwordHintIv: "before_iv",
          order: 0,
          updatedAt: Date.now(),
        });
      });

      const userMid = t.withIdentity({
        subject: "user_mid",
        email: "mid@example.com",
      });

      // 1. prepare
      const prepareRes = await userMid.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      // 2. prepare 後にレコードを追加 (30分以内を想定)
      let newRecordId!: Id<"serviceRecords">;
      await t.run(async (ctx) => {
        newRecordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          title: "テストレコード2",
          sortKey: computeSortKey("テストレコード2"),
          tags: [],
          userId: "user_mid",
          accountId: userMidId,
          familyId: oldFamilyId,
          ownerType: "user",
          admins: [],
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: newRecordId,
          stableId: crypto.randomUUID(),
          passwordHint: "after_hint",
          passwordHintIv: "after_iv",
          order: 0,
          updatedAt: Date.now(),
        });
      });

      // 3. commit (prepare後にレコードが追加されているため競合が検知され失敗すること)
      await expect(
        userMid.mutation(api.families.commitFamilyMigration, {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: "cred_before",
              passwordHint: "new_before_hint",
              passwordHintIv: "new_before_iv",
            },
            {
              id: "cred_after",
              passwordHint: "new_after_hint",
              passwordHintIv: "new_after_iv",
            },
          ],
        }),
      ).rejects.toThrow("Conflict detected");

      // 4. 検証: ロールバックされ、何も書き換わっていないこと
      await t.run(async (ctx) => {
        const migration = await ctx.db.get(prepareRes.migrationId);
        expect(migration?.status).toBe("PREPARED");

        const user = await ctx.db.get(userMidId);
        expect(user?.familyId).toBe(oldFamilyId);

        const recordBefore = await ctx.db.get(recordBeforeId);
        expect(recordBefore?.familyId).toBe(oldFamilyId);

        const credBefore = recordBefore
          ? await ctx.db
              .query("credentials")
              .withIndex("by_recordId", (q) =>
                q.eq("recordId", recordBefore._id),
              )
              .first()
          : null;
        expect(credBefore?.passwordHint).toBe("before_hint");

        const newRecord = await ctx.db.get(newRecordId);
        expect(newRecord?.familyId).toBe(oldFamilyId);

        const credAfter = newRecord
          ? await ctx.db
              .query("credentials")
              .withIndex("by_recordId", (q) => q.eq("recordId", newRecord._id))
              .first()
          : null;
        expect(credAfter?.passwordHint).toBe("after_hint");

        // 旧Familyも残っていること
        const oldFamily = await ctx.db.get(oldFamilyId);
        expect(oldFamily).not.toBeNull();
      });
    });

    it("abortFamilyMigration を呼び出した際、移行が ABORTED となりメンバー0人の targetFamily が削除されること", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_abort_test",
          email: "abort@example.com",
          updatedAt: Date.now(),
        });
      });

      const userAbort = t.withIdentity({
        subject: "user_abort_test",
        email: "abort@example.com",
      });

      const prepareRes = await userAbort.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "キャンセル予定ファミリー",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      const abortRes = await userAbort.mutation(
        api.families.abortFamilyMigration,
        { migrationId: prepareRes.migrationId },
      );

      expect(abortRes.success).toBe(true);

      await t.run(async (ctx) => {
        const migration = await ctx.db.get(prepareRes.migrationId);
        expect(migration?.status).toBe("ABORTED");

        const targetFamily = await ctx.db.get(prepareRes.targetFamilyId);
        expect(targetFamily).toBeNull();
      });
    });

    it("prepare後、commit前に暗号化クレデンシャルを持たない新規レコードが追加された場合、commitFamilyMigrationが競合エラーとなり何も書き換わらないこと", async () => {
      const t = convexTest(schema, modules);
      let oldFamilyId!: Id<"families">;
      let userSoloId!: Id<"users">;
      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "旧田中家",
          updatedAt: Date.now(),
        });
        userSoloId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_solo2",
          email: "solo2@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });
        const existRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_solo2",
          accountId: userSoloId,
          familyId: oldFamilyId,
          title: "既存レコード",
          sortKey: computeSortKey("既存レコード"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });
        await ctx.db.insert("credentials", {
          recordId: existRecId,
          stableId: crypto.randomUUID(),
          passwordHint: "old_hint",
          passwordHintIv: "old_iv",
          order: 0,
          updatedAt: Date.now(),
        });
      });
      const userSolo = t.withIdentity({
        subject: "user_solo2",
        email: "solo2@example.com",
      });

      const prepareRes = await userSolo.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新田中家",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );

      let newRecordId!: Id<"serviceRecords">;
      await t.run(async (ctx) => {
        newRecordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_solo2",
          accountId: userSoloId,
          familyId: oldFamilyId,
          title: "並行操作で追加されたレコード",
          sortKey: computeSortKey("並行操作で追加されたレコード"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });
      });

      await expect(
        userSolo.mutation(api.families.commitFamilyMigration, {
          migrationId: prepareRes.migrationId,
          credentials: [
            {
              id: "cred_a",
              passwordHint: "new_hint",
              passwordHintIv: "new_iv",
            },
          ],
        }),
      ).rejects.toThrow("Conflict detected");

      await t.run(async (ctx) => {
        const migration = await ctx.db.get(prepareRes.migrationId);
        expect(migration?.status).toBe("PREPARED");

        const newRecord = await ctx.db.get(newRecordId);
        expect(newRecord?.familyId).toBe(oldFamilyId);

        const existingRecord = await ctx.db
          .query("serviceRecords")
          .withIndex("by_userId", (q) => q.eq("userId", "user_solo2"))
          .filter((q) => q.eq(q.field("title"), "既存レコード"))
          .unique();
        expect(existingRecord?.familyId).toBe(oldFamilyId);

        const credExisting = existingRecord
          ? await ctx.db
              .query("credentials")
              .withIndex("by_recordId", (q) =>
                q.eq("recordId", existingRecord._id),
              )
              .first()
          : null;
        expect(credExisting?.passwordHint).toBe("old_hint");
      });
    });

    it("Family変更(移行)後、旧Familyの共有レコードへ本人がアクセスできなくなること", async () => {
      const t = convexTest(schema, modules);
      let oldFamilyId!: Id<"families">;
      let stayingSharedRecordId!: Id<"serviceRecords">;
      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "旧ファミリー",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_migrating",
          email: "migrating@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });
        const stayingId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_staying2",
          email: "staying2@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });
        stayingSharedRecordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_staying2",
          accountId: stayingId,
          familyId: oldFamilyId,
          ownerFamilyId: oldFamilyId,
          title: "旧ファミリーの共有レコード",
          sortKey: computeSortKey("旧ファミリーの共有レコード"),
          ownerType: "family",
          admins: [stayingId],
          tags: [],
          updatedAt: Date.now(),
        });
      });
      const userMigrating = t.withIdentity({
        subject: "user_migrating",
        email: "migrating@example.com",
      });

      const beforeDetail = await userMigrating.query(
        api.records.getRecordDetail,
        {
          id: stayingSharedRecordId,
        },
      );
      expect(beforeDetail.title).toBe("旧ファミリーの共有レコード");

      const prepareRes = await userMigrating.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新ファミリー",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "key_iv",
          masterKeySalt: "key_salt",
        },
      );
      await userMigrating.mutation(api.families.commitFamilyMigration, {
        migrationId: prepareRes.migrationId,
        credentials: [],
      });

      await expect(
        userMigrating.query(api.records.getRecordDetail, {
          id: stayingSharedRecordId,
        }),
      ).rejects.toThrow("Access denied");
    });
  });
});

import {
  decrypt,
  deriveKeyFromPasscode,
  encrypt,
  exportKeyToBase64,
  generateDEK,
  unwrapDEK,
  wrapDEK,
} from "@/lib/crypto";

describe("Family Passcode Rotation - Envelope Re-wrapping Integration", () => {
  it("旧パスコードでラップされたDEKが、新しいパスコードのマスターキーで正しく再ラップされ、データが復号可能な状態を維持できること", async () => {
    //---------------------------------------------------------
    // 1. 準備段階: 旧パスコードで暗号化されたレコードを模倣
    //---------------------------------------------------------
    const oldPasscode = "old-family-passcode-1234";
    const newPasscode = "new-family-passcode-5678";
    const secretHint = "super-secret-password-hint";

    // 鍵の導出 (ストレッチング等はモックするか、実関数を使用)
    const oldMasterKey = await deriveKeyFromPasscode(
      oldPasscode,
      "static-salt-for-test",
    );
    const newMasterKey = await deriveKeyFromPasscode(
      newPasscode,
      "static-salt-for-test",
    );

    // 個別DEKの生成とデータの暗号化
    const originalDek = await generateDEK();
    const encryptedHint = await encrypt(secretHint, originalDek);
    const wrappedDekOld = await wrapDEK(originalDek, oldMasterKey);

    // Convexに格納されていると仮定するダミーのデータ構造
    const mockDbCredential = {
      id: "cred-test-id",
      passwordHint: encryptedHint.encrypted,
      passwordHintIv: encryptedHint.iv,
      passwordHintDekEncrypted: wrappedDekOld.encrypted,
      passwordHintDekIv: wrappedDekOld.iv,
    };

    // ローテーション前: 旧マスターキーではアンラップでき、新マスターキーでは失敗することを確認
    await expect(
      unwrapDEK(
        mockDbCredential.passwordHintDekEncrypted,
        mockDbCredential.passwordHintDekIv,
        newMasterKey,
      ),
    ).rejects.toThrow();

    //---------------------------------------------------------
    // 2. 実行段階: family.tsx 内のローテーションロジックのシミュレーション
    //---------------------------------------------------------
    // ① 旧マスターキーを使ってDEKを取り出す
    const unwrappedDek = await unwrapDEK(
      mockDbCredential.passwordHintDekEncrypted,
      mockDbCredential.passwordHintDekIv,
      oldMasterKey,
    );

    // ② 取り出したDEKを、新しいマスターキーでラップし直す
    const reWrappedDek = await wrapDEK(unwrappedDek, newMasterKey);

    // ③ 新しいペイロードの作成（これがConvexのMutationに送信される）
    const rotatedCredentialPayload = {
      id: mockDbCredential.id,
      passwordHint: mockDbCredential.passwordHint, // 暗号文自体は不変
      passwordHintIv: mockDbCredential.passwordHintIv,
      passwordHintDekEncrypted: reWrappedDek.encrypted, // 新しい封筒
      passwordHintDekIv: reWrappedDek.iv,
    };

    //---------------------------------------------------------
    // 3. 検証段階: 新しいパスコード（新マスターキー）だけで復号ができるか
    //---------------------------------------------------------
    // 新しい鍵でDEKをアンラップできるか
    const decryptedDek = await unwrapDEK(
      rotatedCredentialPayload.passwordHintDekEncrypted,
      rotatedCredentialPayload.passwordHintDekIv,
      newMasterKey,
    );

    // 復号後のDEKが期待する鍵用途・アルゴリズム・生データと完全に一致することを検証
    expect(decryptedDek.algorithm.name).toBe("AES-GCM");
    expect(decryptedDek.usages).toEqual(["encrypt", "decrypt"]);
    expect(await exportKeyToBase64(decryptedDek)).toBe(
      await exportKeyToBase64(originalDek),
    );

    // アンラップしたDEKで、暗号文が元の平文に戻るか
    const finalPlainHint = await decrypt(
      rotatedCredentialPayload.passwordHint,
      rotatedCredentialPayload.passwordHintIv,
      decryptedDek,
    );

    // 鍵が書き換わっても、データの中身が正しく復元できること
    expect(finalPlainHint).toBe(secretHint);

    // ローテーション後: 旧マスターキー（旧パスコード）では復号できないことを検証
    await expect(
      unwrapDEK(
        rotatedCredentialPayload.passwordHintDekEncrypted,
        rotatedCredentialPayload.passwordHintDekIv,
        oldMasterKey,
      ),
    ).rejects.toThrow();
  });

  describe("2.1.5 家族移行（familyMigrations）のアカウント境界とアクセス制御", () => {
    it("同一Firebase UID内の別アカウントが準備したmigrationIdは実行できず、作成元アカウントのみ実行できること", async () => {
      const t = convexTest(schema, modules);

      let account1Id!: Id<"users">;
      let account2Id!: Id<"users">;

      // 同一 Firebase UID (user_multi) で2つのアカウントを作成
      await t.run(async (ctx) => {
        account1Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_multi",
          email: "multi@example.com",
          displayName: "アカウント1",
          updatedAt: Date.now(),
        });
        account2Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_multi",
          email: "multi@example.com",
          displayName: "アカウント2",
          updatedAt: Date.now(),
        });
      });

      const client1 = t.withIdentity({
        subject: "user_multi",
        email: "multi@example.com",
      });

      // アカウント1 で家族移行（新規家族作成）を prepare
      const { migrationId } = await client1.mutation(
        api.families.prepareFamilyMigration,
        {
          accountId: account1Id,
          action: "create",
          name: "マルチ家族",
          masterKeyEncrypted: "enc_key",
          masterKeyIv: "iv_key",
          masterKeySalt: "salt_key",
        },
      );

      expect(migrationId).toBeDefined();

      // DB内の migration に accountId が保存されていることを検証
      const migrationDoc = await t.run(async (ctx) => {
        return await ctx.db.get(migrationId);
      });
      expect(migrationDoc?.accountId).toBe(account1Id);

      // アカウント2 で同じ migrationId の暗号化データ取得を試みると拒否される
      await expect(
        client1.query(api.families.getMigrationForEncryption, {
          accountId: account2Id,
          migrationId,
        }),
      ).rejects.toThrow("Migration not found or access denied");

      // アカウント2 で同じ migrationId の commit を試みると拒否される
      await expect(
        client1.mutation(api.families.commitFamilyMigration, {
          accountId: account2Id,
          migrationId,
          credentials: [],
        }),
      ).rejects.toThrow("Migration not found or access denied");

      // アカウント2 で同じ migrationId の abort を試みると拒否される
      await expect(
        client1.mutation(api.families.abortFamilyMigration, {
          accountId: account2Id,
          migrationId,
        }),
      ).rejects.toThrow("Migration not found or access denied");

      // アカウント1 であれば暗号化データを取得・コミットできる
      const encryptionData = await client1.query(
        api.families.getMigrationForEncryption,
        {
          accountId: account1Id,
          migrationId,
        },
      );
      expect(encryptionData.migrationId).toBe(migrationId);

      const commitResult = await client1.mutation(
        api.families.commitFamilyMigration,
        {
          accountId: account1Id,
          migrationId,
          credentials: [],
        },
      );
      expect(commitResult.success).toBe(true);

      // アカウント1の familyId が更新され、アカウント2は影響を受けないこと
      const user1 = await t.run(async (ctx) => ctx.db.get(account1Id));
      const user2 = await t.run(async (ctx) => ctx.db.get(account2Id));
      expect(user1?.familyId).toBe(commitResult.familyId);
      expect(user2?.familyId).toBeUndefined();
    });

    it("家族移行時、共有レコードは旧家族に残り、離脱者が唯一の管理者だった場合は残りの家族メンバー全員が自動昇格すること", async () => {
      const t = convexTest(schema, modules);
      let familyOldId!: Id<"families">;
      let userLeaveId!: Id<"users">;
      let userRemain1Id!: Id<"users">;
      let userRemain2Id!: Id<"users">;
      let sharedRecordId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyOldId = await ctx.db.insert("families", {
          name: "Old Family",
          updatedAt: Date.now(),
        });

        userLeaveId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_leave",
          email: "leave@example.com",
          familyId: familyOldId,
          updatedAt: Date.now(),
        });

        userRemain1Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_remain1",
          email: "remain1@example.com",
          familyId: familyOldId,
          updatedAt: Date.now(),
        });

        userRemain2Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_remain2",
          email: "remain2@example.com",
          familyId: familyOldId,
          updatedAt: Date.now(),
        });

        sharedRecordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_leave",
          accountId: userLeaveId,
          familyId: familyOldId,
          ownerFamilyId: familyOldId,
          title: "Shared Record",
          sortKey: computeSortKey("Shared Record"),
          ownerType: "family",
          admins: [userLeaveId], // userLeave is the only admin
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const userLeaveClient = t.withIdentity({
        subject: "user_leave",
        email: "leave@example.com",
      });

      // userLeave が新家族を作成して移行
      const prep = await userLeaveClient.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "New Solo Family",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
        },
      );

      await userLeaveClient.mutation(api.families.commitFamilyMigration, {
        migrationId: prep.migrationId,
        credentials: [],
      });

      // DB検証: 共有レコードは旧家族に残り、admins が残った [userRemain1Id, userRemain2Id] に自動昇格されていること
      await t.run(async (ctx) => {
        const record = await ctx.db.get(sharedRecordId);
        expect(record?.familyId).toBe(familyOldId);
        expect(record?.ownerFamilyId).toBe(familyOldId);
        expect(record?.ownerType).toBe("family");
        expect(record?.admins).not.toContain(userLeaveId);
        expect([...(record?.admins ?? [])].sort()).toEqual(
          [userRemain1Id, userRemain2Id].sort(),
        );
      });
    });

    it("家族唯一のメンバーが移行して離脱した場合、孤立共有レコードおよび旧家族がクリーンアップされること", async () => {
      const t = convexTest(schema, modules);
      let familyOldId!: Id<"families">;
      let userSoloId!: Id<"users">;
      let sharedRecordId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyOldId = await ctx.db.insert("families", {
          name: "Old Solo Family",
          updatedAt: Date.now(),
        });
        userSoloId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_solo_leave",
          email: "solo_leave@example.com",
          familyId: familyOldId,
          updatedAt: Date.now(),
        });
        sharedRecordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "user_solo_leave",
          accountId: userSoloId,
          familyId: familyOldId,
          ownerFamilyId: familyOldId,
          title: "孤立する共有レコード",
          sortKey: computeSortKey("孤立する共有レコード"),
          ownerType: "family",
          admins: [userSoloId],
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const userSoloClient = t.withIdentity({
        subject: "user_solo_leave",
        email: "solo_leave@example.com",
      });

      const prep = await userSoloClient.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "New Family",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
        },
      );

      await userSoloClient.mutation(api.families.commitFamilyMigration, {
        migrationId: prep.migrationId,
        credentials: [],
      });

      // DB検証: 孤立した共有レコードおよびメンバー不在となった旧家族が削除されていること
      await t.run(async (ctx) => {
        expect(await ctx.db.get(sharedRecordId)).toBeNull();
        expect(await ctx.db.get(familyOldId)).toBeNull();
      });
    });
  });

  describe("2.1.5 KDFメタデータのスキーマ保存とバリデーション", () => {
    it("createFamily で指定した kdfIterations / cryptoVersion がそのまま保存されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf",
          email: "kdf@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf",
        email: "kdf@example.com",
      });
      const familyId = await user.mutation(api.families.createFamily, {
        name: "KDFテスト家族",
        masterKeyEncrypted: "enc",
        masterKeyIv: "iv",
        masterKeySalt: "salt",
        kdfIterations: 400_000,
        cryptoVersion: 1,
      });
      await t.run(async (ctx) => {
        const family = await ctx.db.get(familyId as Id<"families">);
        expect(family?.kdfIterations).toBe(400_000);
        expect(family?.cryptoVersion).toBe(1);
      });
    });

    it("kdfIterations を省略した場合、サーバー側でレガシー値(300,000)が補完されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_omit",
          email: "kdfomit@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_omit",
        email: "kdfomit@example.com",
      });
      const familyId = await user.mutation(api.families.createFamily, {
        name: "省略テスト家族",
        masterKeyEncrypted: "enc",
        masterKeyIv: "iv",
        masterKeySalt: "salt",
      });
      await t.run(async (ctx) => {
        const family = await ctx.db.get(familyId as Id<"families">);
        expect(family?.kdfIterations).toBe(300_000);
        expect(family?.cryptoVersion).toBe(1);
      });
    });

    it("範囲外の kdfIterations を指定した場合は作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_bad",
          email: "kdfbad@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_bad",
        email: "kdfbad@example.com",
      });
      await expect(
        user.mutation(api.families.createFamily, {
          name: "不正家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 10,
          cryptoVersion: 1,
        }),
      ).rejects.toThrow("out of the allowed range");
    });

    it("未対応の cryptoVersion を指定した場合は作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_ver",
          email: "kdfver@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_ver",
        email: "kdfver@example.com",
      });
      await expect(
        user.mutation(api.families.createFamily, {
          name: "未対応バージョン家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 300_000,
          cryptoVersion: 99,
        }),
      ).rejects.toThrow("Unsupported cryptoVersion");
    });

    it("NaN を kdfIterations として指定した場合は作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_nan",
          email: "kdfnan@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_nan",
        email: "kdfnan@example.com",
      });
      await expect(
        user.mutation(api.families.createFamily, {
          name: "NaNテスト家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: NaN,
          cryptoVersion: 1,
        }),
      ).rejects.toThrow("must be a safe integer");
    });

    it("Infinity を kdfIterations として指定した場合は作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_inf",
          email: "kdfinf@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_inf",
        email: "kdfinf@example.com",
      });
      await expect(
        user.mutation(api.families.createFamily, {
          name: "Infinityテスト家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: Infinity,
          cryptoVersion: 1,
        }),
      ).rejects.toThrow("must be a safe integer");
    });

    it("小数 を kdfIterations として指定した場合は作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_kdf_frac",
          email: "kdffrac@example.com",
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({
        subject: "user_kdf_frac",
        email: "kdffrac@example.com",
      });
      await expect(
        user.mutation(api.families.createFamily, {
          name: "小数テスト家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 300000.5,
          cryptoVersion: 1,
        }),
      ).rejects.toThrow("must be a safe integer");
    });
  });

  describe("2.1.6 既存データへのKDFメタデータ マイグレーション", () => {
    it("kdfIterations 未設定の家族に backfillKdfMetadataInternal を実行すると、レガシー値が補完されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "レガシー家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          updatedAt: Date.now(),
        });
      });
      await t.mutation(internal.families.backfillKdfMetadataInternal, {});
      await t.run(async (ctx) => {
        const family = await ctx.db.get(familyId);
        expect(family?.kdfIterations).toBe(300_000);
        expect(family?.cryptoVersion).toBe(1);
      });
    });

    it("既に kdfIterations が設定されている家族は上書きされないこと", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "新しめ家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 500_000,
          cryptoVersion: 1,
          updatedAt: Date.now(),
        });
      });
      await t.mutation(internal.families.backfillKdfMetadataInternal, {});
      await t.run(async (ctx) => {
        const family = await ctx.db.get(familyId);
        expect(family?.kdfIterations).toBe(500_000);
      });
    });
  });

  describe("2.1.7 パスコードローテーション (rotatePasscode)", () => {
    it("masterKey情報のみが更新され、users/serviceRecordsは変化しないこと", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let userAId!: Id<"users">;
      let userBId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "F1",
          masterKeyEncrypted: "b2xkRW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyIv: "dGVzdGl2MTIzNDU2",
          masterKeySalt: "dGVzdHNhbHQxMjM0NTY=",
          kdfIterations: 300_000,
          cryptoVersion: 1,
          updatedAt: 1000,
        });

        userAId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "ua",
          email: "a@a.com",
          familyId,
          updatedAt: 1000,
        });

        userBId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "ub",
          email: "b@b.com",
          familyId,
          updatedAt: 1000,
        });

        const r1 = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "ua",
          accountId: userAId,
          familyId,
          title: "R1",
          sortKey: computeSortKey("R1"),
          ownerType: "user",
          admins: [],
          tags: [],
          updatedAt: 2000,
        });
        await ctx.db.insert("credentials", {
          recordId: r1,
          stableId: crypto.randomUUID(),
          passwordHint: "SGVsbG8gV29ybGQgYXV0aGVudGljYXRlZCBhZWFk",
          passwordHintIv: "dGVzdGl2MTIzNDU2",
          passwordHintDekEncrypted: "ZGVrRGF0YUF1dGhlbnRpY2F0ZWQ=",
          passwordHintDekIv: "ZGVraXZkZWtpdjEyMzQ=",
          order: 0,
          updatedAt: 2000,
        });
      });

      const userA = t.withIdentity({ subject: "ua", email: "a@a.com" });
      const result = await userA.mutation(api.families.rotatePasscode, {
        previousMasterKeyEncrypted: "b2xkRW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
        masterKeyEncrypted: "bmV3RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
        masterKeyIv: "bmV3SXZuZXdJdjEy",
        masterKeySalt: "bmV3U2FsdE5ld1NhbHQ=",
        kdfIterations: 400_000,
        cryptoVersion: 1,
      });

      expect(result.success).toBe(true);

      const family = await t.run((ctx) => ctx.db.get(familyId));
      expect(family?.masterKeyEncrypted).toBe(
        "bmV3RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
      );
      expect(family?.masterKeyIv).toBe("bmV3SXZuZXdJdjEy");
      expect(family?.masterKeySalt).toBe("bmV3U2FsdE5ld1NhbHQ=");
      expect(family?.kdfIterations).toBe(400_000);
      expect(family?.cryptoVersion).toBe(1);

      // users や serviceRecords に変更がないことを確認
      const record = await t.run(async (ctx) =>
        ctx.db
          .query("serviceRecords")
          .withIndex("by_accountId", (q) => q.eq("accountId", userAId))
          .first(),
      );
      expect(record?.updatedAt).toBe(2000);

      const cred = await t.run(async (ctx) =>
        record
          ? ctx.db
              .query("credentials")
              .withIndex("by_recordId", (q) => q.eq("recordId", record._id))
              .first()
          : null,
      );
      expect(cred?.passwordHintDekEncrypted).toBe(
        "ZGVrRGF0YUF1dGhlbnRpY2F0ZWQ=",
      );

      const userAAfter = await t.run((ctx) => ctx.db.get(userAId));
      expect(userAAfter?.updatedAt).toBe(1000);
      expect(userAAfter?.familyId).toBe(familyId);

      const userBAfter = await t.run((ctx) => ctx.db.get(userBId));
      expect(userBAfter?.updatedAt).toBe(1000);
      expect(userBAfter?.familyId).toBe(familyId);
    });

    it("他メンバーや他端末での更新によりpreviousMasterKeyEncryptedがDB現在値と不一致の場合はCONFLICTとなること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "F1",
          masterKeyEncrypted: "Y3VycmVudEVuY3J5cHRlZERhdGFBdXRoZW50aWNhdGVk",
          masterKeyIv: "dGVzdGl2MTIzNDU2",
          masterKeySalt: "dGVzdHNhbHQxMjM0NTY=",
          updatedAt: 1000,
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "ua",
          email: "a@a.com",
          familyId,
          updatedAt: 1000,
        });
      });

      const userA = t.withIdentity({ subject: "ua", email: "a@a.com" });
      await expect(
        userA.mutation(api.families.rotatePasscode, {
          previousMasterKeyEncrypted:
            "c3RhbGVFbmNyeXB0ZWREYXRhQXV0aGVudGljYXRlZA==", // 古い値
          masterKeyEncrypted: "bmV3RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyIv: "bmV3SXZuZXdJdjEy",
          masterKeySalt: "bmV3U2FsdE5ld1NhbHQ=",
        }),
      ).rejects.toThrow("CONFLICT");
    });

    it("家族暗号化情報が未初期化の場合は拒否されること", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        const familyId = await ctx.db.insert("families", {
          name: "未初期化家族",
          updatedAt: 1000,
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "ua",
          email: "a@a.com",
          familyId,
          updatedAt: 1000,
        });
      });

      const userA = t.withIdentity({ subject: "ua", email: "a@a.com" });
      await expect(
        userA.mutation(api.families.rotatePasscode, {
          previousMasterKeyEncrypted:
            "YW55RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyEncrypted: "bmV3RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyIv: "bmV3SXZuZXdJdjEy",
          masterKeySalt: "bmV3U2FsdE5ld1NhbHQ=",
        }),
      ).rejects.toThrow("Family encryption is not initialized yet");
    });

    it("家族に所属していないユーザーからの呼び出しは拒否されること", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "no_family_user",
          email: "nofam@a.com",
          updatedAt: 1000,
        });
      });

      const noFamUser = t.withIdentity({
        subject: "no_family_user",
        email: "nofam@a.com",
      });

      await expect(
        noFamUser.mutation(api.families.rotatePasscode, {
          previousMasterKeyEncrypted:
            "YW55RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyEncrypted: "bmV3RW5jcnlwdGVkRGF0YUF1dGhlbnRpY2F0ZWQ=",
          masterKeyIv: "bmV3SXZuZXdJdjEy",
          masterKeySalt: "bmV3U2FsdE5ld1NhbHQ=",
        }),
      ).rejects.toThrow("User does not belong to a family");
    });
  });

  describe("2.1.13 メンバーキック機能とExport Vault（E2EEデータ持ち出し）の検証", () => {
    it("家族メンバーをキックすると、対象ユーザーのfamilyIdが解除され、Export Vaultが作成されること", async () => {
      const t = convexTest(schema, modules);

      let familyId!: Id<"families">;
      let userBId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "佐藤家",
          masterKeyEncrypted: "oldMasterKeyEncryptedBase64==",
          masterKeyIv: "oldMasterKeyIv==",
          masterKeySalt: "oldMasterKeySalt==",
          kdfIterations: 600000,
          cryptoVersion: 1,
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          displayName: "佐藤 太郎",
          familyId,
          updatedAt: Date.now(),
        });

        userBId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          displayName: "佐藤 次郎",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });
      const result = await userA.mutation(api.families.kickMember, {
        targetAccountId: userBId,
      });
      expect(result.success).toBe(true);

      // ユーザーBのfamilyIdが未設定になっていること
      const updatedUserB = await t.run(async (ctx) => ctx.db.get(userBId));
      expect(updatedUserB?.familyId).toBeUndefined();

      // Export Vaultが作成されていること
      const vault = await t.run(async (ctx) => {
        return await ctx.db
          .query("pendingExportVaults")
          .withIndex("by_accountId", (q) => q.eq("accountId", userBId))
          .first();
      });
      expect(vault).toBeDefined();
      expect(vault?.oldFamilyId).toBe(familyId);
      expect(vault?.oldFamilyName).toBe("佐藤家");
      expect(vault?.masterKeyEncrypted).toBe("oldMasterKeyEncryptedBase64==");
      expect(vault?.masterKeyIv).toBe("oldMasterKeyIv==");
      expect(vault?.masterKeySalt).toBe("oldMasterKeySalt==");
      expect(vault?.kdfIterations).toBe(600000);
      expect(vault?.cryptoVersion).toBe(1);
      expect(vault?.expiresAt).toBeGreaterThan(Date.now());
    });

    it("自分自身（または自分の別アカウント）をキックしようとすると拒否されること", async () => {
      const t = convexTest(schema, modules);

      let familyId!: Id<"families">;
      let userAId!: Id<"users">;
      let userA2Id!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "佐藤家",
          masterKeyEncrypted: "encKey",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          updatedAt: Date.now(),
        });

        userAId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          familyId,
          updatedAt: Date.now(),
        });

        // 同一UIDの別アカウント
        userA2Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a-work@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });

      // 同一アカウントのキック拒否
      await expect(
        userA.mutation(api.families.kickMember, { targetAccountId: userAId }),
      ).rejects.toThrow("Cannot kick yourself");

      // 同一UID別アカウントのキック拒否
      await expect(
        userA.mutation(api.families.kickMember, { targetAccountId: userA2Id }),
      ).rejects.toThrow("Cannot kick yourself");
    });

    it("別家族のユーザーをキックしようとすると拒否されること", async () => {
      const t = convexTest(schema, modules);

      let family1Id!: Id<"families">;
      let family2Id!: Id<"families">;
      let userOtherId!: Id<"users">;

      await t.run(async (ctx) => {
        family1Id = await ctx.db.insert("families", {
          name: "佐藤家",
          masterKeyEncrypted: "enc1",
          masterKeyIv: "iv1",
          masterKeySalt: "salt1",
          updatedAt: Date.now(),
        });
        family2Id = await ctx.db.insert("families", {
          name: "鈴木家",
          masterKeyEncrypted: "enc2",
          masterKeyIv: "iv2",
          masterKeySalt: "salt2",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          familyId: family1Id,
          updatedAt: Date.now(),
        });

        userOtherId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_other",
          email: "other@example.com",
          familyId: family2Id,
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });
      await expect(
        userA.mutation(api.families.kickMember, {
          targetAccountId: userOtherId,
        }),
      ).rejects.toThrow("Target user is not a member of your family");
    });

    it("キックされたユーザーがadminsに含まれる共有レコードから除外され、管理者が調停されること", async () => {
      const t = convexTest(schema, modules);

      let familyId!: Id<"families">;
      let userAId!: Id<"users">;
      let userBId!: Id<"users">;
      let sharedRecId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "田中家",
          masterKeyEncrypted: "encKey",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
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
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          familyId,
          updatedAt: Date.now(),
        });

        // ユーザーBのみが管理者となっている共有レコード
        sharedRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          title: "家族Netflix",
          sortKey: "netflix",
          userId: "user_b",
          accountId: userBId,
          familyId,
          ownerType: "family",
          ownerFamilyId: familyId,
          admins: [userBId],
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });
      await userA.mutation(api.families.kickMember, {
        targetAccountId: userBId,
      });

      // 管理者が0人になるため、残存メンバー（userAId）に自動昇格調停されていること
      const record = await t.run(async (ctx) => ctx.db.get(sharedRecId));
      expect(record?.admins).toEqual([userAId]);
      expect(record?.ownerFamilyId).toBe(familyId);
    });

    it("getMyPendingExportVault / abandonPendingExportVault が正しく動作すること", async () => {
      const t = convexTest(schema, modules);

      let familyId!: Id<"families">;
      let userBId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "高橋家",
          masterKeyEncrypted: "encKey",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          familyId,
          updatedAt: Date.now(),
        });

        userBId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });
      const userB = t.withIdentity({
        subject: "user_b",
        email: "b@example.com",
      });

      // キック前はnull
      const vaultBefore = await userB.query(
        api.families.getMyPendingExportVault,
        {},
      );
      expect(vaultBefore).toBeNull();

      // キック実行
      await userA.mutation(api.families.kickMember, {
        targetAccountId: userBId,
      });

      // キック後はVaultが取得できること
      const vaultAfter = await userB.query(
        api.families.getMyPendingExportVault,
        {},
      );
      expect(vaultAfter).not.toBeNull();
      expect(vaultAfter?.oldFamilyName).toBe("高橋家");

      // 放棄（手動破棄）
      await userB.mutation(api.families.abandonPendingExportVault, {});

      // 破棄後はnull
      const vaultAfterAbandon = await userB.query(
        api.families.getMyPendingExportVault,
        {},
      );
      expect(vaultAfterAbandon).toBeNull();
    });

    it("期限切れのExport Vaultは定期クリーンアップ（cleanupExpiredExportVaultsInternal）で削除されること", async () => {
      const t = convexTest(schema, modules);

      let userBId!: Id<"users">;

      await t.run(async (ctx) => {
        const famId = await ctx.db.insert("families", {
          name: "旧家",
          updatedAt: Date.now(),
        });

        userBId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          updatedAt: Date.now(),
        });

        // 過去の失効済みVault
        await ctx.db.insert("pendingExportVaults", {
          accountId: userBId,
          userId: "user_b",
          oldFamilyId: famId,
          oldFamilyName: "旧家",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
          expiresAt: Date.now() - 1000, // 期限切れ
        });
      });

      const userB = t.withIdentity({
        subject: "user_b",
        email: "b@example.com",
      });

      // 期限切れなのでgetMyPendingExportVaultからはnull
      const vault = await userB.query(api.families.getMyPendingExportVault, {});
      expect(vault).toBeNull();

      // クリーンアップ実行
      await t.mutation(
        internal.families.cleanupExpiredExportVaultsInternal,
        {},
      );

      // DBからも物理削除されていること
      const count = await t.run(async (ctx) => {
        const list = await ctx.db.query("pendingExportVaults").collect();
        return list.length;
      });
      expect(count).toBe(0);
    });

    it("キックされたユーザーが新家族を作成して個人レコードを持ち出すと、移行完了時にVaultが削除されること", async () => {
      const t = convexTest(schema, modules);

      let oldFamilyId!: Id<"families">;
      let userBId!: Id<"users">;
      let personalRecId!: Id<"serviceRecords">;
      let credDocId!: Id<"credentials">;

      await t.run(async (ctx) => {
        oldFamilyId = await ctx.db.insert("families", {
          name: "小林家",
          masterKeyEncrypted: "oldEncKey",
          masterKeyIv: "oldIv",
          masterKeySalt: "oldSalt",
          updatedAt: Date.now(),
        });

        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_a",
          email: "a@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });

        userBId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_b",
          email: "b@example.com",
          familyId: oldFamilyId,
          updatedAt: Date.now(),
        });

        // ユーザーBの個人所有レコード（PRIVATE）
        personalRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          title: "個人銀行",
          sortKey: "personal_bank",
          userId: "user_b",
          accountId: userBId,
          familyId: oldFamilyId,
          ownerType: "user",
          tags: [],
          updatedAt: Date.now(),
        });

        credDocId = await ctx.db.insert("credentials", {
          recordId: personalRecId,
          stableId: crypto.randomUUID(),
          label: "メイン",
          loginId: "userBLogin",
          passwordHint: "oldEncryptedHint",
          passwordHintIv: "oldHintIv",
          updatedAt: Date.now(),
        });
      });

      const userA = t.withIdentity({
        subject: "user_a",
        email: "a@example.com",
      });
      const userB = t.withIdentity({
        subject: "user_b",
        email: "b@example.com",
      });

      // ユーザーAがユーザーBをキック
      await userA.mutation(api.families.kickMember, {
        targetAccountId: userBId,
      });

      // ユーザーBのVaultが存在することを確認
      const myVault = await userB.query(
        api.families.getMyPendingExportVault,
        {},
      );
      expect(myVault).not.toBeNull();

      // ユーザーBが新家族を作成して個人データを移行
      const { migrationId, targetFamilyId } = await userB.mutation(
        api.families.prepareFamilyMigration,
        {
          action: "create",
          name: "新しいBの家",
          masterKeyEncrypted: "newEncKey",
          masterKeyIv: "newIv",
          masterKeySalt: "newSalt",
        },
      );

      // 移行コミット（再暗号化クレデンシャルを渡す）
      await userB.mutation(api.families.commitFamilyMigration, {
        migrationId,
        credentials: [
          {
            recordId: personalRecId,
            id: credDocId,
            passwordHint: "newReEncryptedHint",
            passwordHintIv: "newHintIv",
          },
        ],
      });

      // 移行後、ユーザーBの新家族が反映されていること
      const updatedUserB = await t.run(async (ctx) => ctx.db.get(userBId));
      expect(updatedUserB?.familyId).toBe(targetFamilyId);

      // 個人レコードのfamilyIdが新家族に更新されていること
      const updatedRecord = await t.run(async (ctx) =>
        ctx.db.get(personalRecId),
      );
      expect(updatedRecord?.familyId).toBe(targetFamilyId);

      // クレデンシャルが新暗号データに更新されていること
      const updatedCred = await t.run(async (ctx) => ctx.db.get(credDocId));
      expect(updatedCred?.passwordHint).toBe("newReEncryptedHint");

      // 持ち出し完了に伴い、Export Vaultが自動削除されていること
      const vaultAfterCommit = await userB.query(
        api.families.getMyPendingExportVault,
        {},
      );
      expect(vaultAfterCommit).toBeNull();
    });
  });

  describe("家族ロール管理（updateMemberRole & 認可・不変条件ガード）", () => {
    it("ファミリー管理者は他のメンバーを昇格・降格できること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let targetAccId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Role Test Family",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "admin_user",
          email: "admin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        targetAccId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "target_user",
          email: "target@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const adminUser = t.withIdentity({
        subject: "admin_user",
        email: "admin@example.com",
      });

      // 昇格: viewer -> admin
      await adminUser.mutation(api.families.updateMemberRole, {
        targetAccountId: targetAccId,
        role: "admin",
      });

      await t.run(async (ctx) => {
        const u = await ctx.db.get(targetAccId);
        expect(u?.familyRole).toBe("admin");
      });

      // 降格: admin -> viewer (adminAccId がまだ管理者に残っているため可能)
      await adminUser.mutation(api.families.updateMemberRole, {
        targetAccountId: targetAccId,
        role: "viewer",
      });

      await t.run(async (ctx) => {
        const u = await ctx.db.get(targetAccId);
        expect(u?.familyRole).toBe("viewer");
      });
    });

    it("デフォルト閲覧者によるupdateMemberRoleは拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let targetAccId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Role Test Family",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "admin_user",
          email: "admin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        targetAccId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const viewerUser = t.withIdentity({
        subject: "viewer_user",
        email: "viewer@example.com",
      });

      await expect(
        viewerUser.mutation(api.families.updateMemberRole, {
          targetAccountId: targetAccId,
          role: "admin",
        }),
      ).rejects.toThrow("Access denied: Admin role required");
    });

    it("最後の管理者の降格は拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let soleAdminAccId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Role Test Family",
          updatedAt: Date.now(),
        });
        soleAdminAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "sole_admin_user",
          email: "soleadmin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const soleAdmin = t.withIdentity({
        subject: "sole_admin_user",
        email: "soleadmin@example.com",
      });

      await expect(
        soleAdmin.mutation(api.families.updateMemberRole, {
          targetAccountId: soleAdminAccId,
          role: "viewer",
        }),
      ).rejects.toThrow("Cannot demote the last admin");
    });

    it("kickMember: 閲覧者によるキックおよび自分自身のキックは拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let adminAccId!: Id<"users">;
      let viewerAccId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Kick Test Family",
          updatedAt: Date.now(),
        });
        adminAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "admin_user",
          email: "admin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        viewerAccId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const viewerUser = t.withIdentity({
        subject: "viewer_user",
        email: "viewer@example.com",
      });
      const adminUser = t.withIdentity({
        subject: "admin_user",
        email: "admin@example.com",
      });

      // 閲覧者によるキックは拒否
      await expect(
        viewerUser.mutation(api.families.kickMember, {
          targetAccountId: adminAccId,
        }),
      ).rejects.toThrow("Access denied: Admin role required");

      // 自分自身のキックは拒否
      await expect(
        adminUser.mutation(api.families.kickMember, {
          targetAccountId: adminAccId,
        }),
      ).rejects.toThrow("Cannot kick yourself");

      // 管理者による閲覧者メンバーのキックは成功
      await adminUser.mutation(api.families.kickMember, {
        targetAccountId: viewerAccId,
      });
      await t.run(async (ctx) => {
        const u = await ctx.db.get(viewerAccId);
        expect(u?.familyId).toBeUndefined();
      });
    });

    it("approveJoinRequest / rejectJoinRequest: ファミリー管理者のみ承認・却下でき、閲覧者は拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let req1Id!: Id<"joinRequests">;
      let req2Id!: Id<"joinRequests">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Join Approval Family",
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "admin_user",
          email: "admin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        const app1AccId = await ctx.db.insert("users", {
          userId: "applicant_1",
          email: "app1@example.com",
          familyRole: "viewer",
          updatedAt: Date.now(),
        });
        const app2AccId = await ctx.db.insert("users", {
          userId: "applicant_2",
          email: "app2@example.com",
          familyRole: "viewer",
          updatedAt: Date.now(),
        });
        req1Id = await ctx.db.insert("joinRequests", {
          familyId,
          userId: "applicant_1",
          accountId: app1AccId,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        req2Id = await ctx.db.insert("joinRequests", {
          familyId,
          userId: "applicant_2",
          accountId: app2AccId,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const viewer = t.withIdentity({
        subject: "viewer_user",
        email: "viewer@example.com",
      });
      const admin = t.withIdentity({
        subject: "admin_user",
        email: "admin@example.com",
      });

      // 閲覧者による承認・却下は Admin role required で拒否されること
      await expect(
        viewer.mutation(api.families.approveJoinRequest, {
          requestId: req1Id,
        }),
      ).rejects.toThrow("Access denied: Admin role required");

      await expect(
        viewer.mutation(api.families.rejectJoinRequest, {
          requestId: req2Id,
        }),
      ).rejects.toThrow("Access denied: Admin role required");

      // 管理者による承認・却下は成功すること
      await admin.mutation(api.families.approveJoinRequest, {
        requestId: req1Id,
      });
      await admin.mutation(api.families.rejectJoinRequest, {
        requestId: req2Id,
      });

      await t.run(async (ctx) => {
        const r1 = await ctx.db.get(req1Id);
        expect(r1?.status).toBe("approved");
        const r2 = await ctx.db.get(req2Id);
        expect(r2?.status).toBe("rejected");
      });
    });

    it("reconcileAdminsOnLeave: ファミリー管理者が残存している場合、adminsが空のレコードで閲覧者は自動昇格しないこと", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let leavingAdminId!: Id<"users">;
      let remainingAdminId!: Id<"users">;
      let viewerId!: Id<"users">;
      let sharedRecId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Leave Reconcile Family",
          updatedAt: Date.now(),
        });
        leavingAdminId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "leaving_admin",
          email: "leaving@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        remainingAdminId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "remaining_admin",
          email: "remaining@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        viewerId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_member",
          email: "viewer_member@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        sharedRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "leaving_admin",
          accountId: leavingAdminId,
          familyId,
          ownerFamilyId: familyId,
          title: "Shared Without Explicit Admins",
          sortKey: "shared",
          ownerType: "family",
          admins: [], // ファミリー管理者に委ねられている
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const remainingAdmin = t.withIdentity({
        subject: "remaining_admin",
        email: "remaining@example.com",
      });

      // remainingAdmin が leavingAdmin をキック（家族離脱時の reconcileAdminsOnLeave をトリガー）
      await remainingAdmin.mutation(api.families.kickMember, {
        targetAccountId: leavingAdminId,
      });

      // 残存メンバーに remainingAdmin がいるため、sharedRecId の admins は [] のまま維持され、viewerId は追加されないこと
      await t.run(async (ctx) => {
        const rec = await ctx.db.get(sharedRecId);
        expect(rec?.admins).toEqual([]);
        expect(rec?.admins).not.toContain(viewerId);
        expect(rec?.admins).not.toContain(remainingAdminId);
      });
    });
  });
});
