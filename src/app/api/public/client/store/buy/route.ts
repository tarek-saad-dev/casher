// ============================================
// POST /api/public/client/store/buy
// CUT CLUB Store - Purchase Item
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  PurchaseResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  purchaseStoreItem,
  getStoreItemById,
} from "@/lib/store/store.service";

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
 * POST /api/public/client/store/buy
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * 
 * Body:
 * - itemId: number
 */
export async function POST(
  req: NextRequest,
): Promise<NextResponse<PurchaseResponse | StoreErrorResponse>> {
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

    // Parse body
    const body = await req.json();
    const { itemId } = body;

    if (!itemId || typeof itemId !== "number") {
      return NextResponse.json(
        { ok: false, error: "itemId is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Get item details
    const item = await getStoreItemById(itemId);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    // Purchase item
    const result = await purchaseStoreItem(clientId, itemId);

    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: result.error || "Purchase failed" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Get new balance (after purchase)
    const { getClientBalance } = await import("@/lib/store/store.service");
    const newBalance = await getClientBalance(clientId);

    const response: PurchaseResponse = {
      ok: true,
      message: "تم الشراء بنجاح",
      purchase: {
        inventoryId: result.inventoryId!,
        itemId: item.itemId,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        priceCoins: item.priceCoins,
        voucherCode: result.voucherCode!,
        expiresAt: result.expiresAt
          ? new Date(result.expiresAt).toISOString()
          : null,
      },
      newBalance,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/store/buy] POST error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to purchase item" },
      { status: 500, headers: corsHeaders },
    );
  }
}
