// ============================================
// GET /api/pos/client-inventory-by-phone
// POS Integration - Get Client Active Inventory by Phone Number
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  POSClientInventoryResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import { getClientInventory } from "@/lib/store/inventory.service";
import { getPool, sql } from "@/lib/db";
import { authenticate, isAuthResult } from "@/lib/api-auth";

export const runtime = "nodejs";

const corsHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "").replace(/^\+20/, "0");
}

/**
 * GET /api/pos/client-inventory-by-phone?phone=01012345678
 *
 * Used at POS when a client arrives — looks up their active store
 * purchases (items bought with CUT Coins) by phone number.
 *
 * Query params:
 * - phone: string  (Egyptian mobile, e.g. 01012345678 or +201012345678)
 *
 * Returns only ACTIVE inventory items (not yet used/expired/cancelled).
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<POSClientInventoryResponse | StoreErrorResponse>> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth as NextResponse<StoreErrorResponse>;

  try {
    const { searchParams } = new URL(req.url);
    const phoneParam = searchParams.get("phone");

    if (!phoneParam) {
      return NextResponse.json(
        { ok: false, error: "phone is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const phone = normalizePhone(phoneParam);
    if (phone.length < 10) {
      return NextResponse.json(
        { ok: false, error: "رقم الهاتف غير صحيح" },
        { status: 400, headers: corsHeaders },
      );
    }

    const db = await getPool();

    // Lookup client by phone (Mobile column)
    const clientResult = await db
      .request()
      .input("phone", sql.NVarChar(20), phone)
      .input("tenantId", sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT TOP (2) ClientID, Name
        FROM [dbo].[TblClient]
        WHERE TenantId = @tenantId AND Mobile = @phone
      `);

    // Two customers sharing one phone must never be silently conflated.
    // Do not leak which accounts are duplicated; manager resolves this.
    if (clientResult.recordset.length !== 1) {
      return NextResponse.json(
        { ok: false, error: "لم يتم العثور على عميل بهذا الرقم" },
        { status: 404, headers: corsHeaders },
      );
    }

    const clientRow = clientResult.recordset[0];
    const clientId: number = clientRow.ClientID;
    const clientName: string = clientRow.Name || "";

    // Get only ACTIVE inventory items (purchased with points, not yet used)
    const activeItems = await getClientInventory(clientId, "ACTIVE");

    const response: POSClientInventoryResponse = {
      ok: true,
      clientId,
      clientName,
      activeItems,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/pos/client-inventory-by-phone] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "فشل تحميل بيانات العميل" },
      { status: 500, headers: corsHeaders },
    );
  }
}
