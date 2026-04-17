import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/shifts/current
export async function GET() {
  try {
    const db = await getPool();

    // Level 1: latest open shift for today
    let result = await db.request().query(`
      SELECT TOP 1 ID, Status, NewDay
      FROM [dbo].[TblShiftMove]
      WHERE Status = 1 AND CAST(NewDay AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'open_today' });
    }

    // Level 2: latest closed shift for today
    result = await db.request().query(`
      SELECT TOP 1 ID, Status, NewDay
      FROM [dbo].[TblShiftMove]
      WHERE Status = 0 AND CAST(NewDay AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'closed_today' });
    }

    // Level 3: latest still-open shift regardless of date
    result = await db.request().query(`
      SELECT TOP 1 ID, Status, NewDay
      FROM [dbo].[TblShiftMove]
      WHERE Status = 1 AND EndDate IS NULL
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'open_any' });
    }

    return NextResponse.json({ error: 'لا توجد وردية مفتوحة' }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shifts/current] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
