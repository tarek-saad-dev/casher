import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getActiveBranchContext } from '@/lib/branch/context';
import { getUserOpenShiftForBranch } from '@/lib/branch/shiftSession';

// GET /api/incomes/meta — categories, payment methods, open shift (active branch)
export async function GET() {
  try {
    const session = await getSession();
    const db = await getPool();

    // Categories — active income categories only for new-entry form
    const catRes = await db.request().query(`
      SELECT ExpINID, ExpINType, CatName
      FROM dbo.TblExpINCat
      WHERE CatName IS NOT NULL
        AND IsActive = 1
        AND ExpINType = N'\u0627\u064a\u0631\u0627\u062f\u0627\u062a'
      ORDER BY CatName ASC
    `);

    // Resolve clearing method ID (0 = not configured, never matches a real PaymentID)
    let clearingId = 0;
    try {
      const cfgRes = await db.request().query(
        `SELECT CAST(Value AS INT) AS v FROM [dbo].[TblSettingValues] WHERE Name = N'SplitClearingMethodID'`
      );
      if (cfgRes.recordset.length > 0) clearingId = cfgRes.recordset[0].v || 0;
    } catch { /* settings table may not exist yet */ }

    // Payment methods — exclude internal split-payment clearing account by ID
    const pmRes = await db.request()
      .input('clearingId', sql.Int, clearingId)
      .query(`
        SELECT PaymentID, PaymentMethod
        FROM dbo.TblPaymentMethods
        WHERE PaymentID <> @clearingId
        ORDER BY PaymentID ASC
      `);

    // Open shift for current user on the active branch only (no cross-branch fallback)
    let openShift = null;
    if (session) {
      const branchCtx = await getActiveBranchContext();
      if (branchCtx) {
        const shift = await getUserOpenShiftForBranch(session.UserID, branchCtx.branchId);
        if (shift) {
          openShift = {
            ShiftMoveID: shift.id,
            NewDay: shift.newDay,
            UserID: shift.userId,
            UserName: shift.userName,
            ShiftID: shift.shiftId,
            ShiftName: shift.shiftName,
            StartDate: shift.startDate,
            StartTime: shift.startTime,
            Status: shift.status,
          };
        }
      }
    }

    return NextResponse.json({
      categories:     catRes.recordset,
      paymentMethods: pmRes.recordset,
      openShift,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/meta] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
