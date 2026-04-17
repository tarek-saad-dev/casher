import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// POST /api/shift/close — Close the current shift session
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'shift.close')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق الوردية' }, { status: 403 });
    }

    const body = await req.json();
    const shiftMoveID: number = body.shiftMoveID;
    if (!shiftMoveID) {
      return NextResponse.json({ error: 'Missing shiftMoveID' }, { status: 400 });
    }

    const db = await getPool();

    // Verify shift exists and is open
    const shiftResult = await db.request()
      .input('id', sql.Int, shiftMoveID)
      .query(`SELECT ID, UserID, Status FROM [dbo].[TblShiftMove] WHERE ID = @id`);

    if (shiftResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 });
    }
    const shift = shiftResult.recordset[0];
    if (!shift.Status) {
      return NextResponse.json({ error: 'الوردية مغلقة بالفعل' }, { status: 400 });
    }

    // Format end time
    const now = new Date();
    const hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const endTime = `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${ampm}`;

    // Close the shift
    await db.request()
      .input('id', sql.Int, shiftMoveID)
      .input('endDate', sql.Date, new Date())
      .input('endTime', sql.NVarChar(50), endTime)
      .query(`
        UPDATE [dbo].[TblShiftMove]
        SET Status = 0, EndDate = @endDate, EndTime = @endTime
        WHERE ID = @id
      `);

    console.log(`[shift] Closed shift: ID=${shiftMoveID}, EndTime=${endTime}, by ${user.UserName}`);

    return NextResponse.json({ ok: true, shiftMoveID });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/close] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
