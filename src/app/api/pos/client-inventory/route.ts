// ============================================
// GET /api/pos/client-inventory
// POS Integration - Get Client Active Inventory
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  POSClientInventoryResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import { getClientInventory } from "@/lib/store/inventory.service";
import { getPool, sql } from "@/lib/db";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import { validateUserBranchAccess } from "@/lib/branch";
import { resolveTrustedLegacySalonId } from "@/lib/cut-club/cashierSalonMap";

export const runtime = "nodejs";

const corsHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/pos/client-inventory
 * 
 * Query params:
 * - clientId: number
 * 
 * Returns only ACTIVE inventory items for POS usage
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<POSClientInventoryResponse | StoreErrorResponse>> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth as NextResponse<StoreErrorResponse>;

  try {
    const access = await validateUserBranchAccess(auth.userId, auth.activeBranchId);
    if (!access.canOperate) return NextResponse.json({ ok: false, error: "غير مصرح" },
      { status: 403, headers: corsHeaders });
    const legacySalonId = resolveTrustedLegacySalonId({
      trustedTenantId: auth.tenantId, trustedBranchId: auth.activeBranchId,
    });
    if (legacySalonId === null) return NextResponse.json({
      ok: false, error: "يجب مراجعة ربط الصالون بالفرع أولًا",
    }, { status: 503, headers: corsHeaders });
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get("clientId");

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "clientId is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const clientId = Number(clientIdParam);
    if (!/^[1-9][0-9]{0,9}$/.test(clientIdParam) ||
        !Number.isSafeInteger(clientId) || clientId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid clientId" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Get client name
    const db = await getPool();
    const clientResult = await db
      .request()
      .input("clientId", sql.Int, clientId)
      .input("tenantId", sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT Name
        FROM [dbo].[TblClient]
        WHERE ClientID = @clientId AND TenantId = @tenantId
      `);

    if (clientResult.recordset.length !== 1) {
      return NextResponse.json(
        { ok: false, error: "Client not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    const clientName = clientResult.recordset[0].Name || "";

    // Get active inventory items only
    const activeItems = await getClientInventory(clientId, "ACTIVE", legacySalonId);

    const response: POSClientInventoryResponse = {
      ok: true,
      clientId,
      clientName,
      activeItems,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/pos/client-inventory] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load client inventory" },
      { status: 500, headers: corsHeaders },
    );
  }
}
