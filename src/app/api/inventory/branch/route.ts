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
 */
export async function GET() {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    const result = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT
          p.ProID AS productId,
          p.ProName AS name,
          p.PPrice AS basePrice,
          p.ProType AS proType,
          c.CatType AS catType,
          CAST(1 AS bit) AS trackStock,
          bi.BranchID AS branchId,
          bi.QtyOnHand AS qtyOnHand,
          bi.ReorderLevel AS reorderLevel,
          bi.LastMovementAt AS lastMovementAt
        FROM dbo.TblBranchInventory bi
        INNER JOIN dbo.TblPro p ON p.ProID = bi.ProID
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
        WHERE bi.BranchID = @branchId
        ORDER BY p.ProName
      `);

    const items = result.recordset.map((r: Record<string, unknown>) => ({
      productId: r.productId,
      name: r.name,
      basePrice: r.basePrice,
      trackStock: true,
      inventory: {
        branchId: r.branchId,
        qtyOnHand: Number(r.qtyOnHand),
        reorderLevel: r.reorderLevel == null ? null : Number(r.reorderLevel),
        lastMovementAt: r.lastMovementAt,
      },
    }));

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
 * POST /api/inventory/adjust — manual branch-scoped stock adjustment.
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
      // Explicit rejection of forged branch — session wins; treat as bad request.
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
