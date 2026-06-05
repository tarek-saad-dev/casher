// ============================================
// POST /api/admin/store/clear
// Clear all store data (items, inventory, purchases, logs)
// DANGER: Deletes everything!
// ============================================

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    const db = await getPool();

    // Delete in child-to-parent order to respect FK constraints
    await db.request().query(`
      -- 1. Delete inventory usage logs
      DELETE FROM [dbo].[TblInventoryUsageLog];

      -- 2. Delete client inventory (purchases)
      DELETE FROM [dbo].[TblClientInventory];

      -- 3. Delete store-related ledger entries
      DELETE FROM [dbo].[TblLoyaltyPointLedger]
      WHERE MovementType IN ('STORE_PURCHASE', 'STORE_REFUND', 'MYSTERY_BOX_OPEN', 'MYSTERY_BOX_BONUS');

      -- 4. Delete mystery box rewards (FK to TblLoyaltyStoreItem)
      DELETE FROM [dbo].[TblMysteryBoxReward];

      -- 5. Delete store items
      DELETE FROM [dbo].[TblLoyaltyStoreItem];
    `);

    return NextResponse.json({
      ok: true,
      message: "تم مسح جميع بيانات المتجر بنجاح",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/clear POST] error:", message);
    return NextResponse.json(
      { ok: false, error: "فشل مسح البيانات: " + message },
      { status: 500 },
    );
  }
}
