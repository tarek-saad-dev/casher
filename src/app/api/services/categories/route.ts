import { NextResponse, NextRequest } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/services/categories — returns all categories with service counts
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT 
        c.CatID, 
        c.CatName,
        ISNULL(p.ServiceCount, 0) AS ServiceCount
      FROM [dbo].[TblCat] c
      LEFT JOIN (
        SELECT CatID, COUNT(*) AS ServiceCount
        FROM [dbo].[TblPro]
        WHERE isDeleted = 0
        GROUP BY CatID
      ) p ON c.CatID = p.CatID
      ORDER BY c.CatName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/services/categories — create a new category
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { CatName } = body;

    if (!CatName || !CatName.trim()) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('CatName', CatName.trim())
      .query(`
        INSERT INTO [dbo].[TblCat] (CatName)
        OUTPUT INSERTED.CatID, INSERTED.CatName
        VALUES (@CatName);
      `);

    const newCategory = result.recordset[0];
    return NextResponse.json({
      CatID: newCategory.CatID,
      CatName: newCategory.CatName,
      ServiceCount: 0
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
