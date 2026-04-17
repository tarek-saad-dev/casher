import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/services — returns services grouped by category, sorted by popularity
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT
        p.ProID, p.ProName, p.SPrice1, p.Bonus,
        p.CatID, c.CatName,
        ISNULL(pop.SalesCount, 0) AS SalesCount
      FROM [dbo].[TblPro] p
      LEFT JOIN [dbo].[TblCat] c ON p.CatID = c.CatID
      LEFT JOIN (
        SELECT ProID, COUNT(*) AS SalesCount
        FROM [dbo].[TblinvServDetail]
        GROUP BY ProID
      ) pop ON p.ProID = pop.ProID
      WHERE p.isDeleted = 0
      ORDER BY p.CatID, ISNULL(pop.SalesCount, 0) DESC, p.ProName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
