import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/day/history — Get last 15 business days
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT TOP 15
        d.ID, d.NewDay, d.Status,
        (SELECT COUNT(*) FROM [dbo].[TblShiftMove] WHERE NewDay = d.NewDay) AS shiftsCount,
        (SELECT COUNT(*) FROM [dbo].[TblinvServHead] WHERE invDate = d.NewDay AND invType = N'مبيعات') AS salesCount,
        (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead] WHERE invDate = d.NewDay AND invType = N'مبيعات') AS totalRevenue
      FROM [dbo].[TblNewDay] d
      ORDER BY d.ID DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/history] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
