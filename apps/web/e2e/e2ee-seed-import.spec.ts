import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { ensureOnboardingCompleted } from "./support/ensure-onboarding";
import { expect, test } from "./support/test-fixtures";

const dirname =
  import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const SEED_CSV_PATH = path.join(
  dirname,
  "fixtures/seed_value_user1_20260904.csv",
);

// =============================================================================
// Helper Functions (責務ごとに分離されたE2EE・データ操作ヘルパー)
// =============================================================================

/**
 * 画面上のレコード一覧からレコードID配列を抽出
 */
async function getRecordIds(page: Page): Promise<string[]> {
  return page
    .locator('a[href^="/records/"]')
    .evaluateAll((links) => [
      ...new Set(
        links
          .map((link) => link.getAttribute("href")?.split("/").pop())
          .filter((id): id is string => Boolean(id)),
      ),
    ]);
}

/**
 * 実行専用のサブアカウントを作成し、アクティブアカウントとして設定
 */
async function createTestAccount(
  page: Page,
  accountName: string,
): Promise<void> {
  await page.goto("/family");
  await expect(page).toHaveURL(/.*\/family/, { timeout: 20000 });

  // オンボーディングモーダルが表示された場合はスキップして消えるまで待機
  await ensureOnboardingCompleted(page);

  // ① ユーザーメニュー（ヘッダーアバター）またはアカウントスイッチャーをクリック
  const userMenuTrigger = page
    .locator('[data-testid="user-menu-trigger"]')
    .filter({ visible: true })
    .first();
  const unassignedSwitcher = page
    .locator('button:has-text("家族未所属")')
    .first();

  // どちらかのトリガーが表示されるのを待機
  await expect(userMenuTrigger.or(unassignedSwitcher).first()).toBeVisible({
    timeout: 20000,
  });

  if (await userMenuTrigger.isVisible()) {
    await userMenuTrigger.click();

    // ② Googleアカウント情報欄をクリック
    const accountSubTrigger = page
      .locator('[data-slot="dropdown-menu-sub-trigger"]')
      .or(page.locator('button:has-text("切替")'))
      .first();
    await expect(accountSubTrigger).toBeVisible({ timeout: 5000 });
    await accountSubTrigger.click();
  } else {
    // 家族未所属時は画面上の AccountSwitcher を直接クリック
    await expect(unassignedSwitcher).toBeVisible({ timeout: 15000 });
    await unassignedSwitcher.click();
  }

  // ③ サブメニュー内の「新しいアカウントを作成」をクリック
  const createBtn = page
    .locator(
      '[role="menuitem"]:has-text("新しいアカウントを作成"), button:has-text("新しいアカウントを作成")',
    )
    .filter({ visible: true })
    .first();
  await expect(createBtn).toBeVisible({ timeout: 5000 });
  await createBtn.click();

  // ④ アカウント作成ダイアログへの入力と送信
  const nameInput = page.locator("input#create-account-name-input").first();
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill(accountName);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10000 });

  // 作成したアカウントがアクティブとして反映されるのを待機
  const accountActiveIndicator = page.getByText(accountName).first();
  try {
    await expect(accountActiveIndicator).toBeVisible({ timeout: 5000 });
  } catch {
    const switcher = page
      .locator('[data-testid="user-menu-trigger"]')
      .or(page.locator('button:has-text("家族未所属")'))
      .first();
    await switcher.click();
    await page.getByText(accountName, { exact: true }).first().click();
    await expect(accountActiveIndicator).toBeVisible({ timeout: 10000 });
  }
}

/**
 * 家族グループを作成し、Master Key / KEK を生成してグループ管理画面が表示されることを確認
 */
async function createTestFamily(
  page: Page,
  familyName: string,
  passcode: string,
): Promise<void> {
  const familyCreateInput = page.locator("input#family-name-input");
  const familyManagerSection = page.locator(
    '[data-testid="family-manager-section"]',
  );
  await expect(familyCreateInput).toBeVisible({ timeout: 25000 });
  await familyCreateInput.fill(familyName);
  await page.locator("input#family-passcode-input").fill(passcode);
  await page.locator("input#family-passcode-confirm-input").fill(passcode);

  const submitCreateBtn = page
    .locator('button[type="submit"]')
    .filter({ hasText: "作成する" });
  await submitCreateBtn.click();

  // 家族作成後、家族管理セクションが表示されるまで待機して完了を確認
  await expect(familyManagerSection).toBeVisible({ timeout: 25000 });
}

