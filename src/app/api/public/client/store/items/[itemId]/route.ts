// ============================================
// GET /api/public/client/store/items/[itemId]
// CUT CLUB Store - Get Store Item Details
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  StoreItemResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  getStoreItemById,
  getStoreItemsByCategory,
  addStatusToStoreItems,
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
 * GET /api/public/client/store/items/[itemId]
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
): Promise<NextResponse<StoreItemResponse | StoreErrorResponse>> {
  try {
    const { itemId: itemIdStr } = await params;
    const itemId = parseInt(itemIdStr, 10);

    if (isNaN(itemId) || itemId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid itemId" },
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

    // Get item details
    const item = await getStoreItemById(itemId);

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    // Add status to item
    const itemsWithStatus = await addStatusToStoreItems([item], clientId);
    const itemWithStatus = itemsWithStatus[0];

    // Get related items from same category
    const relatedItemsRaw = await getStoreItemsByCategory(item.categoryId);
    const relatedItemsFiltered = relatedItemsRaw
      .filter((i) => i.itemId !== itemId)
      .slice(0, 4);
    const relatedItems = await addStatusToStoreItems(
      relatedItemsFiltered,
      clientId,
    );

    const response: StoreItemResponse = {
      ok: true,
      item: itemWithStatus,
      relatedItems,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/store/items] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load item details" },
      { status: 500, headers: corsHeaders },
    );
  }
}
