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

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      .query(`
        SELECT ClientID, Name
        FROM [dbo].[TblClient]
        WHERE Mobile = @phone
      `);

    if (clientResult.recordset.length === 0) {
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
