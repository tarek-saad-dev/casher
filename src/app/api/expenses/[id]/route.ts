import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getExpenseSnapshot, updateExpense, deleteExpense } from '@/lib/actions/expenseActions';

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
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const auditResult = await executeAuditedAction({
      actionType: 'edit_expense',
      user,
      entityId: expenseId,
      request: req,
      actionMethod: 'PUT',
      endpointPath: `/api/expenses/${expenseId}`,
      reason: body.reason || notes || null,
      loadOldData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => updateExpense(transaction, expenseId, {
        expINID,
        grandTotal: Number(grandTotal),
        paymentMethodId,
        notes,
        editedByUserId: user.UserID,
        editedByUserName: user.UserName,
      }),
      loadNewData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تحديث المصروف بنجاح',
      auditId: auditResult.auditId,
      data: auditResult.data,
    });

  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
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
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const reason = body.reason || null;

    const auditResult = await executeAuditedAction({
      actionType: 'delete_expense',
      user,
      entityId: expenseId,
      request: req,
      actionMethod: 'DELETE',
      endpointPath: `/api/expenses/${expenseId}`,
      reason,
      loadOldData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => deleteExpense(transaction, expenseId),
      loadNewData: async () => null,
    });

    return NextResponse.json({ success: true, message: 'تم حذف المصروف', auditId: auditResult.auditId });

  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
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
