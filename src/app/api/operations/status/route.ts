import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

// GET /api/operations/status
// Returns a full operational snapshot in one request:
// - current open day
// - current user's open shift
// - all open shifts (for admin)
// - shift financial summary (if shift open)
// - day financial summary (if day open)
// - alerts
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const db = await getPool();

    // ─── 1. Current open day ─────────────────────────────────
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay, Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    const day = dayResult.recordset[0] || null;

    // ─── 2. Current user's open shift ────────────────────────
    const shiftResult = await db.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        SELECT TOP 1
          sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
          sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
          u.UserName, s.ShiftName
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.Status = 1 AND sm.UserID = @userID
        ORDER BY sm.ID DESC
      `);
    const shift = shiftResult.recordset[0] || null;

    // ─── 3. All currently open shifts (for alerts) ───────────
    const allOpenShiftsResult = await db.request().query(`
      SELECT sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName,
             sm.StartDate, sm.StartTime
      FROM [dbo].[TblShiftMove] sm
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      WHERE sm.Status = 1
      ORDER BY sm.ID
    `);
    const allOpenShifts = allOpenShiftsResult.recordset;

    // ─── 4. Shift financial summary (if shift open) ──────────
    let shiftSummary = null;
    if (shift) {
      const smID = shift.ID;

      const [salesQ, paymentsQ, cashInQ, cashOutQ] = await Promise.all([
        db.request().input('smID', sql.Int, smID).query(`
          SELECT
            COUNT(*) AS salesCount,
            ISNULL(SUM(GrandTotal), 0) AS totalRevenue
          FROM [dbo].[TblinvServHead]
          WHERE ShiftMoveID = @smID AND invType = N'مبيعات'
        `),
        db.request().input('smID', sql.Int, smID).query(`
          SELECT
            ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
            COUNT(*) AS cnt,
            ISNULL(SUM(h.GrandTotal), 0) AS total
          FROM [dbo].[TblinvServHead] h
          LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
          WHERE h.ShiftMoveID = @smID AND h.invType = N'مبيعات'
          GROUP BY pm.PaymentMethod
        `),
        db.request().input('smID', sql.Int, smID).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE ShiftMoveID = @smID AND inOut = 'in'
        `),
        db.request().input('smID', sql.Int, smID).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE ShiftMoveID = @smID AND inOut = 'out'
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
        db.request().input('dayDate', sql.Date, day.NewDay).query(`
          SELECT
            COUNT(*) AS salesCount,
            ISNULL(SUM(GrandTotal), 0) AS totalRevenue
          FROM [dbo].[TblinvServHead]
          WHERE invDate = @dayDate AND invType = N'مبيعات'
        `),
        db.request().input('dayDate', sql.Date, day.NewDay).query(`
          SELECT
            ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
            ISNULL(SUM(h.GrandTotal), 0) AS total
          FROM [dbo].[TblinvServHead] h
          LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
          WHERE h.invDate = @dayDate AND h.invType = N'مبيعات'
          GROUP BY pm.PaymentMethod
        `),
        db.request().input('dayDate', sql.Date, day.NewDay).query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS total
          FROM [dbo].[TblCashMove]
          WHERE CAST(invDate AS DATE) = @dayDate AND inOut = 'out'
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
