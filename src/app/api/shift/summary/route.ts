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

    // Payment breakdown — read from TblinvServPayment (real per-method allocations)
    // Falls back to header PaymentMethodID for older invoices without payment rows.
    // Excludes the internal clearing account from display.
    const payments = await db.request()
      .input('smID', sql.Int, shiftMoveID)
      .query(`
        WITH ShiftInvoices AS (
          SELECT h.invID, h.invType, h.ShiftMoveID, h.PaymentMethodID,
                 COALESCE(NULLIF(h.Payment, 0), h.GrandTotal, 0) AS PayValue
          FROM [dbo].[TblinvServHead] h
          WHERE h.ShiftMoveID = @smID AND h.invType = N'\u0645\u0628\u064a\u0639\u0627\u062a'
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
