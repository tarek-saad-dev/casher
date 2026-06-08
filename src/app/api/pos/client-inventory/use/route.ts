// ============================================
// POST /api/pos/client-inventory/use
// POS Integration - Use Inventory Item
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  POSUseItemResponse,
  StoreErrorResponse,
} from "@/lib/store/store.types";
import {
  getInventoryItemById,
  useInventoryItem,
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
 * POST /api/pos/client-inventory/use
 * 
 * Body:
 * - inventoryId: number
 * - invId: number (invoice ID where item is used)
 * - notes: string (optional)
 * 
 * Logic based on ItemType:
 * - DISCOUNT_AMOUNT: Apply discount amount
 * - DISCOUNT_PERCENT: Apply percentage discount
 * - FREE_SERVICE: Inject service into invoice with price = 0
 * - DOUBLE_POINTS: Store multiplier for later use
 * - BONUS_POINTS: Grant after invoice completion
 * - VIP_UPGRADE: Flag invoice
 */
export async function POST(
  req: NextRequest,
): Promise<NextResponse<POSUseItemResponse | StoreErrorResponse>> {
  try {
    // Parse body
    const body = await req.json();
    const { inventoryId, invId, notes } = body;

    if (!inventoryId || typeof inventoryId !== "number") {
      return NextResponse.json(
        { ok: false, error: "inventoryId is required" },
        { status: 400, headers: corsHeaders },
      );
    }

    // invId is optional — voucher may be applied before invoice is saved
    const resolvedInvId: number | null =
      invId && typeof invId === "number" && invId > 0 ? invId : null;

    // Get inventory item details
    const inventoryItem = await getInventoryItemById(inventoryId);

    if (!inventoryItem) {
      return NextResponse.json(
        { ok: false, error: "Inventory item not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    if (inventoryItem.status !== "ACTIVE") {
      return NextResponse.json(
        { ok: false, error: "Item is not active" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Check expiry
    if (inventoryItem.expiresAt) {
      const expiryDate = new Date(inventoryItem.expiresAt);
      if (expiryDate < new Date()) {
        return NextResponse.json(
          { ok: false, error: "Item has expired" },
          { status: 400, headers: corsHeaders },
        );
      }
    }

    // Mark item as used
    const useResult = await useInventoryItem(
      inventoryId,
      resolvedInvId,
      null,
      notes || (resolvedInvId ? `Used in invoice #${resolvedInvId}` : "Applied at POS"),
    );

    if (!useResult.success) {
      return NextResponse.json(
        { ok: false, error: useResult.error || "Failed to use item" },
        { status: 400, headers: corsHeaders },
      );
    }

    // Determine applied effect based on item type
    let appliedEffect = "";
    const itemType = inventoryItem.item.itemType;
    const value = inventoryItem.item.value;

    switch (itemType) {
      case "DISCOUNT_AMOUNT":
        appliedEffect = `خصم ${value} جنيه على الفاتورة`;
        break;
      case "DISCOUNT_PERCENT":
        appliedEffect = `خصم ${value}% على الفاتورة`;
        break;
      case "FREE_SERVICE":
        appliedEffect = `خدمة مجانية: ${inventoryItem.item.nameAr}`;
        break;
      case "FREE_PRODUCT":
        appliedEffect = `منتج مجاني: ${inventoryItem.item.nameAr}`;
        break;
      case "DOUBLE_POINTS":
        appliedEffect = "نقاط مضاعفة على هذه الفاتورة";
        break;
      case "BONUS_POINTS":
        appliedEffect = `نقاط إضافية: ${value} نقطة`;
        break;
      case "VIP_UPGRADE":
        appliedEffect = "ترقية VIP لهذه الزيارة";
        break;
      case "PRIORITY_BOOKING":
        appliedEffect = "أولوية في الحجز";
        break;
      default:
        appliedEffect = inventoryItem.item.nameAr;
    }

    const response: POSUseItemResponse = {
      ok: true,
      message: "تم استخدام العنصر بنجاح",
      usedItem: {
        inventoryId,
        itemType,
        nameAr: inventoryItem.item.nameAr,
        value,
      },
      appliedEffect,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/pos/client-inventory/use] POST error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to use inventory item" },
      { status: 500, headers: corsHeaders },
    );
  }
}