/**
 * CSVファイルをアップロードし、クライアント側E2EE暗号化とConvexへの一括保存を実行
 */
async function importCsvSeed(
  page: Page,
  familyName: string,
  csvPath: string,
  passcode: string,
): Promise<string[]> {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 20000 });

  // オンボーディングモーダルが表示された場合はスキップして消えるまで待機
  await page.waitForTimeout(300);
  await ensureOnboardingCompleted(page);

  // ① ユーザーメニューを開いて家族名を確認
  const userMenuTrigger = page
    .locator('[data-testid="user-menu-trigger"]')
    .filter({ visible: true })
    .first();
  await expect(userMenuTrigger).toBeVisible({ timeout: 25000 });
  await userMenuTrigger.click();

  // 家族グループ名が表示されることを確認
  await expect(page.getByText(familyName, { exact: true }).first()).toBeVisible(
    {
      timeout: 20000,
    },
  );

  // 確認が終わったらメニューを閉じる
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300); // メニューのアニメーション完了を待つ

  // ② オンボーディングモーダルが表示された場合はスキップして消えるまで待機
  await ensureOnboardingCompleted(page);

  const recordIdsBeforeImport = new Set(await getRecordIds(page));

  // ③ /settings/bulk 画面へ移動して一括インポートを実行
  await page.goto("/settings/bulk");
  await expect(page).toHaveURL(/.*\/settings\/bulk/, { timeout: 20000 });

  const fileInput = page.locator('[data-testid="csv-bulk-file-input"]');
  await fileInput.waitFor({ state: "attached", timeout: 30000 });
  await fileInput.setInputFiles(csvPath);

  // アンロックプロンプトが表示された場合はパスコードを入力して解除
  const unlockInput = page.locator('input[placeholder="パスコード"]');
  try {
    await unlockInput.waitFor({ state: "visible", timeout: 15000 });
    await unlockInput.fill(passcode);
    const unlockBtn = page.locator('button:has-text("ロック解除")');
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }
  } catch {
    // プロンプトが表示されなかった（既にアンロック状態）場合はスキップ
  }

  // 差分プレビューコンテナの表示待機
  const previewContainer = page.locator(
    '[data-testid="csv-import-preview-container"]',
  );
  await expect(previewContainer).toBeVisible({ timeout: 30000 });

  // 「反映する」ボタンをクリック
  const applyBtn = page.locator('[data-testid="apply-import-diff-button"]');
  await expect(applyBtn).toBeEnabled({ timeout: 15000 });
  await applyBtn.click();

  // クライアント側暗号化と保存完了を待機（トーストまたは完了画面）
  const successIndicator = page
    .locator(
      "text=/(インポートが完了しました|インポート完了|データを反映しました)/",
    )
    .first();
  await expect(successIndicator).toBeVisible({ timeout: 120000 });

  // ダッシュボードへ戻り、レコード一覧の反映を待機
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 20000 });

  // レコード一覧の更新をポーリング待機して、新しく追加されたレコードIDを返す
  let newlyImportedIds: string[] = [];
  await expect
    .poll(
      async () => {
        const currentIds = await getRecordIds(page);
        newlyImportedIds = currentIds.filter(
          (id) => !recordIdsBeforeImport.has(id),
        );
        return newlyImportedIds.length;
      },
      {
        message: "CSVインポート後のレコード反映待機",
        timeout: 15000,
        intervals: [500, 1000, 2000],
      },
    )
    .toBeGreaterThan(0);

  return newlyImportedIds;
}

/**
 * レコード詳細画面に遷移し、E2EE暗号化された秘密情報（ヒント）が正常に復号されることを検証
 */
async function verifyRecordDecryption(
  page: Page,
  recordTitle: string,
  expectedHint: string,
  passcode: string,
): Promise<void> {
  // オンボーディングモーダルが確実に消去されていることを保証
  await ensureOnboardingCompleted(page);

  // モーダルが消えていることを明示的に待つ
  await page
    .locator("text=PoohMaへようこそ！")
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {});

  // インポートされたレコードカードを探索して詳細へ遷移
  const recordCard = page.locator(`text="${recordTitle}"`).first();
  await expect(recordCard).toBeVisible({ timeout: 25000 });
  await recordCard.click();
  await expect(page).toHaveURL(/.*\/records\/.+/, { timeout: 15000 });

  // ヒント表示ボタン（🔒 クリックして表示）をクリック
  const revealBtn = page
    .locator('button:has-text("🔒 クリックして表示")')
    .first();
  await revealBtn.waitFor({ state: "visible", timeout: 20000 });
  await revealBtn.click();

  // 必要に応じてアンロックモーダルに対応
  const modalUnlockInput = page.locator('input[placeholder="パスコード"]');
  try {
    await modalUnlockInput.waitFor({ state: "visible", timeout: 3000 });
    await modalUnlockInput.fill(passcode);
    const unlockBtn = page.locator('button:has-text("ロック解除")');
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }
  } catch {
    // すでにアンロック済みの場合はスキップ
  }

  // 暗号化されていたパスワードヒントが平文に復号されて表示されていることを検証
  const decryptedHint = page.locator(`text="${expectedHint}"`);
  await expect(decryptedHint).toBeVisible({ timeout: 15000 });
}

