# PoohMa Testing Strategy & Guide

PoohMa におけるテストアーキテクチャ、テスト作成パターン、検証方法を整理する。

---

## 1. テスト構成とツールスタック

| 対象 | ツール | 役割 |
| --- | --- | --- |
| バックエンド関数 (Convex) | `convex-test` + `vitest` | Schema, customBuilders, RLS, DB トランザクション、スケジューラのインメモリ結合テスト |
| 暗号化 / E2EE / ユーティリティ | `vitest` + Web Crypto API (Node 20+ 組み込み) | PBKDF2 鍵導出、DEK/MasterKey ラップ、ソートキー生成、バリデーション |
| フロントエンド UI / Hooks | `@testing-library/react` + `vitest` | `PasscodeProvider`, `AccountProvider`, フォームバリデーション等のコンポーネントテスト |
| 暗号・WebAuthn PRF サブシステム (Browser E2E) | `@vitest/browser-playwright` + Chromium (CDP) | 実ブラウザ Web Crypto API、CDP Virtual Authenticator (PRF拡張)、PasscodeProvider 実UI結合、再暗号化フロー |
| ユーザー導線フルスタック E2E (Staging) | `@playwright/test` + Firebase Admin SDK カスタムトークン | ステージング実環境に対するログインブートストラップ、初期設定・レコード暗号化保存〜復号の貫通検証 |

---

## 2. Convex バックエンド関数のテストパターン (`convex-test`)

Convex の Mutation / Query / RLS テストは `convex-test` を用いてインメモリで完結して実行する。

### 基本セットアップ

```typescript
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@/../convex/_generated/api";
import schema from "@/../convex/schema";

// Convex モジュールを glob でロード
const modules = import.meta.glob("@/../convex/**/*.ts");

it("正常系: 家族作成とユーザーの familyId 紐付け", async () => {
  const t = convexTest(schema, modules);

  // 1. テストデータのシード (t.run を使用)
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_123",
      email: "user@example.com",
      updatedAt: Date.now(),
    });
  });

  // 2. 認証コンテキストの生成 (withIdentity)
  const asUser = t.withIdentity({
    subject: "user_123",
    email: "user@example.com",
  });

  // 3. customBuilders / Mutation の実行
  const familyId = await asUser.mutation(api.families.createFamily, {
    name: "テスト家族",
    masterKeyEncrypted: "...",
    masterKeyIv: "...",
    masterKeySalt: "...",
  });

  expect(familyId).toBeDefined();

  // 4. DB 結果の検証
  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_123"))
      .unique();
  });
  expect(user?.familyId).toBe(familyId);
});
```

### 認可エラー・RLS 拒否のテスト

```typescript
it("異常系: 対象家族に未所属のユーザーによる共有レコード操作は拒否される", async () => {
  const t = convexTest(schema, modules);
  const targetRecordId = await t.run(async (ctx) => {
    const targetFamilyId = await ctx.db.insert("families", {
      name: "Target Family",
      updatedAt: Date.now(),
    });
    const attackerFamilyId = await ctx.db.insert("families", {
      name: "Attacker Family",
      updatedAt: Date.now(),
    });
    const ownerAccountId = await ctx.db.insert("users", {
      userId: "owner_uid",
      email: "owner@example.com",
      familyId: targetFamilyId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("users", {
      userId: "attacker_uid",
      email: "attacker@example.com",
      familyId: attackerFamilyId,
      updatedAt: Date.now(),
    });

    return await ctx.db.insert("serviceRecords", {
      title: "Target Record",
      userId: "owner_uid",
      accountId: ownerAccountId,
      familyId: targetFamilyId,
      ownerType: "family",
      ownerFamilyId: targetFamilyId,
      admins: [ownerAccountId],
      credentials: [],
      tags: [],
      updatedAt: Date.now(),
    });
  });
  const attacker = t.withIdentity({ subject: "attacker_uid" });

  await expect(
    attacker.mutation(api.records.deleteRecord, {
      id: targetRecordId,
    }),
  ).rejects.toThrow("Access denied");
});
```

---

## 3. 暗号化 (E2EE) のテストパターン

Node.js 環境の `globalThis.crypto.subtle` を用いて、ブラウザと同一の Web Crypto API ロジックを検証する。

