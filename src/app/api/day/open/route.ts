import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

// POST /api/day/open — Open a new business day
export async function POST() {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية فتح يوم عمل' }, { status: 403 });
    }

    const db = await getPool();

    // Check no open day exists
    const existing = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1
    `);
    if (existing.recordset.length > 0) {
      const d = existing.recordset[0];
      return NextResponse.json(
        { error: `يوجد يوم عمل مفتوح بالفعل (${new Date(d.NewDay).toLocaleDateString('ar-EG')}) — يجب إغلاقه أولاً` },
        { status: 400 }
      );
    }

    // Insert new day
    const result = await db.request().query(`
      INSERT INTO [dbo].[TblNewDay] (NewDay, Status)
      OUTPUT INSERTED.ID, INSERTED.NewDay, INSERTED.Status
      VALUES (CAST(GETDATE() AS DATE), 1)
    `);

    const newDay = result.recordset[0];
    console.log(`[day] Opened new day: ID=${newDay.ID}, NewDay=${newDay.NewDay}, by ${user.UserName}`);

    return NextResponse.json({ day: newDay }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
