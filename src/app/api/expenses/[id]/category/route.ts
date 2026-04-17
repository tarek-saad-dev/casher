import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// DELETE /api/expenses/[id]/category — Delete expense transaction
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const expenseId = parseInt(id);
    if (isNaN(expenseId)) {
      return NextResponse.json({ error: 'معرف المصروف غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Verify expense exists and is an expense transaction
    const expenseCheck = await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        SELECT ID, invType, inOut, invID
        FROM [dbo].[TblCashMove]
        WHERE ID = @id
      `);

    if (expenseCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
    }

    const expense = expenseCheck.recordset[0];
    if (expense.invType !== 'مصروفات' || expense.inOut !== 'out') {
      return NextResponse.json({ error: 'هذه المعاملة ليست مصروف' }, { status: 400 });
    }

    // Delete the expense
    await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        DELETE FROM [dbo].[TblCashMove]
        WHERE ID = @id
      `);

    return NextResponse.json({
      success: true,
      message: 'تم حذف المصروف بنجاح',
      deletedId: expenseId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]/category] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/expenses/[id]/category — Update expense category while preserving original date
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const expenseId = parseInt(id);
    if (isNaN(expenseId)) {
      return NextResponse.json({ error: 'معرف المصروف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { ExpINID } = body;

    if (!ExpINID) {
      return NextResponse.json({ error: 'يجب تحديد الفئة الجديدة' }, { status: 400 });
    }

    const db = await getPool();

    // Verify expense exists and is an expense transaction
    const expenseCheck = await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        SELECT ID, invType, inOut, invDate
        FROM [dbo].[TblCashMove]
        WHERE ID = @id
      `);

    if (expenseCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
    }

    const expense = expenseCheck.recordset[0];
    if (expense.invType !== 'مصروفات' || expense.inOut !== 'out') {
      return NextResponse.json({ error: 'هذه المعاملة ليست مصروف' }, { status: 400 });
    }

    // Verify new category exists and is an expense category
    const categoryCheck = await db.request()
      .input('expinid', sql.Int, ExpINID)
      .query(`
        SELECT ExpINID, CatName, ExpINType
        FROM [dbo].[TblExpINCat]
        WHERE ExpINID = @expinid AND ExpINType = N'مصروفات'
      `);

    if (categoryCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة المحددة غير موجودة أو ليست فئة مصروفات' }, { status: 400 });
    }

    // Update the expense category (preserve all other fields including date)
    await db.request()
      .input('id', sql.Int, expenseId)
      .input('expinid', sql.Int, ExpINID)
      .query(`
        UPDATE [dbo].[TblCashMove]
        SET ExpINID = @expinid
        WHERE ID = @id
      `);

    return NextResponse.json({
      success: true,
      message: 'تم تحديث تصنيف المصروف بنجاح',
      expense: {
        ID: expenseId,
        ExpINID: ExpINID,
        CatName: categoryCheck.recordset[0].CatName,
        invDate: expense.invDate,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]/category] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