- `crypto.spec.ts`: PBKDF2 反復回数、MasterKey/DEK のラップ＆アンラップ、不正なソルトや破損データ時のエラーハンドリングを網羅。
- `recovery-kit.spec.ts`: Crockford's Base32 リカバリーコードの正規化、類似文字（O/0, I/1）置換、ハッシュ照合のテスト。

---

## 4. UI / Provider のテストパターン

`PasscodeProvider` や `AccountProvider` のように複雑なライフサイクル・揮発性メモリを持つコンポーネントは `@testing-library/react` の `renderHook` や `act` を用いてテストする。

- パスコード誤入力時の指数バックオフ（3回失敗後のロックアウトタイマー）
- アカウント切り替え時の MasterKey リセット検証
- WebAuthn 非対応環境における graceful fallback 動作

---

## 5. テスト実行ルール
 
- **単体・統合・Browser E2E テスト一括実行**: `pnpm test`（Nodeユニット、Storybook、`browser-e2ee` プロジェクトが全件実行される）
- **Browser E2E 単体実行**: `pnpm --filter @poohma/web test:browser`（Chromium 上で Web Crypto / WebAuthn PRF / PasscodeProvider / 再暗号化を高速実行）
- **Full-Stack E2E 実行 (Playwright on Staging)**: `pnpm --filter @poohma/web test:e2e`（`build:e2e-bridge` 後に Playwright 実行）
- **一括品質パイプライン**: `pnpm verify`（Typecheck → Lint/Format → Test → Build）
- **ファイル配置規則**:
  - 単体・サーバー統合テスト: `apps/web/tests/*.spec.ts` または `*.test.tsx`
  - Browser E2E サブシステムテスト: `apps/web/tests/browser-e2e/*.browser.test.{ts,tsx}`
  - Full-Stack E2E テスト: `apps/web/e2e/*.spec.ts`
  - E2E 共通フィクスチャ・補助スクリプト: `apps/web/e2e/support/`

---

## 6. フルスタック E2E テストパターン (`@playwright/test`)

### Origin-scoped 保護バイパスフィクスチャ
ステージング環境（Vercel Deployment Protection、および将来的なデプロイ基盤移行に備えた事前対応としての Cloudflare Access）での自動テスト実行時、`playwright.config.ts` の `use.extraHTTPHeaders` にグローバルにバイパスヘッダーを設定してはならない（Google Identity Toolkit などの外部 API への fetch にも付与され、CORS プリフライト拒否で認証失敗となる）。

必ず `apps/web/e2e/support/test-fixtures.ts` を経由し、対象オリジン（`baseURL`）宛ての通信のみにヘッダーを注入する:

```typescript
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const cfId = process.env.CF_ACCESS_CLIENT_ID;
    const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;

    if (!bypassSecret && (!cfId || !cfSecret)) {
      await use(context);
      return;
    }

    const targetOrigin = baseURL ? new URL(baseURL).origin : "";

    await context.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = request.url();

      if (targetOrigin && new URL(requestUrl).origin === targetOrigin) {
        const headers = {
          ...request.headers(),
          ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
          ...(cfId && cfSecret
            ? {
                "CF-Access-Client-Id": cfId,
                "CF-Access-Client-Secret": cfSecret,
              }
            : {}),
        };
        await route.continue({ headers });
      } else {
        await route.continue();
      }
    });

    await use(context);
  },
});
```

### テストスイート構成
- `public-routes.spec.ts`: LP、利用規約、プライバシーポリシー、未認証ガード（`/dashboard` / `/family` から `/login` へのリダイレクト）
- `auth.setup.ts`: Firebase Admin SDK カスタムトークン発行と Bridge IIFE によるブラウザ `signInWithCustomToken`、認証ストレージ保存
- `dashboard.spec.ts`: ログイン済みアクセス、認証済み状態での `/login` からの自動リダイレクト
- `family.spec.ts`: 家族作成オンボーディング・管理画面の表示確認
- `settings.spec.ts`: 家族未所属時の保護リダイレクト検証
- `logout.spec.ts`: ログアウト処理実行後のセッション破棄・未認証状態遷移の検証
- `e2ee-seed-import.spec.ts`: 家族作成（Master Key生成・KEK導出）、CSVインポートによる平文ヒントのクライアント暗号化Seed投入、詳細画面でのヒント復号検証、およびUI一括削除機能による他家族データを壊さない安全なクリーンアップ検証

#### `tests/convex-audit-logs.spec.ts`（バックエンド統合テスト）

