// ============================================
// POST /api/public/client/store/open-box
// CUT CLUB Store - Open Mystery Box
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  MysteryBoxOpenResult,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import { openMysteryBox } from "@/lib/store/mysterybox.service";

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
 * POST /api/public/client/store/open-box
 * 
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * 
 * Body:
 * - inventoryId: number (the mystery box inventory item)
 * 
 * Backend determines result using weighted probabilities.
 * NOT frontend.
 */
export async function POST(
  req: NextRequest,
): Promise<NextResponse<MysteryBoxOpenResult | StoreErrorResponse>> {
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
    const { inventoryId } = body;

    if (!inventoryId || typeof inventoryId !== "number") {
      return NextResponse.json(
        { ok: false, error: "inventoryId is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Open mystery box
    const result = await openMysteryBox(inventoryId, clientId);

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/store/open-box] POST error:", message);
    return NextResponse.json(
      { ok: false, error: message || "Failed to open mystery box" },
      { status: 500, headers: corsHeaders },
    );
  }
}
