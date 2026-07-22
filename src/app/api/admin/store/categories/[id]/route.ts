// ============================================
// PATCH /api/admin/store/categories/:id
// DELETE /api/admin/store/categories/:id
// Admin Single Category Management
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  updateStoreCategory,
  deleteStoreCategory,
} from "@/lib/store/store.service";

export const runtime = "nodejs";

// PATCH: Update category
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);
    if (isNaN(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid category ID" }, { status: 400 });
    }

    const body = await req.json();

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "code", "nameAr", "nameEn", "descriptionAr", "descriptionEn",
      "icon", "sortOrder", "isActive",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const category = await updateStoreCategory(categoryId, updateData);
    if (!category) {
      return NextResponse.json({ ok: false, error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, category });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/categories/[id] PATCH] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to update category" }, { status: 500 });
  }
}

// DELETE: Soft delete category
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);
    if (isNaN(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid category ID" }, { status: 400 });
    }

    const success = await deleteStoreCategory(categoryId);
    if (!success) {
      return NextResponse.json({ ok: false, error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: "Category deactivated successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/categories/[id] DELETE] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to delete category" }, { status: 500 });
  }
}
