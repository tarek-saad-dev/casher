import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';
import { getSession } from '@/lib/session';
import { applyManualStockAdjustment, InventoryDomainError } from '@/lib/inventory/purchaseInventory.service';

export const runtime = 'nodejs';

/**
 * GET /api/inventory/branch — active-branch stock list (tracked products).
 * Includes catalog products with no balance row as qty 0.
 */
export async function GET() {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;
    if (!branch.tenantId) {
      return NextResponse.json({ error: 'سياق المستأجر غير متوفر' }, { status: 403 });
    }

    const db = await getPool();
    const result = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .input('tenantId', sql.UniqueIdentifier, branch.tenantId)
      .query(`
        SELECT
          p.ProID AS productId,
          ISNULL(NULLIF(LTRIM(RTRIM(p.ProNameAr)), N''), p.ProName) AS name,
          p.ProductCode AS productCode,
          p.Barcode AS barcode,
          p.ImageUrl AS imageUrl,
          p.PPrice AS basePrice,
          p.SPrice1 AS sellingPrice,
          p.Brand AS brand,
          p.StockUnit AS stockUnit,
          p.MinStockThreshold AS minStockThreshold,
          p.ProType AS proType,
          c.CatType AS catType,
          c.CatName AS catName,
          CAST(1 AS bit) AS trackStock,
          @branchId AS branchId,
          CAST(ISNULL(bi.QtyOnHand, 0) AS DECIMAL(10,2)) AS qtyOnHand,
          COALESCE(bi.ReorderLevel, p.MinStockThreshold) AS reorderLevel,
          bi.LastMovementAt AS lastMovementAt
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId
        LEFT JOIN dbo.TblBranchInventory bi
          ON bi.ProID = p.ProID AND bi.BranchID = @branchId
        WHERE p.TenantId = @tenantId
          AND (p.isDeleted = 0 OR p.isDeleted IS NULL)
          AND (
            LOWER(ISNULL(c.CatType, N'')) = N'pro'
            OR LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
          )
        ORDER BY ISNULL(p.ProNameAr, p.ProName)
      `);

    const items = result.recordset.map((r: Record<string, unknown>) => {
      const qtyOnHand = Number(r.qtyOnHand);
      const reorderLevel = r.reorderLevel == null ? null : Number(r.reorderLevel);
      let stockStatus: 'ok' | 'low' | 'out' = 'ok';
      if (qtyOnHand <= 0) stockStatus = 'out';
      else if (reorderLevel != null && qtyOnHand <= reorderLevel) stockStatus = 'low';
      return {
        productId: r.productId,
        name: r.name,
        productCode: r.productCode ?? null,
        barcode: r.barcode ?? null,
        imageUrl: r.imageUrl ?? null,
        basePrice: r.basePrice,
        sellingPrice: r.sellingPrice,
        brand: r.brand ?? null,
        stockUnit: r.stockUnit ?? null,
        catName: r.catName ?? null,
        trackStock: true,
        stockStatus,
        inventory: {
          branchId: r.branchId,
          qtyOnHand,
          reorderLevel,
          lastMovementAt: r.lastMovementAt,
          inventoryValueAtCost: qtyOnHand * Number(r.basePrice ?? 0),
        },
      };
    });

    return NextResponse.json({
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/inventory/branch — manual branch-scoped stock adjustment.
 * Body: { proId, quantityDelta? , setCountedTo?, reason }
 * Never accepts BranchID from body.
 */
export async function POST(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = await req.json();
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json(
        { error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }

    const proId = Number(body.proId);
    const reason = String(body.reason || '');
    const setCountedTo =
      body.setCountedTo == null ? null : Number(body.setCountedTo);
    const quantityDelta =
      body.quantityDelta == null ? 0 : Number(body.quantityDelta);

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const result = await applyManualStockAdjustment(transaction, {
        branchId: branch.branchId,
        proId,
        quantityDelta,
        setCountedTo,
        reason,
        userId: session.UserID,
      });
      await transaction.commit();
      return NextResponse.json({
        ok: true,
        branchId: branch.branchId,
        proId,
        ...result,
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: unknown) {
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
