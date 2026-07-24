import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  getOpenBusinessDay,
  isActiveBranchContext,
  listOpenShiftsForBranch,
  getUserOpenShiftForBranch,
  requireActiveBranchContext,
} from '@/lib/branch';

export const runtime = 'nodejs';

// GET /api/operations/status
// Returns a full operational snapshot for the session active branch only.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;
    const branchId = branch.branchId;

    const db = await getPool();

    // ─── 1. Current open day (active branch) ─────────────────
    const openDay = await getOpenBusinessDay(branchId);
    const day = openDay
      ? { ID: openDay.id, NewDay: openDay.newDay, Status: openDay.status ? 1 : 0 }
      : null;

    // ─── 2. Current user's open shift on active branch ────────
    const openShift = await getUserOpenShiftForBranch(user.UserID, branchId);
    const shift = openShift
      ? {
          ID: openShift.id,
          NewDay: openShift.newDay,
          UserID: openShift.userId,
          ShiftID: openShift.shiftId,
          StartDate: openShift.startDate,
          StartTime: openShift.startTime,
          EndDate: openShift.endDate,
          EndTime: openShift.endTime,
          Status: openShift.status ? 1 : 0,
          UserName: openShift.userName,
          ShiftName: openShift.shiftName,
        }
      : null;

    // ─── 3. All currently open shifts on active branch ───────
    const branchOpenShifts = await listOpenShiftsForBranch(branchId);
    const allOpenShifts = branchOpenShifts.map((sm) => ({
      ID: sm.id,
      UserID: sm.userId,
      UserName: sm.userName,
      ShiftID: sm.shiftId,
      ShiftName: sm.shiftName,
      StartDate: sm.startDate,
      StartTime: sm.startTime,
    }));

    // ─── 4. Shift financial summary (if shift open) ──────────
    let shiftSummary = null;
    if (shift) {
      const smID = shift.ID;

      const [salesQ, paymentsQ, cashInQ, cashOutQ] = await Promise.all([
        db.request().input('smID', sql.Int, smID).input('branchId', sql.Int, branchId).query(`
          SELECT
            COUNT(*) AS salesCount,
            ISNULL(SUM(GrandTotal), 0) AS totalRevenue
          FROM [dbo].[TblinvServHead]
          WHERE ShiftMoveID = @smID AND BranchID = @branchId AND invType = N'مبيعات'
        `),
        db.request().input('smID', sql.Int, smID).input('branchId', sql.Int, branchId).query(`
          SELECT
            ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
            COUNT(*) AS cnt,
            ISNULL(SUM(h.GrandTotal), 0) AS total
          FROM [dbo].[TblinvServHead] h
          LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
          WHERE h.ShiftMoveID = @smID AND h.BranchID = @branchId AND h.invType = N'مبيعات'
          GROUP BY pm.PaymentMethod
        `),
        db.request().input('smID', sql.Int, smID).input('branchId', sql.Int, branchId).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE ShiftMoveID = @smID AND BranchID = @branchId AND inOut = 'in'
        `),
        db.request().input('smID', sql.Int, smID).input('branchId', sql.Int, branchId).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE ShiftMoveID = @smID AND BranchID = @branchId AND inOut = 'out'
        `),
      ]);

      shiftSummary = {
        shiftMoveID: smID,
        salesCount: salesQ.recordset[0].salesCount,
        totalRevenue: salesQ.recordset[0].totalRevenue,
        paymentBreakdown: paymentsQ.recordset,
        cashIn: cashInQ.recordset[0].total,
        cashOut: cashOutQ.recordset[0].total,
      };
    }

    // ─── 5. Day financial summary (if day open) ──────────────
    let daySummary = null;
    if (day) {
      const [dayTotalsQ, dayPaymentsQ, dayExpensesQ] = await Promise.all([
        db.request().input('dayDate', sql.Date, day.NewDay).input('branchId', sql.Int, branchId).query(`
          SELECT
            COUNT(*) AS salesCount,
            ISNULL(SUM(GrandTotal), 0) AS totalRevenue
          FROM [dbo].[TblinvServHead]
          WHERE invDate = @dayDate AND BranchID = @branchId AND invType = N'مبيعات'
        `),
        db.request().input('dayDate', sql.Date, day.NewDay).input('branchId', sql.Int, branchId).query(`
          SELECT
            ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
            ISNULL(SUM(h.GrandTotal), 0) AS total
          FROM [dbo].[TblinvServHead] h
          LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
          WHERE h.invDate = @dayDate AND h.BranchID = @branchId AND h.invType = N'مبيعات'
          GROUP BY pm.PaymentMethod
        `),
        db.request().input('dayDate', sql.Date, day.NewDay).input('branchId', sql.Int, branchId).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE CAST(invDate AS DATE) = @dayDate AND BranchID = @branchId AND inOut = 'out'
        `),
      ]);

      daySummary = {
        dayID: day.ID,
        date: day.NewDay,
        shiftsCount: allOpenShifts.length,
        salesCount: dayTotalsQ.recordset[0].salesCount,
        totalRevenue: dayTotalsQ.recordset[0].totalRevenue,
        totalExpenses: dayExpensesQ.recordset[0].total,
        paymentBreakdown: dayPaymentsQ.recordset,
      };
    }

    // ─── 6. User's default shift definition ──────────────────
    const userShiftResult = await db.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        SELECT u.ShiftID, s.ShiftName
        FROM [dbo].[TblUser] u
        LEFT JOIN [dbo].[TblShift] s ON u.ShiftID = s.ShiftID
        WHERE u.UserID = @userID
      `);
    const userDefaultShift = userShiftResult.recordset[0] || null;

    // ─── 7. Build alerts ─────────────────────────────────────
    const alerts: { type: 'error' | 'warning' | 'info'; message: string }[] = [];

    if (!day) {
      alerts.push({ type: 'warning', message: 'لا يوجد يوم عمل مفتوح — لا يمكن بدء أي عمليات' });
    }
    if (day && !shift) {
      alerts.push({ type: 'warning', message: 'لا توجد وردية مفتوحة — لن يمكن تسجيل مبيعات أو مصروفات' });
    }
    if (allOpenShifts.length > 1) {
      alerts.push({ type: 'info', message: `يوجد ${allOpenShifts.length} ورديات مفتوحة حالياً` });
    }
    if (day && allOpenShifts.length > 0 && user.UserLevel === 'admin') {
      alerts.push({ type: 'info', message: 'لا يمكن قفل اليوم حتى يتم قفل جميع الورديات' });
    }

    return NextResponse.json({
      user: { UserID: user.UserID, UserName: user.UserName, UserLevel: user.UserLevel },
      branch: {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
      },
      day,
      shift,
      allOpenShifts,
      shiftSummary,
      daySummary,
      userDefaultShift,
      alerts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/operations/status] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
