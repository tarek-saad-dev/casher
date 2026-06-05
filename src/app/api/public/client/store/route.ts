// ============================================
// GET /api/public/client/store
// CUT CLUB Store - Main Store Endpoint
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  StoreResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  getStoreCategories,
  getAllStoreItems,
  getFeaturedStoreItems,
  addStatusToStoreItems,
  getClientBalance,
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
 * GET /api/public/client/store
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * 
 * Returns:
 * - balance: client's CUT Coins balance
 * - categories: all active store categories
 * - featuredItems: featured items with status
 * - items: all items with status (canAfford, tierLocked, stockStatus)
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<StoreResponse | StoreErrorResponse>> {
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

    // Get client balance
    const balance = await getClientBalance(clientId);

    // Get store categories
    const categories = await getStoreCategories();

    // Get all store items
    const allItems = await getAllStoreItems();

    // Get featured items
    const featuredItemsRaw = await getFeaturedStoreItems();

    // Add status to items
    const items = await addStatusToStoreItems(allItems, clientId);
    const featuredItems = await addStatusToStoreItems(
      featuredItemsRaw,
      clientId,
    );

    const response: StoreResponse = {
      ok: true,
      balance,
      categories,
      featuredItems,
      items,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/store] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load store data" },
      { status: 500, headers: corsHeaders },
    );
  }
}
