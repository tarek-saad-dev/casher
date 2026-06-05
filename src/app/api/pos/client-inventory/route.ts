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

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  try {
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get("clientId");

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "clientId is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const clientId = parseInt(clientIdParam, 10);
    if (isNaN(clientId) || clientId <= 0) {
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
      .query(`
        SELECT Name
        FROM [dbo].[TblClient]
        WHERE ClientID = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Client not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    const clientName = clientResult.recordset[0].Name || "";

    // Get active inventory items only
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
    console.error("[api/pos/client-inventory] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load client inventory" },
      { status: 500, headers: corsHeaders },
    );
  }
}
