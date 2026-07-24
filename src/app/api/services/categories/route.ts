import { NextResponse, NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import {
  ensureTblCatSortOrderColumn,
  tblCatSortOrderSelect,
} from '@/lib/migrations/ensureCategorySortOrder';

export const runtime = 'nodejs';

// GET /api/services/categories — returns all categories with service counts + sortOrder
export async function GET() {
  try {
    const db = await getPool();
    const hasSortOrder = await ensureTblCatSortOrderColumn(db);
    const sortOrderCol = tblCatSortOrderSelect(hasSortOrder);
    const orderBy = hasSortOrder
      ? 'ISNULL(c.SortOrder, 999999), c.CatName'
      : 'c.CatName';

    const result = await db.request().query(`
      SELECT
        c.CatID,
        c.CatName,
        ${sortOrderCol},
        ISNULL(p.ServiceCount, 0) AS ServiceCount
      FROM [dbo].[TblCat] c
      LEFT JOIN (
        SELECT CatID, COUNT(*) AS ServiceCount
        FROM [dbo].[TblPro]
        WHERE isDeleted = 0
        GROUP BY CatID
      ) p ON c.CatID = p.CatID
      ORDER BY ${orderBy}
    `);

    return NextResponse.json(
      result.recordset.map((r: Record<string, unknown>) => ({
        CatID: r.CatID,
        CatName: r.CatName,
        SortOrder: Number(r.SortOrder) || 0,
        ServiceCount: Number(r.ServiceCount) || 0,
      })),
    );
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
    const { CatName, SortOrder } = body;

    if (!CatName || !CatName.trim()) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const db = await getPool();
    const hasSortOrder = await ensureTblCatSortOrderColumn(db);

    let nextOrder = 0;
    if (typeof SortOrder === 'number' && Number.isFinite(SortOrder)) {
      nextOrder = Math.trunc(SortOrder);
    } else if (hasSortOrder) {
      const maxRes = await db.request().query(`
        SELECT ISNULL(MAX(SortOrder), 0) AS MaxOrder FROM [dbo].[TblCat]
      `);
      nextOrder = (Number(maxRes.recordset[0]?.MaxOrder) || 0) + 10;
    }

    if (hasSortOrder) {
      const result = await db
        .request()
        .input('CatName', CatName.trim())
        .input('SortOrder', nextOrder)
        .query(`
          INSERT INTO [dbo].[TblCat] (CatName, SortOrder)
          OUTPUT INSERTED.CatID, INSERTED.CatName, INSERTED.SortOrder
          VALUES (@CatName, @SortOrder);
        `);

      const newCategory = result.recordset[0];
      return NextResponse.json({
        CatID: newCategory.CatID,
        CatName: newCategory.CatName,
        SortOrder: Number(newCategory.SortOrder) || nextOrder,
        ServiceCount: 0,
      });
    }

    const result = await db
      .request()
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
      SortOrder: 0,
      ServiceCount: 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
