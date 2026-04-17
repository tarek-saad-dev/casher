import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// POST /api/shift/open — Open a new shift session
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'shift.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية فتح وردية' }, { status: 403 });
    }

    const body = await req.json();
    const shiftID: number = body.shiftID;
    if (!shiftID) {
      return NextResponse.json({ error: 'يجب تحديد الوردية' }, { status: 400 });
    }

    const db = await getPool();

    // Check active business day exists
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح — يجب فتح يوم أولاً' }, { status: 400 });
    }
    const activeDay = dayResult.recordset[0];

    // Check this user doesn't already have an open shift
    const existingShift = await db.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        SELECT TOP 1 ID FROM [dbo].[TblShiftMove]
        WHERE UserID = @userID AND Status = 1
      `);
    if (existingShift.recordset.length > 0) {
      return NextResponse.json(
        { error: 'لديك وردية مفتوحة بالفعل — يجب إغلاقها أولاً' },
        { status: 400 }
      );
    }

    // Format start time
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const startTime = `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${ampm}`;

    // Insert new shift move
    const result = await db.request()
      .input('newDay', sql.Date, activeDay.NewDay)
      .input('userID', sql.Int, user.UserID)
      .input('shiftID', sql.Int, shiftID)
      .input('startDate', sql.Date, activeDay.NewDay)
      .input('startTime', sql.NChar(10), startTime)
      .query(`
        INSERT INTO [dbo].[TblShiftMove] (NewDay, UserID, ShiftID, StartDate, StartTime, Status)
        OUTPUT INSERTED.ID, INSERTED.NewDay, INSERTED.UserID, INSERTED.ShiftID,
               INSERTED.StartDate, INSERTED.StartTime, INSERTED.Status
        VALUES (@newDay, @userID, @shiftID, @startDate, @startTime, 1)
      `);

    const newShift = result.recordset[0];
    console.log(`[shift] Opened shift: ID=${newShift.ID}, ShiftID=${shiftID}, UserID=${user.UserID} (${user.UserName}), Day=${activeDay.NewDay}`);

    return NextResponse.json({ shift: newShift }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