`convex-test` を用いた監査ログ機能の結合テストスイート。以下の観点を検証する：

- **Zero-Knowledge保証**: `auditLogs.metadata` に平文ヒントや暗号資材（passwordHint, passwordHintIv, DEK等）が記録されないこと
- **監査ログ生成**: createRecord / updateRecord / logRecordHintView 実行時にログが生成されること
- **アクセス制御（IDOR防止）**: 他家族のメンバーが `getFamilyAuditLogs` / `getRecordAuditLogs` で他家族のログを取得できないこと
- **TTLクリーンアップ**: `cleanupOldAuditLogsInternal` が180日超過ログのみを削除し、直近ログを保持すること

### E2E テスト実行前のバックエンド反映ルール (`convex dev --once`)
Playwright E2E テストはローカルのモックではなく、実際の Convex 開発インスタンス（`CONVEX_DEPLOYMENT=dev:...`）と通信する。
そのため、**スキーマや Convex 関数を追加・変更した後は、必ず E2E テスト実行前に `pnpm -F @poohma/web exec convex dev --once` を実行して開発インスタンスへ最新コードを反映・型同期しておくこと**。
これを行わずに `pnpm test:e2e` を実行すると、Convex クラウド環境に関数が存在せず `Could not find public function for '...'` が発生してテストが失敗する。

---

## 7. テスト実装時のプロダクションコード変更原則

テスト実装・E2E作成中にテストが失敗した場合や不具合が発生した際は、以下の原則を厳守すること:

1. **安易なプロダクションコードの改変禁止**:
   - 失敗が発生した際、プロダクションコードを即座に修正してはならない。まずテストコード側の待機処理、アサーション方法、フィクスチャの改善・調整で解決できないかを最優先で試みる。
2. **プロダクションコード修正時の事前許可**:
   - 明らかにプロダクションコードのバグである場合や、どうしてもプロダクション側の修正が不可欠な場合であっても、**AI Agentが独断でコードを変更・コミットしてはならない**。
   - 必ず「発生している事象」「原因」「提案するプロダクションコードの修正内容とその影響」をユーザーに説明し、**明示的な許可・承認を得てから修正を実行する**。

---

## 8. テストデータのクリーンアップ設計（退会・家族削除による完全初期化思想）

- **思想**:
  - `vitest` の `beforeEach` でデータ作成、`afterEach` でレコード削除・退会（最後の1ユーザーなら家族グループも自動カスケード削除）を行い、各テストを完全に独立・冪等に保つのが本来の理想設計である。
- **E2E テストにおける現状と方針**:
  - 現状のステージング E2E では、CSV インポートに伴う暗号化処理や外部 OGP 取得のオーバーヘッドが大きいため、家族作成〜CSV 暗号化インポート〜復号〜一括削除を一連の複合シナリオ（`e2ee-seed-import.spec.ts`）として集約している。
  - テスト間の副作用（例: 家族作成により後続の未所属前提テストやログアウトテストの画面構造が変化する問題）を防ぐため、テストスイートの最終ステップではレコード削除だけでなく「退会処理（`deleteAccount`）」まで完了させ、テストユーザーを完全に家族未所属の初期状態へ戻すクリーンアップを徹底する。

---

## 9. コミット前の動的テスト（E2E / `pnpm test:e2e`）によるローカル検証義務

AI Agent がコード変更を行う際、静的検証（`pnpm check` や `pnpm typecheck`）および Vitest ユニットテスト（`pnpm test`）のみで作業を完了とし、コミット・プッシュしてはならない。

- **義務の対象**:
  - UI 挙動の変更、新規機能・導線の追加
  - 認証・認可・セッション制御
  - E2EE 暗号化・鍵導出・ストレージ処理
  - Convex バックエンド関数（Mutation / Query）の追加・変更
  - データインポート・エクスポート・マイグレーション処理
- **必須検証手順**:
  1. バックエンド変更がある場合: `pnpm convex:dev:once`（または `pnpm -F @poohma/web exec convex dev --once`）で最新コードを開発環境へ反映。
  2. ローカル動的テストの実行: `pnpm test:e2e` を実行し、全テストケースが合格することを確認。
  3. テストが失敗した場合は、プロダクションコードを独断で改変せず、原因を精査して合意を得て修正すること（第7節参照）。
  4. 全テスト合格を確認した後に限り、コミット・プッシュを行う。
