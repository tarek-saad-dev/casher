import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// GET /api/shift — Get current open shift for the authenticated user
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ shift: null });
    }

    const db = await getPool();
    const result = await db.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        SELECT TOP 1
          sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
          sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
          u.UserName,
          s.ShiftName
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.Status = 1 AND sm.UserID = @userID
        ORDER BY sm.ID DESC
      `);
    if (result.recordset.length === 0) {
      return NextResponse.json({ shift: null });
    }
    return NextResponse.json({ shift: result.recordset[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
