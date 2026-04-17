import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/day — Get current open business day
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT TOP 1 ID, NewDay, Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    if (result.recordset.length === 0) {
      return NextResponse.json({ day: null });
    }
    return NextResponse.json({ day: result.recordset[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
