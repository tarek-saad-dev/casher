// ============================================
// PATCH /api/admin/store/items/:id/stock
// Admin Update Item Stock
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { updateStoreItemStock } from "@/lib/store/store.service";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const { id } = await params;
    const itemId = parseInt(id, 10);
    if (isNaN(itemId) || itemId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid item ID" }, { status: 400 });
    }

    const body = await req.json();

    if (typeof body.unlimitedStock !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "unlimitedStock (boolean) is required" },
        { status: 400 },
      );
    }

    if (!body.unlimitedStock && typeof body.stockQuantity !== "number") {
      return NextResponse.json(
        { ok: false, error: "stockQuantity is required when unlimitedStock is false" },
        { status: 400 },
      );
    }

    const success = await updateStoreItemStock(
      itemId,
      body.unlimitedStock ? null : body.stockQuantity,
      body.unlimitedStock,
    );

    if (!success) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: "Stock updated successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items/[id]/stock PATCH] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to update stock" }, { status: 500 });
  }
}
