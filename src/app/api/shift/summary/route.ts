import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  financialNotFoundResponse,
  isActiveBranchContext,
  requireActiveBranchContext,
  validateShiftBelongsToBranch,
} from '@/lib/branch';
import { BranchDomainError } from '@/lib/branch/types';

// GET /api/shift/summary?id=4457 — shift summary for close screen (active branch only)
export async function GET(req: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing shift id' }, { status: 400 });
    }
    const shiftMoveID = parseInt(id, 10);

    let shift;
    try {
      shift = await validateShiftBelongsToBranch(shiftMoveID, branch.branchId);
    } catch (err) {
      if (err instanceof BranchDomainError) return financialNotFoundResponse();
      throw err;
    }

    const db = await getPool();
    const branchId = branch.branchId;

    const salesTotals = await db
      .request()
      .input('smID', sql.Int, shiftMoveID)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT
          COUNT(*) AS salesCount,
          ISNULL(SUM(GrandTotal), 0) AS totalRevenue
        FROM [dbo].[TblinvServHead]
        WHERE ShiftMoveID = @smID AND BranchID = @branchId AND invType = N'مبيعات'
      `);

    const payments = await db
      .request()
      .input('smID', sql.Int, shiftMoveID)
      .input('branchId', sql.Int, branchId)
      .query(`
        WITH ShiftInvoices AS (
          SELECT h.invID, h.invType, h.ShiftMoveID, h.PaymentMethodID,
                 COALESCE(NULLIF(h.Payment, 0), h.GrandTotal, 0) AS PayValue
          FROM [dbo].[TblinvServHead] h
          WHERE h.ShiftMoveID = @smID AND h.BranchID = @branchId AND h.invType = N'\u0645\u0628\u064a\u0639\u0627\u062a'
        ),
        PayRows AS (
          SELECT p.PaymentMethodID, ISNULL(p.PayValue, 0) AS PayValue
          FROM [dbo].[TblinvServPayment] p
          INNER JOIN ShiftInvoices h ON h.invID = p.invID AND h.invType = p.invType
          WHERE ISNULL(p.PayValue, 0) > 0
        ),
        FallbackRows AS (
          SELECT h.PaymentMethodID, h.PayValue
          FROM ShiftInvoices h
          WHERE h.PaymentMethodID IS NOT NULL AND h.PayValue > 0
            AND NOT EXISTS (
              SELECT 1 FROM [dbo].[TblinvServPayment] p
              WHERE p.invID = h.invID AND p.invType = h.invType AND ISNULL(p.PayValue, 0) > 0
            )
        ),
        AllRows AS (
          SELECT PaymentMethodID, PayValue FROM PayRows
          UNION ALL
          SELECT PaymentMethodID, PayValue FROM FallbackRows
        )
        SELECT
          ISNULL(pm.PaymentMethod, N'\u063a\u064a\u0631 \u0645\u062d\u062f\u062f') AS method,
          COUNT(*) AS cnt,
          ISNULL(SUM(ar.PayValue), 0) AS total
        FROM AllRows ar
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON pm.PaymentID = ar.PaymentMethodID
        WHERE ISNULL(pm.PaymentMethod, N'') <> N'\u062f\u0641\u0639 \u0645\u062a\u0639\u062f\u062f - \u062d\u0633\u0627\u0628 \u062a\u0633\u0648\u064a\u0629'
        GROUP BY pm.PaymentMethod
      `);

    const cashIn = await db
      .request()
      .input('smID', sql.Int, shiftMoveID)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total
        FROM [dbo].[TblCashMove]
        WHERE ShiftMoveID = @smID AND BranchID = @branchId AND inOut = 'in'
      `);
    const cashOut = await db
      .request()
      .input('smID', sql.Int, shiftMoveID)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total
        FROM [dbo].[TblCashMove]
        WHERE ShiftMoveID = @smID AND BranchID = @branchId AND inOut = 'out'
      `);

    return NextResponse.json({
      shiftMoveID: shift.id,
      userName: shift.userName,
      shiftName: shift.shiftName,
      startTime: shift.startTime,
      endTime: shift.endTime,
      status: shift.status ? 1 : 0,
      salesCount: salesTotals.recordset[0].salesCount,
      totalRevenue: salesTotals.recordset[0].totalRevenue,
      paymentBreakdown: payments.recordset,
      cashIn: cashIn.recordset[0].total,
      cashOut: cashOut.recordset[0].total,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/summary] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
