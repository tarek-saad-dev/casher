import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/barbers — sorted by sales count (most popular first)
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT 
        e.EmpID, 
        e.EmpName,
        ISNULL(sales.SalesCount, 0) AS SalesCount
      FROM [dbo].[TblEmp] e
      LEFT JOIN (
        SELECT EmpID, COUNT(*) AS SalesCount
        FROM [dbo].[TblinvServDetail]
        GROUP BY EmpID
      ) sales ON e.EmpID = sales.EmpID
      WHERE e.isActive = 1
      ORDER BY ISNULL(sales.SalesCount, 0) DESC, e.EmpName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/barbers] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
