import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * PUT /api/expenses/[id]
 * Update an existing expense while preserving original date
 * Tracks edit history with timestamps
 */
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
    const { expINID, grandTotal, paymentMethodId, notes } = body;

    // Validation
    if (!expINID || !grandTotal || !paymentMethodId) {
      return NextResponse.json(
        { error: 'يجب إدخال جميع البيانات المطلوبة' },
        { status: 400 }
      );
    }

    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const db = await getPool();

    // Get current expense data
    const currentExpense = await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        SELECT 
          cm.ExpINID,
          cm.GrandTolal,
          cm.PaymentMethodID,
          cm.Notes,
          cm.EditHistory,
          cm.invDate
        FROM [dbo].[TblCashMove] cm
        WHERE cm.ID = @id AND cm.invType = N'مصروفات'
      `);

    if (currentExpense.recordset.length === 0) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
    }

    const current = currentExpense.recordset[0];
    
    // Build edit history entry
    const editEntry = {
      editedAt: new Date().toISOString(),
      editedBy: user.UserName,
      userId: user.UserID,
      changes: {
        expINID: { old: current.ExpINID, new: expINID },
        grandTotal: { old: current.GrandTolal, new: grandTotal },
        paymentMethodId: { old: current.PaymentMethodID, new: paymentMethodId },
        notes: { old: current.Notes, new: notes }
      }
    };

    // Parse existing history or create new array
    let editHistory: any[] = [];
    if (current.EditHistory) {
      try {
        editHistory = JSON.parse(current.EditHistory);
      } catch (e) {
        console.error('Failed to parse EditHistory:', e);
        editHistory = [];
      }
    }

    // Add new edit entry
    editHistory.push(editEntry);
    const editHistoryJson = JSON.stringify(editHistory);

    // Update the expense (preserve invDate)
    await db.request()
      .input('id', sql.Int, expenseId)
      .input('expINID', sql.Int, expINID)
      .input('grandTotal', sql.Decimal(10, 2), grandTotal)
      .input('paymentMethodId', sql.Int, paymentMethodId)
      .input('notes', sql.NVarChar(sql.MAX), notes || null)
      .input('editHistory', sql.NVarChar(sql.MAX), editHistoryJson)
      .query(`
        UPDATE [dbo].[TblCashMove]
        SET 
          ExpINID = @expINID,
          GrandTolal = @grandTotal,
          PaymentMethodID = @paymentMethodId,
          Notes = @notes,
          EditHistory = @editHistory
        WHERE ID = @id
      `);

    console.log(`[expenses] Updated expense ID=${expenseId} by ${user.UserName}`);

    return NextResponse.json({
      success: true,
      message: 'تم تحديث المصروف بنجاح',
      editHistory: editHistory
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/expenses/[id]
 * Delete an expense record
 */
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

    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const db = await getPool();

    // Check if expense exists
    const expense = await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        SELECT ID FROM [dbo].[TblCashMove]
        WHERE ID = @id AND invType = N'مصروفات'
      `);

    if (expense.recordset.length === 0) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
    }

    // Delete the expense
    await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        DELETE FROM [dbo].[TblCashMove]
        WHERE ID = @id
      `);

    console.log(`[expenses] Deleted expense ID=${expenseId} by ${user.UserName}`);

    return NextResponse.json({
      success: true,
      message: 'تم حذف المصروف بنجاح'
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/expenses/[id]
 * Get expense details with edit history
 */
export async function GET(
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

    const result = await db.request()
      .input('id', sql.Int, expenseId)
      .query(`
        SELECT
          cm.ID,
          cm.invID,
          cm.invDate,
          cm.invTime,
          cm.ExpINID,
          cat.CatName,
          cm.GrandTolal,
          cm.Notes,
          cm.PaymentMethodID,
          pm.PaymentMethod,
          cm.EditHistory,
          cm.ShiftMoveID,
          u.UserName
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
        LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        WHERE cm.ID = @id AND cm.invType = N'مصروفات'
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'المصروف غير موجود' }, { status: 404 });
    }

    const expense = result.recordset[0];
    
    // Parse edit history
    let editHistory = [];
    if (expense.EditHistory) {
      try {
        editHistory = JSON.parse(expense.EditHistory);
      } catch (e) {
        console.error('Failed to parse EditHistory:', e);
      }
    }

    return NextResponse.json({
      ...expense,
      EditHistory: editHistory
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
