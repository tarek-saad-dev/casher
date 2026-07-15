// ============================================
// PATCH /api/incomes/bulk-update
// Bulk update income items category + sync employee_funding
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  EmployeeLedgerDualWriteError,
} from '@/lib/services/employeeLedgerDualWrite';
import { syncEmployeeFundingFromCashMove } from '@/lib/services/employeeLedgerFundingSyncService';

export const runtime = 'nodejs';

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
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    const body: BulkUpdatePayload = await req.json();

    if (!body.itemIds || !Array.isArray(body.itemIds) || body.itemIds.length === 0) {
      return NextResponse.json(
        { error: 'itemIds array is required and cannot be empty' },
        { status: 400 },
      );
    }

    if (!body.expInId || typeof body.expInId !== 'number' || body.expInId <= 0) {
      return NextResponse.json(
        { error: 'expInId is required and must be a positive number' },
        { status: 400 },
      );
    }

    for (const id of body.itemIds) {
      if (typeof id !== 'number' || id <= 0) {
        return NextResponse.json(
          { error: 'All item IDs must be positive numbers' },
          { status: 400 },
        );
      }
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const categoryCheck = await new sql.Request(transaction)
        .input('expInId', sql.Int, body.expInId)
        .query(`
          SELECT COUNT(*) as count
          FROM dbo.TblExpINCat
          WHERE ExpINID = @expInId AND ExpINType = N'ايرادات'
        `);

      if (categoryCheck.recordset[0]?.count === 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: 'Invalid category ID or category is not an income category' },
          { status: 400 },
        );
      }

      const idsList = body.itemIds.join(',');
      const itemsCheck = await new sql.Request(transaction).query(`
        SELECT COUNT(*) as validCount
        FROM dbo.TblCashMove
        WHERE ID IN (${idsList}) AND invType = N'ايرادات'
      `);

      const validCount = itemsCheck.recordset[0]?.validCount || 0;
      if (validCount !== body.itemIds.length) {
        await transaction.rollback();
        return NextResponse.json(
          { error: 'Some items are invalid or not income items' },
          { status: 400 },
        );
      }

      const updateResult = await new sql.Request(transaction)
        .input('expInId', sql.Int, body.expInId)
        .query(`
          UPDATE dbo.TblCashMove
          SET ExpINID = @expInId
          WHERE ID IN (${idsList}) AND invType = N'ايرادات'

          SELECT @@ROWCOUNT as updatedCount
        `);

      const updatedCount = Number(updateResult.recordset[0]?.updatedCount || 0);
      const syncOutcomes: Array<{ cashMoveId: number; outcome: string }> = [];

      for (const cashMoveId of body.itemIds) {
        const sync = await syncEmployeeFundingFromCashMove(transaction, cashMoveId, {
          createdByUserId: session.UserID,
        });
        syncOutcomes.push({ cashMoveId, outcome: sync.outcome });
      }

      await transaction.commit();

      return NextResponse.json({
        success: true,
        updatedCount,
        message: `Successfully updated ${updatedCount} income items`,
        fundingSync: syncOutcomes,
      });
    } catch (inner) {
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw inner;
    }
  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/bulk-update] PATCH error:', message);
    return NextResponse.json(
      { error: 'Failed to perform bulk update' },
      { status: 500 },
    );
  }
}
