// ============================================
// GET /api/admin/store/categories
// POST /api/admin/store/categories
// Admin Store Categories Management
// ============================================

import { NextRequest, NextResponse } from "next/server";
import {
  getStoreCategoriesAdmin,
  createStoreCategory,
} from "@/lib/store/store.service";

export const runtime = "nodejs";

// GET: List all categories
export async function GET() {
  try {
    const categories = await getStoreCategoriesAdmin();
    return NextResponse.json({ ok: true, categories });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/categories GET] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to load categories" }, { status: 500 });
  }
}

// POST: Create new category
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.code || !body.nameAr || !body.nameEn) {
      return NextResponse.json(
        { ok: false, error: "code, nameAr, and nameEn are required" },
        { status: 400 },
      );
    }

    const category = await createStoreCategory({
      code: String(body.code),
      nameAr: String(body.nameAr),
      nameEn: String(body.nameEn),
      descriptionAr: body.descriptionAr ?? null,
      descriptionEn: body.descriptionEn ?? null,
      icon: body.icon ?? null,
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
    });

    return NextResponse.json({ ok: true, category });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/categories POST] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to create category" }, { status: 500 });
  }
}
