import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/shift/summary?id=4457 — Get shift summary for close screen
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing shift id' }, { status: 400 });
    }
    const shiftMoveID = parseInt(id);

    const db = await getPool();

    // Get shift info
    const shiftResult = await db.request()
      .input('id', sql.Int, shiftMoveID)
      .query(`
        SELECT sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
               sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
               u.UserName, s.ShiftName
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.ID = @id
      `);
    if (shiftResult.recordset.length === 0) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    const shift = shiftResult.recordset[0];

    // Sales count + total
    const salesTotals = await db.request()
      .input('smID', sql.Int, shiftMoveID)
      .query(`
        SELECT
          COUNT(*) AS salesCount,
          ISNULL(SUM(GrandTotal), 0) AS totalRevenue
        FROM [dbo].[TblinvServHead]
        WHERE ShiftMoveID = @smID AND invType = N'مبيعات'
      `);

    // Payment breakdown
    const payments = await db.request()
      .input('smID', sql.Int, shiftMoveID)
      .query(`
        SELECT
          ISNULL(pm.PaymentMethod, N'غير محدد') AS method,
          COUNT(*) AS cnt,
          ISNULL(SUM(h.GrandTotal), 0) AS total
        FROM [dbo].[TblinvServHead] h
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
        WHERE h.ShiftMoveID = @smID AND h.invType = N'مبيعات'
        GROUP BY pm.PaymentMethod
      `);

    // Cash movement summary
    const cashIn = await db.request()
      .input('smID', sql.Int, shiftMoveID)
      .query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total
        FROM [dbo].[TblCashMove]
        WHERE ShiftMoveID = @smID AND inOut = 'in'
      `);
    const cashOut = await db.request()
      .input('smID', sql.Int, shiftMoveID)
      .query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total
        FROM [dbo].[TblCashMove]
        WHERE ShiftMoveID = @smID AND inOut = 'out'
      `);

    return NextResponse.json({
      shiftMoveID: shift.ID,
      userName: shift.UserName,
      shiftName: shift.ShiftName,
      startTime: shift.StartTime,
      endTime: shift.EndTime,
      status: shift.Status,
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