/**
 * 一括公開設定変更の確認ステップおよび共有・解除フローを検証
 */
async function verifyBulkVisibilityFlow(
  page: Page,
  recordIds: string[],
): Promise<void> {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 20000 });
  await ensureOnboardingCompleted(page);

  // テスト対象レコード（最初の3件）
  const targetIds = recordIds.slice(0, 3);
  expect(targetIds.length).toBeGreaterThan(0);

  // --- 1. 一括操作モード起動とレコード選択 ---
  const bulkOpButton = page.locator('button:has-text("一括操作")').first();
  await expect(bulkOpButton).toBeVisible({ timeout: 15000 });
  await bulkOpButton.click();

  for (const recordId of targetIds) {
    const recordLink = page.locator(`a[href="/records/${recordId}"]`).first();
    await expect(recordLink).toBeVisible({ timeout: 5000 });
    await recordLink.click();
  }
  await expect(page.getByText(`${targetIds.length} 件選択中`)).toBeVisible();

  // --- 2. 公開設定モーダル起動 ---
  const visibilityTriggerBtn = page
    .locator('button:has-text("公開設定")')
    .first();
  await expect(visibilityTriggerBtn).toBeVisible({ timeout: 5000 });
  await visibilityTriggerBtn.click();

  const modal = page.locator('[data-testid="bulk-visibility-modal"]');
  await expect(modal).toBeVisible({ timeout: 5000 });
  await expect(modal.getByText("選択したレコードの共有設定")).toBeVisible();

  // --- 3. 「家族に共有」を選択して確認画面の表示検証 ---
  const shareOption = modal.locator('[data-testid="select-share-option"]');
  await expect(shareOption).toBeVisible({ timeout: 5000 });
  await shareOption.click();

  // 確認画面の要素（タイトル、変更方向、件数）を確認
  await expect(modal.getByText("家族共有への一括変更確認")).toBeVisible();
  await expect(modal.getByText("自分のみ")).toBeVisible();
  await expect(modal.getByText("家族全員に共有")).toBeVisible();
  await expect(
    modal.getByText(`${targetIds.length} 件`, { exact: true }),
  ).toBeVisible();

  // --- 4. 「戻る」ボタンの検証（キャンセル・復帰動作） ---
  const backBtn = modal.locator('[data-testid="back-to-select-button"]');
  await expect(backBtn).toBeVisible({ timeout: 5000 });
  await backBtn.click();
  await expect(modal.getByText("選択したレコードの共有設定")).toBeVisible();

  // --- 5. 再度「家族に共有」➔ 確定実行 ---
  await modal.locator('[data-testid="select-share-option"]').click();
  const confirmShareBtn = modal.locator('[data-testid="confirm-share-button"]');
  await expect(confirmShareBtn).toBeVisible({ timeout: 5000 });
  await confirmShareBtn.click();

  // 成功トーストの確認
  const shareSuccessToast = page.locator(
    "text=/\\d+\\s*件のレコードを家族と共有しました/",
  );
  await expect(shareSuccessToast).toBeVisible({ timeout: 20000 });
  await shareSuccessToast
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});

  // --- 6. 続けて「共有解除（自分のみ）」の確認フローを検証 ---
  await page.waitForTimeout(500);
  // 選択モードが解除されているため再度起動
  await expect(bulkOpButton).toBeVisible({ timeout: 15000 });
  await bulkOpButton.click();

  for (const recordId of targetIds) {
    const recordLink = page.locator(`a[href="/records/${recordId}"]`).first();
    await expect(recordLink).toBeVisible({ timeout: 5000 });
    await recordLink.click();
  }
  await expect(page.getByText(`${targetIds.length} 件選択中`)).toBeVisible();

  await visibilityTriggerBtn.click();
  await expect(modal).toBeVisible({ timeout: 5000 });

  // 「自分のみ」を選択
  const unshareOption = modal.locator('[data-testid="select-unshare-option"]');
  await expect(unshareOption).toBeVisible({ timeout: 5000 });
  await unshareOption.click();

  // 確認画面（タイトル、変更方向、件数）を確認
  await expect(
    modal.getByText("共有解除（個人用）への一括変更確認"),
  ).toBeVisible();
  await expect(modal.getByText("家族全員に共有")).toBeVisible();
  await expect(modal.getByText("自分のみ（個人用）")).toBeVisible();
  await expect(
    modal.getByText(`${targetIds.length} 件`, { exact: true }),
  ).toBeVisible();

  // 確定ボタンをクリック
  const confirmUnshareBtn = modal.locator(
    '[data-testid="confirm-unshare-button"]',
  );
  await expect(confirmUnshareBtn).toBeVisible({ timeout: 5000 });
  await confirmUnshareBtn.click();

  // 成功トーストの確認
  const unshareSuccessToast = page.locator(
    "text=/\\d+\\s*件のレコードの共有を解除しました/",
  );
  await expect(unshareSuccessToast).toBeVisible({ timeout: 20000 });
  await unshareSuccessToast
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * 一括操作モードを起動し、インポートしたレコードを選択して安全に一括削除
 */
