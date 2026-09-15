import { mutation } from "./_generated/server";

/**
 * 既存の serviceRecords および credentials テーブルに stableId (UUID v4) をバックフィルするワンショットマイグレーション。
 *
 * 実行方法 (CLI):
 * npx convex run migrations:backfillStableIds
 */
export const backfillStableIds = mutation({
  args: {},
  handler: async (ctx) => {
    // 1. serviceRecords のバックフィル
    const allRecords = await ctx.db.query("serviceRecords").collect();
    let recordsUpdated = 0;
    for (const record of allRecords) {
      if (!record.stableId) {
        await ctx.db.patch(record._id, {
          stableId: crypto.randomUUID(),
        });
        recordsUpdated++;
      }
    }

    // 2. credentials のバックフィル
    const allCredentials = await ctx.db.query("credentials").collect();
    let credentialsUpdated = 0;
    for (const cred of allCredentials) {
      if (!cred.stableId) {
        await ctx.db.patch(cred._id, {
          stableId: crypto.randomUUID(),
        });
        credentialsUpdated++;
      }
    }

    console.log(
      `[Migration] backfillStableIds completed: ${recordsUpdated}/${allRecords.length} serviceRecords updated, ${credentialsUpdated}/${allCredentials.length} credentials updated.`,
    );

    return {
      totalRecords: allRecords.length,
      recordsUpdated,
      totalCredentials: allCredentials.length,
      credentialsUpdated,
    };
  },
});
