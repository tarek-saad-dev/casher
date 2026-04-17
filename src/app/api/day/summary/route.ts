import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/day/summary?id=2332 — Get day summary for close screen
export async function GET(req: NextRequest) {
  try {
    const dayID = req.nextUrl.searchParams.get('id');
    if (!dayID) {
      return NextResponse.json({ error: 'Missing day id' }, { status: 400 });
    }

    const db = await getPool();

    // Get day info
    const dayResult = await db.request()
      .input('dayID', sql.Int, parseInt(dayID))
      .query(`SELECT ID, NewDay, Status FROM [dbo].[TblNewDay] WHERE ID = @dayID`);
    if (dayResult.recordset.length === 0) {
      return NextResponse.json({ error: 'Day not found' }, { status: 404 });
    }
    const day = dayResult.recordset[0];

    // Get shifts for this day
    const shifts = await db.request()
      .input('dayDate', sql.Date, day.NewDay)
      .query(`
        SELECT
          sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName,
          sm.StartTime, sm.EndTime, sm.Status,
          (SELECT COUNT(*) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS salesCount,
          (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS totalRevenue
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.NewDay = @dayDate
        ORDER BY sm.ID
      `);

    // Payment breakdown for entire day
    const payments = await db.request()
      .input('dayDate', sql.Date, day.NewDay)
      .query(`
        SELECT
          ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
          COUNT(*) AS cnt,
          SUM(h.GrandTotal) AS total
        FROM [dbo].[TblinvServHead] h
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
        WHERE h.invDate = @dayDate AND h.invType = N'مبيعات'
        GROUP BY pm.PaymentMethod
      `);

    // Day totals
    const totals = await db.request()
      .input('dayDate', sql.Date, day.NewDay)
      .query(`
        SELECT
          COUNT(*) AS salesCount,
          ISNULL(SUM(GrandTotal), 0) AS totalRevenue
        FROM [dbo].[TblinvServHead]
        WHERE invDate = @dayDate AND invType = N'مبيعات'
      `);

    return NextResponse.json({
      dayID: day.ID,
      date: day.NewDay,
      status: day.Status,
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
