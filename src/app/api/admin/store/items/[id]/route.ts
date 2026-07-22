// ============================================
// GET /api/admin/store/items/:id
// PATCH /api/admin/store/items/:id
// DELETE /api/admin/store/items/:id
// Admin Single Item Management
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getStoreItemById,
  updateStoreItem,
  deleteStoreItem,
} from "@/lib/store/store.service";

export const runtime = "nodejs";

// GET: Get single item details
export async function GET(
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

    const item = await getStoreItemById(itemId);
    if (!item) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items/[id] GET] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to load item" }, { status: 500 });
  }
}

// PATCH: Update store item
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

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "categoryId", "code", "nameAr", "nameEn",
      "descriptionAr", "descriptionEn", "itemType",
      "priceCoins", "value", "serviceId", "productId",
      "minTierCode", "stockQuantity", "unlimitedStock",
      "expiresAfterDays", "imageUrl", "badgeText",
      "isFeatured", "isActive", "sortOrder",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const item = await updateStoreItem(itemId, updateData);
    if (!item) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items/[id] PATCH] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to update item" }, { status: 500 });
  }
}

// DELETE: Soft delete store item
export async function DELETE(
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

    const success = await deleteStoreItem(itemId);
    if (!success) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: "Item deactivated successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items/[id] DELETE] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to delete item" }, { status: 500 });
  }
}
