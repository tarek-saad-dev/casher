// ============================================
// GET /api/admin/store/items
// POST /api/admin/store/items
// Admin Store Items Management
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getAllStoreItemsAdmin,
  createStoreItem,
} from "@/lib/store/store.service";

export const runtime = "nodejs";

// GET: List all store items (admin)
export async function GET(req: NextRequest) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const { searchParams } = new URL(req.url);
    const filters = {
      isActive: searchParams.has("isActive")
        ? searchParams.get("isActive") === "true"
        : null,
      categoryId: searchParams.has("categoryId")
        ? parseInt(searchParams.get("categoryId")!, 10)
        : null,
      itemType: searchParams.get("itemType"),
      search: searchParams.get("search"),
    };

    const items = await getAllStoreItemsAdmin(filters);

    return NextResponse.json({ ok: true, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items GET] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to load items" }, { status: 500 });
  }
}

// POST: Create new store item
export async function POST(req: NextRequest) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const body = await req.json();

    // Validation
    if (!body.code || !body.nameAr || !body.nameEn || !body.itemType) {
      return NextResponse.json(
        { ok: false, error: "code, nameAr, nameEn, and itemType are required" },
        { status: 400 },
      );
    }
    if (typeof body.priceCoins !== "number" || body.priceCoins < 0) {
      return NextResponse.json(
        { ok: false, error: "priceCoins must be a non-negative number" },
        { status: 400 },
      );
    }

    const item = await createStoreItem({
      categoryId: body.categoryId ?? 1,
      code: String(body.code),
      nameAr: String(body.nameAr),
      nameEn: String(body.nameEn),
      descriptionAr: body.descriptionAr ?? "",
      descriptionEn: body.descriptionEn ?? "",
      itemType: body.itemType,
      priceCoins: body.priceCoins,
      value: body.value ?? null,
      serviceId: body.serviceId ?? null,
      productId: body.productId ?? null,
      minTierCode: body.minTierCode ?? null,
      stockQuantity: body.stockQuantity ?? null,
      unlimitedStock: body.unlimitedStock ?? false,
      expiresAfterDays: body.expiresAfterDays ?? null,
      imageUrl: body.imageUrl ?? null,
      badgeText: body.badgeText ?? null,
      isFeatured: body.isFeatured ?? false,
      isActive: body.isActive ?? true,
      sortOrder: body.sortOrder ?? 0,
    });

    return NextResponse.json({ ok: true, item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/items POST] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to create item" }, { status: 500 });
  }
}
