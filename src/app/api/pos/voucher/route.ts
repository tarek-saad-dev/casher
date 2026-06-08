// ============================================
// GET /api/pos/voucher?code=CC-8-15-MQ5TSVZY-988U
// POS Integration - Lookup Voucher Code
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type { StoreErrorResponse } from "@/lib/store/store.types";
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface VoucherLookupResponse {
  ok: true;
  inventoryId: number;
  clientId: number;
  clientName: string;
  voucherCode: string;
  status: string;
  canUse: boolean;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  purchasedAt: string;
  item: {
    itemId: number;
    nameAr: string;
    nameEn: string;
    itemType: string;
    value: number | null;
    serviceId: number | null;
  };
}

/**
 * GET /api/pos/voucher?code=CC-8-15-MQ5TSVZY-988U
 *
 * الكاشير يدخل كود الـ voucher (أو يسكانه) وبيجيب كل تفاصيله.
 * بعدها يبعت inventoryId للـ POST /api/pos/client-inventory/use لاستخدامه.
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<VoucherLookupResponse | StoreErrorResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim().toUpperCase();

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "code is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const db = await getPool();

    const result = await db
      .request()
      .input("code", sql.NVarChar(100), code)
      .query(`
        SELECT
          ci.InventoryID,
          ci.ClientID,
          c.[Name]            AS ClientName,
          ci.VoucherCode,
          ci.Status,
          ci.PurchasedAt,
          ci.ExpiresAt,
          ci.PurchasePriceCoins,
          si.ItemID,
          si.NameAr,
          si.NameEn,
          si.ItemType,
          si.Value,
          si.ServiceID
        FROM [dbo].[TblClientInventory] ci
        INNER JOIN [dbo].[TblClient]         c  ON c.ClientID  = ci.ClientID
        INNER JOIN [dbo].[TblLoyaltyStoreItem] si ON si.ItemID = ci.ItemID
        WHERE ci.VoucherCode = @code
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "كود الـ voucher غير موجود" },
        { status: 404, headers: corsHeaders },
      );
    }

    const row = result.recordset[0];

    const now = new Date();
    const expiresAt: Date | null = row.ExpiresAt ? new Date(row.ExpiresAt) : null;
    const isExpired = expiresAt !== null && expiresAt < now;
    const daysUntilExpiry = expiresAt
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const canUse = row.Status === "ACTIVE" && !isExpired;

    // Human-readable status reason
    let statusReason: string = row.Status;
    if (row.Status === "USED")      statusReason = "مستخدم من قبل";
    else if (row.Status === "EXPIRED" || isExpired) statusReason = "منتهي الصلاحية";
    else if (row.Status === "CANCELLED") statusReason = "ملغي";
    else if (row.Status === "ACTIVE")    statusReason = "صالح للاستخدام";

    const response: VoucherLookupResponse = {
      ok: true,
      inventoryId: row.InventoryID,
      clientId:    row.ClientID,
      clientName:  row.ClientName || "",
      voucherCode: row.VoucherCode,
      status:      statusReason,
      canUse,
      purchasedAt:     new Date(row.PurchasedAt).toISOString(),
      expiresAt:       expiresAt ? expiresAt.toISOString() : null,
      daysUntilExpiry,
      item: {
        itemId:    row.ItemID,
        nameAr:    row.NameAr,
        nameEn:    row.NameEn,
        itemType:  row.ItemType,
        value:     row.Value ?? null,
        serviceId: row.ServiceID ?? null,
      },
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/pos/voucher] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "فشل البحث عن الـ voucher" },
      { status: 500, headers: corsHeaders },
    );
  }
}
