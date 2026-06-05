// ============================================
// GET /api/public/client/inventory
// CUT CLUB Store - Get Client Inventory
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  InventoryResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  getClientInventory,
  getInventoryStats,
} from "@/lib/store/inventory.service";

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
 * GET /api/public/client/inventory
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * - status: string (optional, default: ACTIVE, can be: ACTIVE, USED, EXPIRED, CANCELLED, ALL)
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<InventoryResponse | StoreErrorResponse>> {
  try {
    // TODO: Replace with authenticated session / OTP token
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get("clientId");

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "clientId is required in development mode" },
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

    // Get status filter
    const status = searchParams.get("status") || "ACTIVE";

    // Get inventory items
    const items = await getClientInventory(clientId, status);

    // Get inventory stats
    const stats = await getInventoryStats(clientId);

    const response: InventoryResponse = {
      ok: true,
      items,
      stats,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/inventory] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load inventory data" },
      { status: 500, headers: corsHeaders },
    );
  }
}
