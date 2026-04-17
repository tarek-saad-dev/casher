import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// POST /api/day/close — Close the current business day
// Body: { forceCloseShifts?: boolean }
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.close')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق يوم العمل' }, { status: 403 });
    }

    let forceCloseShifts = false;
    try {
      const body = await req.json();
      forceCloseShifts = !!body?.forceCloseShifts;
    } catch {
      // No body or invalid JSON — that's fine, defaults to false
    }

    const db = await getPool();

    // Get current open day
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح لإغلاقه' }, { status: 400 });
    }
    const day = dayResult.recordset[0];

    // Check open shifts
    const openShiftsResult = await db.request().query(`
      SELECT sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName, sm.StartTime
      FROM [dbo].[TblShiftMove] sm
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      WHERE sm.Status = 1
      ORDER BY sm.ID
    `);
    const openShifts = openShiftsResult.recordset;

    if (openShifts.length > 0 && !forceCloseShifts) {
      return NextResponse.json(
        {
          error: `يوجد ${openShifts.length} وردية مفتوحة — يجب إغلاق جميع الورديات أولاً أو اختيار الإغلاق التلقائي`,
          code: 'OPEN_SHIFTS',
          openShifts,
        },
        { status: 400 }
      );
    }

    // Force-close open shifts if requested
    if (openShifts.length > 0 && forceCloseShifts) {
      const now = new Date();
      const hours = now.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const h12 = hours % 12 || 12;
      const endTime = `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${ampm}`;

      await db.request()
        .input('endDate', sql.Date, now)
        .input('endTime', sql.NVarChar(50), endTime)
        .query(`
          UPDATE [dbo].[TblShiftMove]
          SET Status = 0, EndDate = @endDate, EndTime = @endTime
          WHERE Status = 1
        `);
      console.log(`[day] Force-closed ${openShifts.length} shift(s), EndTime=${endTime}, by ${user.UserName}`);
    }

    // Close the day
    await db.request()
      .input('dayID', sql.Int, day.ID)
      .query(`UPDATE [dbo].[TblNewDay] SET Status = 0 WHERE ID = @dayID`);

    console.log(`[day] Closed day: ID=${day.ID}, NewDay=${day.NewDay}, forceCloseShifts=${forceCloseShifts}, by ${user.UserName}`);

    return NextResponse.json({
      ok: true,
      dayID: day.ID,
      closedShifts: forceCloseShifts ? openShifts.length : 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/close] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
