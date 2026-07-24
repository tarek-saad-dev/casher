import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { ensureTblCatSortOrderColumn } from '@/lib/migrations/ensureCategorySortOrder';

export const runtime = 'nodejs';

/**
 * PUT /api/services/categories/reorder
 * Body: { categoryIds: number[] } — full ordered list (first = display first).
 * Assigns SortOrder = 10, 20, 30, ...
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const categoryIds = body?.categoryIds;

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'categoryIds مطلوب (مصفوفة غير فارغة)' },
        { status: 400 },
      );
    }

    const ids: number[] = [];
    for (const raw of categoryIds) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { ok: false, error: 'معرف فئة غير صالح في categoryIds' },
          { status: 400 },
        );
      }
      ids.push(Math.trunc(n));
    }

    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { ok: false, error: 'categoryIds يحتوي على تكرار' },
        { status: 400 },
      );
    }

    const db = await getPool();
    const hasSortOrder = await ensureTblCatSortOrderColumn(db);
    if (!hasSortOrder) {
      return NextResponse.json(
        { ok: false, error: 'عمود SortOrder غير متوفر' },
        { status: 503 },
      );
    }

    const existing = await db.request().query(`SELECT CatID FROM [dbo].[TblCat]`);
    const existingIds = new Set(
      existing.recordset.map((r: { CatID: number }) => Number(r.CatID)),
    );

    for (const id of ids) {
      if (!existingIds.has(id)) {
        return NextResponse.json(
          { ok: false, error: `الفئة ${id} غير موجودة` },
          { status: 404 },
        );
      }
    }

    const transaction = new sql.Transaction(db);
    await transaction.begin();
    try {
      for (let i = 0; i < ids.length; i++) {
        const sortOrder = (i + 1) * 10;
        await new sql.Request(transaction)
          .input('CatID', sql.Int, ids[i])
          .input('SortOrder', sql.Int, sortOrder)
          .query(`
            UPDATE [dbo].[TblCat]
            SET SortOrder = @SortOrder
            WHERE CatID = @CatID
          `);
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    const result = await db.request().query(`
      SELECT
        c.CatID,
        c.CatName,
        c.SortOrder,
        ISNULL(p.ServiceCount, 0) AS ServiceCount
      FROM [dbo].[TblCat] c
      LEFT JOIN (
        SELECT CatID, COUNT(*) AS ServiceCount
        FROM [dbo].[TblPro]
        WHERE isDeleted = 0
        GROUP BY CatID
      ) p ON c.CatID = p.CatID
      ORDER BY c.SortOrder, c.CatName
    `);

    return NextResponse.json({
      ok: true,
      categories: result.recordset.map((r: Record<string, unknown>) => ({
        CatID: r.CatID,
        CatName: r.CatName,
        SortOrder: Number(r.SortOrder) || 0,
        ServiceCount: Number(r.ServiceCount) || 0,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories/reorder] PUT error:', message);
    return NextResponse.json(
      { ok: false, error: 'فشل حفظ ترتيب الفئات' },
      { status: 500 },
    );
  }
}
