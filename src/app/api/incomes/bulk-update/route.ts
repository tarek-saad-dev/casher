// ============================================
// PATCH /api/incomes/bulk-update
// Bulk update income items category
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

interface BulkUpdatePayload {
  itemIds: number[];
  expInId: number;
}

/**
 * PATCH /api/incomes/bulk-update
 *
 * Body:
 * - itemIds: number[] - Array of income item IDs to update
 * - expInId: number - New category ID
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body: BulkUpdatePayload = await req.json();

    // Validation
    if (
      !body.itemIds ||
      !Array.isArray(body.itemIds) ||
      body.itemIds.length === 0
    ) {
      return NextResponse.json(
        { error: "itemIds array is required and cannot be empty" },
        { status: 400 },
      );
    }

    if (
      !body.expInId ||
      typeof body.expInId !== "number" ||
      body.expInId <= 0
    ) {
      return NextResponse.json(
        { error: "expInId is required and must be a positive number" },
        { status: 400 },
      );
    }

    // Validate all item IDs are positive numbers
    for (const id of body.itemIds) {
      if (typeof id !== "number" || id <= 0) {
        return NextResponse.json(
          { error: "All item IDs must be positive numbers" },
          { status: 400 },
        );
      }
    }

    const db = await getPool();

    // Verify the category exists
    const categoryCheck = await db
      .request()
      .input("expInId", sql.Int, body.expInId).query(`
        SELECT COUNT(*) as count 
        FROM [dbo].[TblExpINCat] 
        WHERE ExpINID = @expInId AND ExpINType = N'ايرادات'
      `);

    if (categoryCheck.recordset[0]?.count === 0) {
      return NextResponse.json(
        { error: "Invalid category ID or category is not an income category" },
        { status: 400 },
      );
    }

    // Verify all items exist and are income items
    const itemsCheck = await db.request().query(`
        SELECT COUNT(*) as validCount
        FROM [dbo].[TblCashMove] 
        WHERE ID IN (${body.itemIds.join(",")}) AND invType = N'ايرادات'
      `);

    const validCount = itemsCheck.recordset[0]?.validCount || 0;
    if (validCount !== body.itemIds.length) {
      return NextResponse.json(
        { error: "Some items are invalid or not income items" },
        { status: 400 },
      );
    }

    // Perform bulk update
    const result = await db.request().input("expInId", sql.Int, body.expInId)
      .query(`
        UPDATE [dbo].[TblCashMove]
        SET ExpINID = @expInId
        WHERE ID IN (${body.itemIds.join(",")}) AND invType = N'ايرادات'
        
        SELECT @@ROWCOUNT as updatedCount
      `);

    const updatedCount = result.recordset[0]?.updatedCount || 0;

    return NextResponse.json({
      success: true,
      updatedCount,
      message: `Successfully updated ${updatedCount} income items`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/incomes/bulk-update] PATCH error:", message);
    return NextResponse.json(
      { error: "Failed to perform bulk update" },
      { status: 500 },
    );
  }
}
