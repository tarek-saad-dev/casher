// ============================================
// GET /api/public/client/inventory/[inventoryId]
// CUT CLUB Store - Get Inventory Item Details
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  InventoryItemDetailResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  getInventoryItemById,
  getInventoryUsageHistory,
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
 * GET /api/public/client/inventory/[inventoryId]
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ inventoryId: string }> },
): Promise<NextResponse<InventoryItemDetailResponse | StoreErrorResponse>> {
  try {
    const { inventoryId: inventoryIdStr } = await params;
    const inventoryId = parseInt(inventoryIdStr, 10);

    if (isNaN(inventoryId) || inventoryId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid inventoryId" },
        { status: 400, headers: corsHeaders },
      );
    }

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

    // Get inventory item
    const item = await getInventoryItemById(inventoryId);

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Inventory item not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    // Verify ownership
    if (item.clientId !== clientId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized access" },
        { status: 403, headers: corsHeaders },
      );
    }

    // Get usage history
    const usageHistory = await getInventoryUsageHistory(inventoryId);

    const response: InventoryItemDetailResponse = {
      ok: true,
      item,
      usageHistory,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/inventory/[inventoryId]] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load inventory item details" },
      { status: 500, headers: corsHeaders },
    );
  }
}
