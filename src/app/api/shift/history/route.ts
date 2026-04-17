import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/shift/history — Get last 15 shift sessions
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT TOP 15
        sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
        sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
        u.UserName,
        s.ShiftName,
        (SELECT COUNT(*) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS salesCount,
        (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead] WHERE ShiftMoveID = sm.ID AND invType = N'مبيعات') AS totalRevenue
      FROM [dbo].[TblShiftMove] sm
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      ORDER BY sm.ID DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/history] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
