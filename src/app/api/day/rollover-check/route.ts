import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/day/rollover-check — Check if current open day is stale vs today
export async function GET() {
  try {
    const db = await getPool();

    // Get current open day
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay, Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1
      ORDER BY ID DESC
    `);

    if (dayResult.recordset.length === 0) {
      return NextResponse.json({
        needsRollover: false,
        isStale: false,
        hasOpenDay: false,
        openDay: null,
        openDayDate: null,
        todayDate: null,
        openShifts: [],
      });
    }

    const openDay = dayResult.recordset[0];
    const openDayDate = new Date(openDay.NewDay).toISOString().split('T')[0];

    // Get server's today date (use SQL Server GETDATE to stay consistent)
    const todayResult = await db.request().query(`SELECT CAST(GETDATE() AS DATE) AS today`);
    const todayDate = new Date(todayResult.recordset[0].today).toISOString().split('T')[0];

    const isStale = openDayDate < todayDate;

    // Get open shifts for this day
    const shiftsResult = await db.request().query(`
      SELECT
        sm.ID, sm.UserID, sm.ShiftID, sm.StartTime,
        u.UserName,
        s.ShiftName
      FROM [dbo].[TblShiftMove] sm
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      WHERE sm.Status = 1
      ORDER BY sm.ID
    `);

    return NextResponse.json({
      needsRollover: isStale,
      isStale,
      hasOpenDay: true,
      openDay,
      openDayDate,
      todayDate,
      openShifts: shiftsResult.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/rollover-check] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