async function bulkDeleteRecords(
  page: Page,
  recordIds: string[],
): Promise<void> {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 20000 });

  // オンボーディングモーダルが表示された場合はスキップ
  await ensureOnboardingCompleted(page);

  // 一括操作モードを起動
  const bulkOpButton = page.locator('button:has-text("一括操作")').first();
  await expect(bulkOpButton).toBeVisible({ timeout: 15000 });
  await bulkOpButton.click();

  // インポートした全レコードを選択
  for (const recordId of recordIds) {
    const recordLink = page.locator(`a[href="/records/${recordId}"]`).first();
    await expect(recordLink).toBeVisible({ timeout: 5000 });
    await recordLink.click();
  }
  await expect(page.getByText(`${recordIds.length} 件選択中`)).toBeVisible();

  // フローティングバーの「削除」ボタンをクリック
  const deleteTriggerBtn = page
    .locator('button:has-text("削除")')
    .filter({ hasText: /^削除$/ })
    .first();
  await expect(deleteTriggerBtn).toBeVisible({ timeout: 5000 });
  await deleteTriggerBtn.click();

  // 削除確認モーダルの「削除する」ボタンをクリック
  const confirmDeleteBtn = page.locator('button:has-text("削除する")').first();
  await expect(confirmDeleteBtn).toBeVisible({ timeout: 5000 });
  await confirmDeleteBtn.click();

  // 削除成功トーストを確認
  const deleteSuccessToast = page.locator(
    "text=/\\d+\\s*件のレコードを削除しました/",
  );
  await expect(deleteSuccessToast).toBeVisible({ timeout: 20000 });

  // 一覧から削除されたことを確認
  for (const recordId of recordIds) {
    await expect(page.locator(`a[href="/records/${recordId}"]`)).toHaveCount(0);
  }
}

/**
 * テスト専用アカウントおよび所属家族を削除してクリーンアップ
 */
async function cleanupTestAccount(
  page: Page,
  accountName: string,
): Promise<void> {
  await page.goto("/settings");
  await page.waitForLoadState("domcontentloaded");

  // 現在表示されているアカウント名を確認
  const currentDisplayNameInput = page.locator("input#display-name-input");
  await expect(currentDisplayNameInput).toBeVisible({ timeout: 10000 });

  const currentName = await currentDisplayNameInput.inputValue();

  // 目的のテスト用アカウントでない場合は切り替えを試みる
  if (currentName !== accountName) {
    const userMenuTrigger = page
      .locator('[data-testid="user-menu-trigger"]')
      .first();
    await expect(userMenuTrigger).toBeVisible({ timeout: 5000 });
    await userMenuTrigger.click();
    const accountSubTrigger = page
      .locator('[data-slot="dropdown-menu-sub-trigger"]')
      .or(page.locator('button:has-text("切替")'))
      .first();
    await expect(accountSubTrigger).toBeVisible({ timeout: 5000 });
    await accountSubTrigger.click();

    const targetItem = page
      .locator('[role="menuitem"], [role="button"]')
      .filter({ hasText: accountName })
      .first();

    // 対象アカウントが存在することを厳格に保証（見つからなければテスト失敗とする）
    await expect(targetItem).toBeVisible({
      timeout: 5000,
    });
    await targetItem.click();

    // 切り替え完了後、設定画面の表示名が対象アカウント名に切り替わったことを確認
    await expect(currentDisplayNameInput).toHaveValue(accountName, {
      timeout: 10000,
    });
  }

  // 削除ボタンの対象アカウント名テキストを検証
  const deleteBtn = page.getByRole("button", {
    name: new RegExp(`このアカウント（${accountName}）のみ削除`),
  });
  await expect(deleteBtn).toBeVisible({ timeout: 5000 });
  await deleteBtn.click();
  const confirmBtn = page
    .getByRole("alertdialog")
    .getByRole("button", { name: "削除する", exact: true });
  await expect(confirmBtn).toBeVisible({ timeout: 5000 });
  await confirmBtn.click();

  await expect(page.getByText("アカウントを削除しました").first()).toBeVisible({
    timeout: 15000,
  });
}

