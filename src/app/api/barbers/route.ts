import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/barbers
 * Query:
 *   scope=service (default) — حلاق + مساعد (legacy POS/booking list)
 *   scope=barber — حلاق فقط
 *   scope=other — كل الموظفين النشطين ما عدا الحلاقين
 */
export async function GET(req: NextRequest) {
  try {
    const scope = (req.nextUrl.searchParams.get('scope') || 'service').toLowerCase();

    let jobFilter: string;
    if (scope === 'barber') {
      jobFilter = `(
        e.Job = N'حلاق'
        OR LOWER(LTRIM(RTRIM(ISNULL(e.Job, N'')))) IN (N'barber')
      )`;
    } else if (scope === 'other') {
      // مساعدين، إداريين، وأي وظيفة أخرى — باستثناء الحلاقين
      jobFilter = `(
        e.Job IS NULL
        OR (
          e.Job <> N'حلاق'
          AND LOWER(LTRIM(RTRIM(e.Job))) NOT IN (N'barber')
          AND e.Job NOT LIKE N'%حلاق%'
        )
      )`;
    } else {
      // service (default)
      jobFilter = `e.Job IN (N'حلاق', N'مساعد')`;
    }

    const db = await getPool();
    const result = await db.request().query(`
      SELECT 
        e.EmpID, 
        e.EmpName,
        e.Job,
        ISNULL(sales.SalesCount, 0) AS SalesCount
      FROM [dbo].[TblEmp] e
      LEFT JOIN (
        SELECT EmpID, COUNT(*) AS SalesCount
        FROM [dbo].[TblinvServDetail]
        GROUP BY EmpID
      ) sales ON e.EmpID = sales.EmpID
      WHERE e.isActive = 1
        AND ${jobFilter}
      ORDER BY ISNULL(sales.SalesCount, 0) DESC, e.EmpName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/barbers] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
