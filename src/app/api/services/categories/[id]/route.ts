import { NextResponse, NextRequest } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { ensureTblCatSortOrderColumn } from '@/lib/migrations/ensureCategorySortOrder';
import { authenticate, isAuthResult } from '@/lib/api-auth';

export const runtime = 'nodejs';

// PUT /api/services/categories/[id] — update a category (name and/or sortOrder)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const categoryId = parseInt(id);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'معرف الفئة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { CatName, SortOrder } = body;

    if (CatName !== undefined && (!CatName || !String(CatName).trim())) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const db = await getPool();
    const hasSortOrder = await ensureTblCatSortOrderColumn(db);

    const sets: string[] = [];
    const request = db.request()
      .input('CatID', categoryId)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId);

    if (CatName !== undefined) {
      sets.push('CatName = @CatName');
      request.input('CatName', String(CatName).trim());
    }

    if (SortOrder !== undefined && hasSortOrder) {
      if (typeof SortOrder !== 'number' || !Number.isFinite(SortOrder)) {
        return NextResponse.json({ error: 'SortOrder غير صالح' }, { status: 400 });
      }
      sets.push('SortOrder = @SortOrder');
      request.input('SortOrder', Math.trunc(SortOrder));
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'لا توجد حقول للتحديث' }, { status: 400 });
    }

    const outputCols = hasSortOrder
      ? 'INSERTED.CatID, INSERTED.CatName, INSERTED.SortOrder'
      : 'INSERTED.CatID, INSERTED.CatName';

    const result = await request.query(`
      UPDATE [dbo].[TblCat]
      SET ${sets.join(', ')}
      OUTPUT ${outputCols}
      WHERE CatID = @CatID AND TenantId = @tenantId;
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة غير موجودة' }, { status: 404 });
    }

    const updatedCategory = result.recordset[0];

    const serviceCountResult = await db
      .request()
      .input('CatID', categoryId)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT COUNT(*) AS ServiceCount
        FROM [dbo].[TblPro]
        WHERE CatID = @CatID AND TenantId = @tenantId AND isDeleted = 0
      `);

    return NextResponse.json({
      CatID: updatedCategory.CatID,
      CatName: updatedCategory.CatName,
      SortOrder: hasSortOrder ? Number(updatedCategory.SortOrder) || 0 : 0,
      ServiceCount: serviceCountResult.recordset[0].ServiceCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories/[id]] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/services/categories/[id] — delete a category
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const categoryId = parseInt(id);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'معرف الفئة غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    const categoryResult = await db
      .request()
      .input('CatID', categoryId)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .query(`SELECT CatID FROM [dbo].[TblCat] WHERE CatID = @CatID AND TenantId = @tenantId`);

    if (categoryResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة غير موجودة' }, { status: 404 });
    }

    const transaction = new sql.Transaction(db);
    await transaction.begin();
    try {
      await new sql.Request(transaction)
        .input('CatID', sql.Int, categoryId)
        .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
        .query(`
          UPDATE [dbo].[TblPro]
          SET CatID = NULL
          WHERE CatID = @CatID AND TenantId = @tenantId;

          DELETE FROM [dbo].[TblCat] WHERE CatID = @CatID AND TenantId = @tenantId;
        `);
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