// =============================================================================
// Test Suites (E2EE暗号化ジャーニーの段階的検証)
// =============================================================================

test.describe("E2EE主要フローとCSVインポートSeed検証", () => {
  // 家族作成→CSVインポート→E2EE復号→一括削除を一貫で実行する統合ジャーニーテスト。
  // CI・ローカル問わず35件のOGPフェッチ・暗号化処理等で時間がかかるため
  // テストタイムアウトを180秒に設定。
  test("家族グループ作成、CSV暗号化インポート、詳細でのヒント復号、および安全な一括削除クリーンアップ", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const runId = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
    const accountName = `E2E ${runId}`;
    const familyName = `PoohMa E2E ${runId}`;

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("[Browser Console Error]", msg.text());
      }
    });
    page.on("pageerror", (err) => {
      console.error("[Browser Uncaught Error]", err);
    });

    // 家族パスコード環境変数の検証（デフォルト値なし。未設定なら即座にテストを落とす）
    const passcode = process.env.E2E_FAMILY_PASSCODE;
    if (!passcode) {
      throw new Error(
        "環境変数 E2E_FAMILY_PASSCODE が設定されていません。E2EEテストを実行するにはパスコードの設定が必須です。",
      );
    }

    let accountCreated = false;
    let importedRecordIds: string[] = [];

    try {
      // =====================================================================
      // Step 1: E2EE関連データのセットアップ (アカウント作成・家族作成・KEK生成)
      // =====================================================================
      await test.step("Step 1: 実行専用アカウントと家族グループの作成 (/family)", async () => {
        await createTestAccount(page, accountName);
        accountCreated = true;
        await createTestFamily(page, familyName, passcode);
      });

      // =====================================================================
      // Step 2: CSVインポートとクライアント暗号化 (Web Crypto API による暗号化保存)
      // =====================================================================
      await test.step("Step 2: CSVインポートによる暗号化Seed投入 (/dashboard)", async () => {
        importedRecordIds = await importCsvSeed(
          page,
          familyName,
          SEED_CSV_PATH,
          passcode,
        );
      });

      // =====================================================================
      // Step 3: レコード詳細でのパスコードアンロックとヒント復号検証
      // =====================================================================
      await test.step("Step 3: レコード詳細でのE2EE復号検証 (/records/$id)", async () => {
        await verifyRecordDecryption(
          page,
          "アップルストア",
          "アップルストアのサブ用ヒント (Sub_53!)",
          passcode,
        );
      });

      // =====================================================================
      // Step 3.5: 一括操作モードによる公開設定変更の確認ステップ・共有切替検証
      // =====================================================================
      await test.step("Step 3.5: 一括操作モードによる公開設定変更の確認ステップ検証 (/dashboard)", async () => {
        await verifyBulkVisibilityFlow(page, importedRecordIds);
      });

      // =====================================================================
      // Step 4: 一括操作モードによるインポートレコード削除
      // =====================================================================
      await test.step("Step 4: 一括操作モードによるインポートレコード削除 (/dashboard)", async () => {
        await bulkDeleteRecords(page, importedRecordIds);
      });
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      // =====================================================================
      // Step 5: クリーンアップ (テスト成否にかかわらず実行専用サブアカウントを削除)
      // =====================================================================
      if (accountCreated) {
        await test.step("Step 5: テスト専用アカウントおよび家族の削除 (/settings)", async () => {
          await cleanupTestAccount(page, accountName);
        });
      }
    }
  });
});
