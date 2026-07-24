import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  financialNotFoundResponse,
  isActiveBranchContext,
  requireActiveBranchContext,
  validateBusinessDayBelongsToBranch,
} from '@/lib/branch';
import { BranchDomainError } from '@/lib/branch/types';

// GET /api/day/summary?id=2332 — day summary for close screen (active branch only)
export async function GET(req: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const dayID = req.nextUrl.searchParams.get('id');
    if (!dayID) {
      return NextResponse.json({ error: 'Missing day id' }, { status: 400 });
    }

    const dayIdNum = parseInt(dayID, 10);
    let day;
    try {
      day = await validateBusinessDayBelongsToBranch(dayIdNum, branch.branchId);
    } catch (err) {
      if (err instanceof BranchDomainError) return financialNotFoundResponse();
      throw err;
    }

    const db = await getPool();
    const branchId = branch.branchId;

    const shifts = await db
      .request()
      .input('dayId', sql.Int, day.id)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT
          sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName,
          sm.StartTime, sm.EndTime, sm.Status,
          (SELECT COUNT(*) FROM [dbo].[TblinvServHead]
            WHERE ShiftMoveID = sm.ID AND BranchID = @branchId AND invType = N'مبيعات') AS salesCount,
          (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead]
            WHERE ShiftMoveID = sm.ID AND BranchID = @branchId AND invType = N'مبيعات') AS totalRevenue
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.BusinessDayID = @dayId AND sm.BranchID = @branchId
        ORDER BY sm.ID
      `);

    const payments = await db
      .request()
      .input('dayId', sql.Int, day.id)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT
          ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
          COUNT(*) AS cnt,
          SUM(h.GrandTotal) AS total
        FROM [dbo].[TblinvServHead] h
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
        WHERE h.BusinessDayID = @dayId AND h.BranchID = @branchId AND h.invType = N'مبيعات'
        GROUP BY pm.PaymentMethod
      `);

    const totals = await db
      .request()
      .input('dayId', sql.Int, day.id)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT
          COUNT(*) AS salesCount,
          ISNULL(SUM(GrandTotal), 0) AS totalRevenue
        FROM [dbo].[TblinvServHead]
        WHERE BusinessDayID = @dayId AND BranchID = @branchId AND invType = N'مبيعات'
      `);

    return NextResponse.json({
      dayID: day.id,
      date: day.newDay,
      status: day.status ? 1 : 0,
      shiftsCount: shifts.recordset.length,
      shifts: shifts.recordset,
      salesCount: totals.recordset[0].salesCount,
      totalRevenue: totals.recordset[0].totalRevenue,
      paymentBreakdown: payments.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/summary] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
