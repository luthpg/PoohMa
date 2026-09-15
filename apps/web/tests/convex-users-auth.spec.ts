import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { resolveAccount } from "../convex/customBuilders";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

describe("users.ts & customBuilders.ts / 認証・認可・セキュリティ境界の検証", () => {
  describe("未認証アクセスの拒否", () => {
    it("未認証で syncUser を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.users.syncUser, { displayName: "x" }),
      ).rejects.toThrow("Unauthenticated");
    });

    it("未認証で createAccount を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.users.createAccount, { name: "x" }),
      ).rejects.toThrow("Unauthenticated");
    });

    it("未認証で getAccounts を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(t.query(api.users.getAccounts, {})).rejects.toThrow(
        "Unauthenticated",
      );
    });

    it("未認証で updateProfile を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.users.updateProfile, { displayName: "x" }),
      ).rejects.toThrow("Unauthenticated");
    });

    it("未認証で deleteAccount を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(t.mutation(api.users.deleteAccount, {})).rejects.toThrow(
        "Unauthenticated",
      );
    });

    it("未認証で deleteAllAccounts を実行した場合、例外がスローされること", async () => {
      const t = convexTest(schema, modules);
      await expect(t.mutation(api.users.deleteAllAccounts, {})).rejects.toThrow(
        "Unauthenticated",
      );
    });
  });

  describe("syncUser の Identity 検証・条件分岐", () => {
    it("syncUserはidentity由来のuid/emailのみを使用し、引数に紛れ込ませた偽装値を受け入れないこと", async () => {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "real_uid_123",
        email: "real@example.com",
        emailVerified: true,
      });

      await expect(
        user.mutation(api.users.syncUser, {
          displayName: "Real User",
          userId: "spoofed_admin_uid",
          email: "spoofed@example.com",
        } as never),
      ).rejects.toThrow();

      await user.mutation(api.users.syncUser, { displayName: "Real User" });

      await t.run(async (ctx) => {
        const spoofed = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "spoofed_admin_uid"))
          .first();
        expect(spoofed).toBeNull();

        const real = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", "real_uid_123"))
          .first();
        expect(real).not.toBeNull();
        expect(real?.email).toBe("real@example.com");
        expect(real?.userId).toBe("real_uid_123");
      });
    });

    it("emailVerifiedがfalseまたはemail未設定の場合、syncUserが拒否されること", async () => {
      const t = convexTest(schema, modules);
      const unverified = t.withIdentity({
        subject: "unverified_uid",
        email: "unverified@example.com",
        emailVerified: false,
      });
      await expect(
        unverified.mutation(api.users.syncUser, { displayName: "Unverified" }),
      ).rejects.toThrow("Email is required");

      const noEmail = t.withIdentity({
        subject: "no_email_uid",
        emailVerified: true,
      });
      await expect(
        noEmail.mutation(api.users.syncUser, { displayName: "NoEmail" }),
      ).rejects.toThrow("Email is required");
    });

    it("既存アカウントが存在する場合、photoURLやdisplayName（未設定時のみ）が最新化されること", async () => {
      const t = convexTest(schema, modules);
      let acc1Id!: Id<"users">;
      let acc2Id!: Id<"users">;

      await t.run(async (ctx) => {
        acc1Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "existing_user_uid",
          email: "old@example.com",
          photoURL: "https://old.com/photo.png",
          updatedAt: 1000,
        });
        acc2Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "existing_user_uid",
          email: "old@example.com",
          displayName: "設定済み名",
          photoURL: "https://old.com/photo2.png",
          updatedAt: 1000,
        });
      });

      const user = t.withIdentity({
        subject: "existing_user_uid",
        email: "new@example.com",
        emailVerified: true,
      });

      // photoURL を省略した場合は既存の photoURL が維持される
      const returnedAccountId = await user.mutation(api.users.syncUser, {
        displayName: "新規表示名",
      });
      expect(returnedAccountId).toBe(acc1Id);

      await t.run(async (ctx) => {
        const acc1 = await ctx.db.get(acc1Id);
        const acc2 = await ctx.db.get(acc2Id);
        expect(acc1?.email).toBe("new@example.com");
        expect(acc1?.photoURL).toBe("https://old.com/photo.png"); // 既存のphotoURLが維持
        expect(acc1?.displayName).toBe("新規表示名"); // 未設定だったので補完される

        expect(acc2?.email).toBe("new@example.com");
        expect(acc2?.photoURL).toBe("https://old.com/photo2.png");
        expect(acc2?.displayName).toBe("設定済み名"); // 既に設定されていたので上書きされない
      });
    });

    it("同一メールで別UIDのレコードが存在する場合、各レコードやリクエストが新UIDに移行され、アカウントIDが返されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let oldAccId1!: Id<"users">;
      let oldAccId2!: Id<"users">;
      let recordId!: Id<"serviceRecords">;
      let joinReqId!: Id<"joinRequests">;
      let migrationId!: Id<"familyMigrations">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "移行テスト家族",
          updatedAt: Date.now(),
        });
        oldAccId1 = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "old_firebase_uid",
          email: "recreated@example.com",
          familyId,
          updatedAt: 1000,
        });
        oldAccId2 = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "old_firebase_uid",
          email: "recreated@example.com",
          displayName: "保持される名前",
          familyId,
          updatedAt: 1000,
        });
        recordId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "old_firebase_uid",
          accountId: oldAccId1,
          title: "旧レコード",
          tags: [],
          updatedAt: 1000,
        });
        joinReqId = await ctx.db.insert("joinRequests", {
          familyId,
          userId: "old_firebase_uid",
          accountId: oldAccId1,
          status: "pending",
          createdAt: 1000,
          updatedAt: 1000,
        });
        migrationId = await ctx.db.insert("familyMigrations", {
          userId: "old_firebase_uid",
          accountId: oldAccId1,
          targetFamilyId: familyId,
          serviceRecordIds: [recordId],
          status: "PREPARED",
          createdAt: 1000,
          expiresAt: 2000,
        });
      });

      const newUser = t.withIdentity({
        subject: "new_firebase_uid",
        email: "recreated@example.com",
        emailVerified: true,
      });

      const res = await newUser.mutation(api.users.syncUser, {
        displayName: "再作成後ユーザー",
        photoURL: "https://new.com/recreated.png",
      });
      expect(res).toBe(oldAccId1);

      await t.run(async (ctx) => {
        const rec = await ctx.db.get(recordId);
        expect(rec?.userId).toBe("new_firebase_uid");

        const req = await ctx.db.get(joinReqId);
        expect(req?.userId).toBe("new_firebase_uid");

        const mig = await ctx.db.get(migrationId);
        expect(mig?.userId).toBe("new_firebase_uid");

        const acc1 = await ctx.db.get(oldAccId1);
        expect(acc1?.userId).toBe("new_firebase_uid");
        expect(acc1?.displayName).toBe("再作成後ユーザー");
        expect(acc1?.photoURL).toBe("https://new.com/recreated.png");

        const acc2 = await ctx.db.get(oldAccId2);
        expect(acc2?.userId).toBe("new_firebase_uid");
        expect(acc2?.displayName).toBe("保持される名前"); // 既存名は上書きされない
      });
    });

    it("新規ユーザーの初回 syncUser で accountId が返され、その ID を用いて recordLogin が正常に完了すること", async () => {
      const t = convexTest(schema, modules);
      const brandNewUser = t.withIdentity({
        subject: "brand_new_uid",
        email: "brandnew@example.com",
        emailVerified: true,
      });

      // 1. 初回 syncUser 実行
      const accountId = await brandNewUser.mutation(api.users.syncUser, {
        displayName: "新規太郎",
        photoURL: "https://example.com/taro.png",
      });
      expect(accountId).toBeDefined();

      await t.run(async (ctx) => {
        const created = await ctx.db.get(accountId);
        expect(created).not.toBeNull();
        expect(created?.userId).toBe("brand_new_uid");
        expect(created?.email).toBe("brandnew@example.com");
        expect(created?.displayName).toBe("新規太郎");
      });

      // 2. 返された accountId で recordLogin を実行（新規端末）
      const loginRes1 = await brandNewUser.mutation(api.users.recordLogin, {
        deviceId: "new_device_uuid_1",
        accountId,
        deviceName: "MacBook Pro",
        browser: "Chrome",
        os: "macOS",
        ipAddress: "198.51.100.1",
        location: "Tokyo, Japan",
      });
      expect(loginRes1.success).toBe(true);
      expect(loginRes1.isNewDevice).toBe(true);

      // loginEvents に正常に記録されていることを確認
      await t.run(async (ctx) => {
        const events = await ctx.db
          .query("loginEvents")
          .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
          .collect();
        expect(events).toHaveLength(1);
        expect(events[0].deviceId).toBe("new_device_uuid_1");
        expect(events[0].accountId).toBe(accountId);
        expect(events[0].userId).toBe("brand_new_uid");
        expect(events[0].isNewDevice).toBe(true);
      });

      // 3. 同じ端末から再度 recordLogin（既存端末判定）
      const loginRes2 = await brandNewUser.mutation(api.users.recordLogin, {
        deviceId: "new_device_uuid_1",
        accountId,
      });
      expect(loginRes2.success).toBe(true);
      expect(loginRes2.isNewDevice).toBe(false);

      // 4. 別の端末から recordLogin（新規端末判定）
      const loginRes3 = await brandNewUser.mutation(api.users.recordLogin, {
        deviceId: "another_device_uuid_2",
        accountId,
      });
      expect(loginRes3.success).toBe(true);
      expect(loginRes3.isNewDevice).toBe(true);
    });
  });

  describe("createAccount の検証", () => {
    it("emailVerifiedがfalseまたはemail未設定の場合はアカウント作成が拒否されること", async () => {
      const t = convexTest(schema, modules);
      const unverified = t.withIdentity({
        subject: "unverified_uid_ca",
        email: "unverified@example.com",
        emailVerified: false,
      });
      await expect(
        unverified.mutation(api.users.createAccount, { name: "Test" }),
      ).rejects.toThrow("Email is required");

      const noEmail = t.withIdentity({
        subject: "no_email_uid_ca",
        emailVerified: true,
      });
      await expect(
        noEmail.mutation(api.users.createAccount, { name: "Test" }),
      ).rejects.toThrow("Email is required");
    });

    it("アカウント名が空文字または空白のみの場合は拒否されること", async () => {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "valid_uid_empty_name",
        email: "valid@example.com",
        emailVerified: true,
      });
      await expect(
        user.mutation(api.users.createAccount, { name: "   " }),
      ).rejects.toThrow("アカウント名を入力してください");
    });

    it("正常にアカウントが作成され、pictureUrlが引き継がれること", async () => {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "valid_uid_ca",
        email: "valid@example.com",
        emailVerified: true,
        pictureUrl: "https://avatar.com/pic.png",
      });
      const accId = await user.mutation(api.users.createAccount, {
        name: "  サブアカウント  ",
      });
      expect(accId).toBeDefined();

      await t.run(async (ctx) => {
        const acc = await ctx.db.get(accId);
        expect(acc?.displayName).toBe("サブアカウント");
        expect(acc?.photoURL).toBe("https://avatar.com/pic.png");
      });
    });
  });

  describe("updateProfile の認可・検証", () => {
    it("存在しない accountId や他人の accountId を指定した場合に拒否されること", async () => {
      const t = convexTest(schema, modules);
      let otherAccId!: Id<"users">;
      await t.run(async (ctx) => {
        otherAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "other_user_owner",
          email: "other@example.com",
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "caller_user",
        email: "caller@example.com",
        emailVerified: true,
      });
      await user.mutation(api.users.syncUser, { displayName: "Caller" });

      // 他人の accountId (resolveAccount で Unauthorized)
      await expect(
        user.mutation(api.users.updateProfile, {
          accountId: otherAccId,
          displayName: "Hacked",
        }),
      ).rejects.toThrow("Unauthorized");

      // 存在しない accountId (resolveAccount で Unauthorized)
      let nonExistentId!: Id<"users">;
      await t.run(async (ctx) => {
        const dummy = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "temp",
          email: "temp@example.com",
          updatedAt: Date.now(),
        });
        await ctx.db.delete(dummy);
        nonExistentId = dummy;
      });
      await expect(
        user.mutation(api.users.updateProfile, {
          accountId: nonExistentId,
          displayName: "Hacked NonExistent",
        }),
      ).rejects.toThrow("Unauthorized");
    });

    it("accountId省略時はデフォルトアカウントが更新され、名前がトリムされること", async () => {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "update_prof_user",
        email: "prof@example.com",
        emailVerified: true,
      });
      await user.mutation(api.users.syncUser, { displayName: "Init" });

      const res = await user.mutation(api.users.updateProfile, {
        displayName: "  Trimmed Name  ",
      });
      expect(res.success).toBe(true);

      const accounts = await user.query(api.users.getAccounts, {});
      expect(accounts[0].displayName).toBe("Trimmed Name");
    });
  });

  describe("getAccounts の詳細検証", () => {
    it("家族Docが存在しない孤立familyIdや家族未所属でも安全に取得できること", async () => {
      const t = convexTest(schema, modules);
      let danglingFamilyId!: Id<"families">;
      let validFamilyId!: Id<"families">;

      await t.run(async (ctx) => {
        const dummyFamily = await ctx.db.insert("families", {
          name: "削除予定家族",
          updatedAt: Date.now(),
        });
        danglingFamilyId = dummyFamily;
        await ctx.db.delete(dummyFamily);

        validFamilyId = await ctx.db.insert("families", {
          name: "有効な家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 100000,
          cryptoVersion: 1,
          updatedAt: Date.now(),
        });

        // 孤立 familyId を持つアカウント
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "get_acc_user",
          email: "getacc@example.com",
          familyId: danglingFamilyId,
          updatedAt: Date.now(),
        });
        // 有効な familyId を持つアカウント
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "get_acc_user",
          email: "getacc@example.com",
          familyId: validFamilyId,
          updatedAt: Date.now(),
        });
        // 家族なしアカウント
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "get_acc_user",
          email: "getacc@example.com",
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "get_acc_user",
        email: "getacc@example.com",
        emailVerified: true,
      });

      const accounts = await user.query(api.users.getAccounts, {});
      expect(accounts).toHaveLength(3);

      const danglingAcc = accounts.find((a) => a.familyId === danglingFamilyId);
      expect(danglingAcc?.family).toBeNull();

      const validAcc = accounts.find((a) => a.familyId === validFamilyId);
      expect(validAcc?.family?.name).toBe("有効な家族");
      expect(validAcc?.family?.cryptoVersion).toBe(1);

      const noFamAcc = accounts.find((a) => !a.familyId);
      expect(noFamAcc?.family).toBeNull();
    });
  });

  describe("deleteAccount / deleteAllAccounts の詳細検証", () => {
    it("deleteAccount: 単独家族所属のアカウント削除時に家族および共有レコードが全削除されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let userAccId!: Id<"users">;
      let familyRecId!: Id<"serviceRecords">;
      let joinReqId!: Id<"joinRequests">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "単独家族",
          updatedAt: Date.now(),
        });
        userAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "solo_family_user",
          email: "solo@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        familyRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "solo_family_user",
          accountId: userAccId,
          familyId,
          title: "家族レコード",
          tags: [],
          updatedAt: Date.now(),
        });
        const otherUserAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "other_req_user",
          email: "other@example.com",
          updatedAt: Date.now(),
        });
        joinReqId = await ctx.db.insert("joinRequests", {
          familyId,
          userId: "other_req_user",
          accountId: otherUserAccId,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "solo_family_user",
        email: "solo@example.com",
        emailVerified: true,
      });

      const res = await user.mutation(api.users.deleteAccount, {});
      expect(res.success).toBe(true);

      await t.run(async (ctx) => {
        expect(await ctx.db.get(userAccId)).toBeNull();
        expect(await ctx.db.get(familyId)).toBeNull();
        expect(await ctx.db.get(familyRecId)).toBeNull();
        expect(await ctx.db.get(joinReqId)).toBeNull();
      });
    });

    it("deleteAccount: 他メンバーが同居する家族所属アカウントの削除時に個人レコードのみ削除され共有レコードが保護されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let leavingAccId!: Id<"users">;
      let remainingAccId!: Id<"users">;
      let personalRecId!: Id<"serviceRecords">;
      let sharedRecId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "同居家族",
          updatedAt: Date.now(),
        });
        leavingAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "leaving_member_uid",
          email: "leaving@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        remainingAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "remaining_member_uid",
          email: "remaining@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        personalRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "leaving_member_uid",
          accountId: leavingAccId,
          familyId,
          ownerType: "user",
          title: "脱退者の個人レコード",
          tags: [],
          updatedAt: Date.now(),
        });
        sharedRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "leaving_member_uid",
          accountId: leavingAccId,
          familyId,
          ownerType: "family",
          title: "脱退者が作った共有レコード",
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const leavingUser = t.withIdentity({
        subject: "leaving_member_uid",
        email: "leaving@example.com",
        emailVerified: true,
      });

      const res = await leavingUser.mutation(api.users.deleteAccount, {});
      expect(res.success).toBe(true);

      await t.run(async (ctx) => {
        expect(await ctx.db.get(leavingAccId)).toBeNull();
        expect(await ctx.db.get(personalRecId)).toBeNull();
        expect(await ctx.db.get(sharedRecId)).not.toBeNull();
        expect(await ctx.db.get(remainingAccId)).not.toBeNull();
        expect(await ctx.db.get(familyId)).not.toBeNull();
      });
    });

    it("deleteAccount: 家族未所属のアカウント削除時に作成した個人レコードのみ削除されること", async () => {
      const t = convexTest(schema, modules);
      let userAccId!: Id<"users">;
      let personalRecId!: Id<"serviceRecords">;
      let famRecId!: Id<"serviceRecords">;
      let otherFamilyId!: Id<"families">;

      await t.run(async (ctx) => {
        otherFamilyId = await ctx.db.insert("families", {
          name: "別家族",
          updatedAt: Date.now(),
        });
        userAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "no_family_user",
          email: "nofam@example.com",
          updatedAt: Date.now(),
        });
        personalRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "no_family_user",
          accountId: userAccId,
          title: "個人レコード",
          tags: [],
          updatedAt: Date.now(),
        });
        famRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "no_family_user",
          accountId: userAccId,
          familyId: otherFamilyId,
          title: "家族付きレコード",
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "no_family_user",
        email: "nofam@example.com",
        emailVerified: true,
      });

      await user.mutation(api.users.deleteAccount, {});

      await t.run(async (ctx) => {
        expect(await ctx.db.get(userAccId)).toBeNull();
        expect(await ctx.db.get(personalRecId)).toBeNull();
        // 家族ID付きレコードは残る
        expect(await ctx.db.get(famRecId)).not.toBeNull();
      });
    });

    it("deleteAllAccounts: 複数メンバー家族所属アカウントと家族なしアカウントを含む全アカウント削除", async () => {
      const t = convexTest(schema, modules);
      let sharedFamilyId!: Id<"families">;
      let myAcc1!: Id<"users">;
      let otherAcc!: Id<"users">;
      let myAcc2!: Id<"users">;
      let personalRecId!: Id<"serviceRecords">;
      let sharedRecId!: Id<"serviceRecords">;
      let noFamRecId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        sharedFamilyId = await ctx.db.insert("families", {
          name: "共有テスト家族",
          updatedAt: Date.now(),
        });
        myAcc1 = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "delete_all_multi_user",
          email: "delmulti@example.com",
          familyId: sharedFamilyId,
          updatedAt: Date.now(),
        });
        otherAcc = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "other_member_uid",
          email: "other@example.com",
          familyId: sharedFamilyId,
          updatedAt: Date.now(),
        });
        myAcc2 = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "delete_all_multi_user",
          email: "delmulti@example.com",
          updatedAt: Date.now(),
        });

        personalRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "delete_all_multi_user",
          accountId: myAcc1,
          familyId: sharedFamilyId,
          ownerType: "user",
          title: "個人レコード",
          tags: [],
          updatedAt: Date.now(),
        });
        sharedRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "delete_all_multi_user",
          accountId: myAcc1,
          familyId: sharedFamilyId,
          ownerType: "family",
          title: "共有レコード",
          tags: [],
          updatedAt: Date.now(),
        });
        noFamRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "delete_all_multi_user",
          accountId: myAcc2,
          title: "家族なしレコード",
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "delete_all_multi_user",
        email: "delmulti@example.com",
        emailVerified: true,
      });

      const res = await user.mutation(api.users.deleteAllAccounts, {});
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(2);

      await t.run(async (ctx) => {
        expect(await ctx.db.get(myAcc1)).toBeNull();
        expect(await ctx.db.get(myAcc2)).toBeNull();
        expect(await ctx.db.get(personalRecId)).toBeNull();
        expect(await ctx.db.get(noFamRecId)).toBeNull();
        // 共有レコードと他メンバーは保護される
        expect(await ctx.db.get(sharedRecId)).not.toBeNull();
        expect(await ctx.db.get(otherAcc)).not.toBeNull();
        expect(await ctx.db.get(sharedFamilyId)).not.toBeNull();
      });
    });
  });

  describe("internalQuery: getUserByFirebaseUid & getUserById", () => {
    it("getUserByFirebaseUid: accountId指定、不一致フォールバック、家族情報取得を正しく処理すること", async () => {
      const t = convexTest(schema, modules);
      let famId!: Id<"families">;
      let acc1Id!: Id<"users">;
      let otherAccId!: Id<"users">;

      await t.run(async (ctx) => {
        famId = await ctx.db.insert("families", {
          name: "内部クエリ家族",
          masterKeyEncrypted: "enc",
          masterKeyIv: "iv",
          masterKeySalt: "salt",
          kdfIterations: 50000,
          cryptoVersion: 1,
          updatedAt: Date.now(),
        });
        acc1Id = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "internal_user_uid",
          email: "internal@example.com",
          displayName: "内部1",
          familyId: famId,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "internal_user_uid",
          email: "internal@example.com",
          displayName: "内部2",
          updatedAt: Date.now(),
        });
        otherAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "other_uid",
          email: "other@example.com",
          updatedAt: Date.now(),
        });
      });

      // 1. accountId指定（一致）
      const res1 = await t.query(internal.users.getUserByFirebaseUid, {
        userId: "internal_user_uid",
        accountId: acc1Id,
      });
      expect(res1?.accountId).toBe(acc1Id);
      expect(res1?.family?.name).toBe("内部クエリ家族");
      expect(res1?.accounts).toHaveLength(2);

      // 2. accountId指定（別ユーザーのaccountId → フォールバックで最初のアカウントを取得）
      const res2 = await t.query(internal.users.getUserByFirebaseUid, {
        userId: "internal_user_uid",
        accountId: otherAccId,
      });
      expect(res2?.userId).toBe("internal_user_uid");

      // 3. accountId未指定
      const res3 = await t.query(internal.users.getUserByFirebaseUid, {
        userId: "internal_user_uid",
      });
      expect(res3?.userId).toBe("internal_user_uid");

      // 4. 存在しないuserId
      const res4 = await t.query(internal.users.getUserByFirebaseUid, {
        userId: "non_existent_uid",
      });
      expect(res4).toBeNull();
    });

    it("getUserById: 存在するID、存在しないID、家族情報の有無を正しく処理すること", async () => {
      const t = convexTest(schema, modules);
      let famId!: Id<"families">;
      let userWithFamId!: Id<"users">;
      let userWithoutFamId!: Id<"users">;

      await t.run(async (ctx) => {
        famId = await ctx.db.insert("families", {
          name: "ID取得家族",
          updatedAt: Date.now(),
        });
        userWithFamId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "uid_fam",
          email: "fam@example.com",
          familyId: famId,
          updatedAt: Date.now(),
        });
        userWithoutFamId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "uid_nofam",
          email: "nofam@example.com",
          updatedAt: Date.now(),
        });
      });

      const resFam = await t.query(internal.users.getUserById, {
        id: userWithFamId,
      });
      expect(resFam?.family?.name).toBe("ID取得家族");

      const resNoFam = await t.query(internal.users.getUserById, {
        id: userWithoutFamId,
      });
      expect(resNoFam?.family).toBeNull();

      // 存在しないID
      let nonExistentId!: Id<"users">;
      await t.run(async (ctx) => {
        const temp = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "temp",
          email: "t@example.com",
          updatedAt: Date.now(),
        });
        await ctx.db.delete(temp);
        nonExistentId = temp;
      });
      const resNull = await t.query(internal.users.getUserById, {
        id: nonExistentId,
      });
      expect(resNull).toBeNull();
    });
  });

  describe("recordLogin & cleanupOldLoginEventsInternal", () => {
    it("recordLogin: アカウントが存在しない場合は失敗を返すこと", async () => {
      const t = convexTest(schema, modules);
      const ghost = t.withIdentity({
        subject: "ghost_user",
        email: "ghost@example.com",
        emailVerified: true,
      });

      const res = await ghost.mutation(api.users.recordLogin, {
        deviceId: "dev_ghost",
      });
      expect(res).toEqual({ success: false, reason: "Account not found" });
    });

    it("recordLogin: 初回端末ログイン時は isNewDevice: true と判定され、2回目以降は false と判定されること", async () => {
      const t = convexTest(schema, modules);
      let accountId!: Id<"users">;
      await t.run(async (ctx) => {
        accountId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_device_test",
          email: "device@example.com",
          updatedAt: Date.now(),
        });
      });

      const userClient = t.withIdentity({
        subject: "user_device_test",
        email: "device@example.com",
        emailVerified: true,
      });

      // 1回目のログイン (新端末 / displayName未設定)
      const res1 = await userClient.mutation(api.users.recordLogin, {
        deviceId: "device_abc_123",
        accountId,
        deviceName: "Pixel 8",
        browser: "Chrome",
        ipAddress: "203.0.113.1",
      });
      expect(res1.success).toBe(true);
      expect(res1.isNewDevice).toBe(true);

      // 2回目のログイン (同一端末)
      const res2 = await userClient.mutation(api.users.recordLogin, {
        deviceId: "device_abc_123",
        accountId,
      });
      expect(res2.success).toBe(true);
      expect(res2.isNewDevice).toBe(false);
    });

    it("recordLogin: accountId指定時の不一致フォールバック", async () => {
      const t = convexTest(schema, modules);
      let myAccId!: Id<"users">;
      let otherAccId!: Id<"users">;

      await t.run(async (ctx) => {
        myAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "login_fb_user",
          email: "loginfb@example.com",
          updatedAt: Date.now(),
        });
        otherAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "other_login_user",
          email: "other@example.com",
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "login_fb_user",
        email: "loginfb@example.com",
        emailVerified: true,
      });

      // 他人の accountId を渡した場合は自身の最初のアカウントにフォールバックして記録される
      const res = await user.mutation(api.users.recordLogin, {
        deviceId: "dev_fallback",
        accountId: otherAccId,
      });
      expect(res.success).toBe(true);
      expect(res.isNewDevice).toBe(true);

      await t.run(async (ctx) => {
        const event = await ctx.db
          .query("loginEvents")
          .withIndex("by_accountId_deviceId", (q) =>
            q.eq("accountId", myAccId).eq("deviceId", "dev_fallback"),
          )
          .first();
        expect(event).not.toBeNull();
      });
    });

    it("cleanupOldLoginEventsInternal: 90日以上前のログインログを削除し、BATCH_SIZE未満時は再スケジュールしないこと", async () => {
      const t = convexTest(schema, modules);
      const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

      let testAccId!: Id<"users">;
      await t.run(async (ctx) => {
        testAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "cleanup_user_small",
          email: "clean_small@example.com",
          updatedAt: Date.now(),
        });

        // 5件の古いログを作成
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert("loginEvents", {
            accountId: testAccId,
            userId: "cleanup_user_small",
            deviceId: `small_dev_${i}`,
            isNewDevice: true,
            loginAt: ninetyOneDaysAgo - i * 1000,
          });
        }

        // 1件の新しいログを作成
        await ctx.db.insert("loginEvents", {
          accountId: testAccId,
          userId: "cleanup_user_small",
          deviceId: "recent_dev",
          isNewDevice: true,
          loginAt: tenDaysAgo,
        });
      });

      const res = await t.mutation(
        internal.users.cleanupOldLoginEventsInternal,
        {},
      );
      expect(res.deletedCount).toBe(5);

      await t.run(async (ctx) => {
        const remaining = await ctx.db.query("loginEvents").collect();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].deviceId).toBe("recent_dev");
      });
    });

    it("cleanupOldLoginEventsInternal: 削除件数がBATCH_SIZE (100) 到達時に再スケジュールすること", async () => {
      const t = convexTest(schema, modules);
      const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;

      let testAccId!: Id<"users">;
      await t.run(async (ctx) => {
        testAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "cleanup_user_100",
          email: "clean100@example.com",
          updatedAt: Date.now(),
        });

        for (let i = 0; i < 100; i++) {
          await ctx.db.insert("loginEvents", {
            accountId: testAccId,
            userId: "cleanup_user_100",
            deviceId: `dev_100_${i}`,
            isNewDevice: true,
            loginAt: ninetyOneDaysAgo - i * 1000,
          });
        }
      });

      const res = await t.mutation(
        internal.users.cleanupOldLoginEventsInternal,
        {},
      );
      expect(res.deletedCount).toBe(100);
    });
  });

  describe("notifyBiometricEvent の検証", () => {
    it("生体認証の登録・解除通知 mutation が正常に完了すること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "user_bio_test",
          email: "bio@example.com",
          displayName: "生体太郎",
          updatedAt: Date.now(),
        });
      });

      const userClient = t.withIdentity({
        subject: "user_bio_test",
        email: "bio@example.com",
        emailVerified: true,
      });

      const resReg = await userClient.mutation(api.users.notifyBiometricEvent, {
        event: "registered",
        deviceName: "iPhone 15",
      });
      expect(resReg.success).toBe(true);

      const resRem = await userClient.mutation(api.users.notifyBiometricEvent, {
        event: "removed",
        deviceName: "iPhone 15",
      });
      expect(resRem.success).toBe(true);
    });
  });

  describe("customBuilders の境界値・認可検証", () => {
    it("resolveAccount: 未認証時に Unauthenticated エラーをスローすること", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await expect(
          resolveAccount({ db: ctx.db, auth: ctx.auth }),
        ).rejects.toThrow("Unauthenticated");
      });
    });

    it("resolveAccount: 認証済みだがDBにユーザーが存在しない場合に User not found in DB エラーをスローすること", async () => {
      const t = convexTest(schema, modules);
      const unRegisteredUser = t.withIdentity({
        subject: "unregistered_in_db",
        email: "unregistered@example.com",
        emailVerified: true,
      });

      // authenticatedMutation の updateProfile を呼ぶと DB 存在チェックで弾かれる
      await expect(
        unRegisteredUser.mutation(api.users.updateProfile, {
          displayName: "Test",
        }),
      ).rejects.toThrow("User not found in DB");
    });

    it("familyBoundQuery / familyBoundMutation: 家族に未所属のユーザーが実行した場合に拒否されること", async () => {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "no_fam_bound_user",
        email: "nofambound@example.com",
        emailVerified: true,
      });
      await user.mutation(api.users.syncUser, { displayName: "NoFam" });

      // 家族所属必須の query (api.families.getPendingRequests)
      await expect(
        user.query(api.families.getPendingRequests, {}),
      ).rejects.toThrow("User does not belong to a family");

      // 家族所属必須の mutation (api.records.createRecord)
      await expect(
        user.mutation(api.records.createRecord, {
          title: "Test Record",
          ownerType: "user",
          credentials: [],
          tags: [],
        }),
      ).rejects.toThrow("User does not belong to a family");
    });

    it("familyAdminMutation: 家族に未所属のユーザーが実行した場合に拒否されること", async () => {
      const t = convexTest(schema, modules);
      let dummyAccId!: Id<"users">;
      await t.run(async (ctx) => {
        dummyAccId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "dummy_target",
          email: "dummy@example.com",
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "no_fam_admin_user",
        email: "nofamadmin@example.com",
        emailVerified: true,
      });
      await user.mutation(api.users.syncUser, { displayName: "NoFamAdmin" });

      await expect(
        user.mutation(api.families.updateMemberRole, {
          targetAccountId: dummyAccId,
          role: "admin",
        }),
      ).rejects.toThrow("User does not belong to a family");
    });

    it("recordAdminMutation: 存在しないレコードまたは管理権限のないユーザーが実行した場合に拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let viewerId!: Id<"users">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Test Family",
          updatedAt: Date.now(),
        });
        viewerId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
      });

      const user = t.withIdentity({
        subject: "viewer_user",
        email: "viewer@example.com",
      });

      // 存在しないレコード
      await expect(
        user.mutation(api.records.addRecordAdmin, {
          id: "000000000000000000000000000serviceRecords" as unknown as Id<"serviceRecords">,
          targetAccountId: viewerId,
        }),
      ).rejects.toThrow("Record not found");
    });

    it("recordAdminMutation: 実在する共有レコードに対して個別管理権限のない閲覧者が実行した場合に Access denied で拒否されること", async () => {
      const t = convexTest(schema, modules);
      let familyId!: Id<"families">;
      let adminId!: Id<"users">;
      let viewerId!: Id<"users">;
      let sharedRecId!: Id<"serviceRecords">;

      await t.run(async (ctx) => {
        familyId = await ctx.db.insert("families", {
          name: "Auth Test Family",
          updatedAt: Date.now(),
        });
        adminId = await ctx.db.insert("users", {
          familyRole: "admin",
          userId: "admin_user",
          email: "admin@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        viewerId = await ctx.db.insert("users", {
          familyRole: "viewer",
          userId: "viewer_user",
          email: "viewer@example.com",
          familyId,
          updatedAt: Date.now(),
        });
        sharedRecId = await ctx.db.insert("serviceRecords", {
          stableId: crypto.randomUUID(),
          userId: "admin_user",
          accountId: adminId,
          familyId,
          ownerFamilyId: familyId,
          title: "Existing Shared Record",
          sortKey: "existing",
          ownerType: "family",
          admins: [],
          tags: [],
          updatedAt: Date.now(),
        });
      });

      const viewer = t.withIdentity({
        subject: "viewer_user",
        email: "viewer@example.com",
      });

      // 個別管理者ではない閲覧者が管理者操作を実行した場合は Access denied で拒否されること
      await expect(
        viewer.mutation(api.records.addRecordAdmin, {
          id: sharedRecId,
          targetAccountId: viewerId,
        }),
      ).rejects.toThrow("Access denied");
    });
  });
});
