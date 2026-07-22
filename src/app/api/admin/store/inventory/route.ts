// ============================================
// GET /api/admin/store/inventory
// List all client inventory items (admin view)
// ============================================

import { NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT 
        ci.InventoryID,
        ci.ClientID,
        c.ClientName,
        c.Phone1 as ClientPhone,
        si.NameAr as ItemNameAr,
        si.NameEn as ItemNameEn,
        ci.VoucherCode,
        ci.PurchasedAt,
        ci.ExpiresAt,
        ci.Status,
        ci.UsedAt,
        ci.PurchasePriceCoins,
        ci.Notes
      FROM [dbo].[TblClientInventory] ci
      INNER JOIN [dbo].[TblLoyaltyStoreItem] si ON si.ItemID = ci.ItemID
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = ci.ClientID
      ORDER BY ci.PurchasedAt DESC
    `);

    const items = result.recordset.map((row: Record<string, unknown>) => ({
      inventoryId: row.InventoryID,
      clientId: row.ClientID,
      clientName: row.ClientName || "Unknown",
      clientPhone: row.ClientPhone || "",
      itemNameAr: row.ItemNameAr,
      itemNameEn: row.ItemNameEn,
      voucherCode: row.VoucherCode,
      purchaseDate: row.PurchasedAt,
      expiryDate: row.ExpiresAt,
      status: row.Status,
      usedAt: row.UsedAt,
      priceCoins: row.PurchasePriceCoins,
      notes: row.Notes,
    }));

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/inventory GET] error:", message);
    return NextResponse.json(
      { ok: false, error: "فشل تحميل البيانات" },
      { status: 500 },
    );
  }
}
