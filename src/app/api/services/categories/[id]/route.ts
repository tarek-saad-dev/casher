import { NextResponse, NextRequest } from 'next/server';
import { getPool } from '@/lib/db';

// PUT /api/services/categories/[id] — update a category
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id);
    
    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'معرف الفئة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { CatName } = body;

    if (!CatName || !CatName.trim()) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('CatID', categoryId)
      .input('CatName', CatName.trim())
      .query(`
        UPDATE [dbo].[TblCat]
        SET CatName = @CatName
        OUTPUT INSERTED.CatID, INSERTED.CatName
        WHERE CatID = @CatID;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة غير موجودة' }, { status: 404 });
    }

    const updatedCategory = result.recordset[0];

    const serviceCountResult = await db.request()
      .input('CatID', categoryId)
      .query(`
        SELECT COUNT(*) AS ServiceCount
        FROM [dbo].[TblPro]
        WHERE CatID = @CatID AND isDeleted = 0
      `);

    return NextResponse.json({
      CatID: updatedCategory.CatID,
      CatName: updatedCategory.CatName,
      ServiceCount: serviceCountResult.recordset[0].ServiceCount
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id);
    
    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'معرف الفئة غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Check if category exists
    const categoryResult = await db.request()
      .input('CatID', categoryId)
      .query(`SELECT CatID FROM [dbo].[TblCat] WHERE CatID = @CatID`);

    if (categoryResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة غير موجودة' }, { status: 404 });
    }

    // Remove category from all services (set to null)
    await db.request()
      .input('CatID', categoryId)
      .query(`
        UPDATE [dbo].[TblPro]
        SET CatID = NULL
        WHERE CatID = @CatID
      `);

    // Delete the category
    await db.request()
      .input('CatID', categoryId)
      .query(`DELETE FROM [dbo].[TblCat] WHERE CatID = @CatID`);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/categories/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
