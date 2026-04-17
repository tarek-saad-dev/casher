import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// POST /api/day/close-and-open — Atomically close previous day + open new day
// Body: { forceCloseShifts?: boolean }
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.close') || !hasPermission(user.UserLevel, 'day.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق وفتح يوم العمل' }, { status: 403 });
    }

    let forceCloseShifts = false;
    try {
      const body = await req.json();
      forceCloseShifts = !!body?.forceCloseShifts;
    } catch {
      // No body — defaults
    }

    const db = await getPool();

    // Get current open day
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح لإغلاقه' }, { status: 400 });
    }
    const oldDay = dayResult.recordset[0];

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
          error: `يوجد ${openShifts.length} وردية مفتوحة — يجب إغلاقها أولاً أو اختيار الإغلاق التلقائي`,
          code: 'OPEN_SHIFTS',
          openShifts,
        },
        { status: 400 }
      );
    }

    // Use a transaction for atomicity
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      // 1. Force-close open shifts
      if (openShifts.length > 0 && forceCloseShifts) {
        const now = new Date();
        const hours = now.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours % 12 || 12;
        const endTime = `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${ampm}`;

        await new sql.Request(transaction)
          .input('endDate', sql.Date, now)
          .input('endTime', sql.NVarChar(50), endTime)
          .query(`
            UPDATE [dbo].[TblShiftMove]
            SET Status = 0, EndDate = @endDate, EndTime = @endTime
            WHERE Status = 1
          `);
        console.log(`[day] Force-closed ${openShifts.length} shift(s) in close-and-open, by ${user.UserName}`);
      }

      // 2. Close old day
      await new sql.Request(transaction)
        .input('dayID', sql.Int, oldDay.ID)
        .query(`UPDATE [dbo].[TblNewDay] SET Status = 0 WHERE ID = @dayID`);

      // 3. Open new day
      const newDayResult = await new sql.Request(transaction).query(`
        INSERT INTO [dbo].[TblNewDay] (NewDay, Status)
        OUTPUT INSERTED.ID, INSERTED.NewDay, INSERTED.Status
        VALUES (CAST(GETDATE() AS DATE), 1)
      `);
      const newDay = newDayResult.recordset[0];

      await transaction.commit();

      console.log(`[day] Close-and-open: closed ID=${oldDay.ID} (${oldDay.NewDay}), opened ID=${newDay.ID} (${newDay.NewDay}), by ${user.UserName}`);

      return NextResponse.json({
        ok: true,
        closedDayID: oldDay.ID,
        closedDayDate: oldDay.NewDay,
        newDay,
        closedShifts: forceCloseShifts ? openShifts.length : 0,
      }, { status: 201 });

    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[day] close-and-open ROLLBACK: ${reason}`);
      try { await transaction.rollback(); } catch { /* ignore */ }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/close-and-open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
