import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getExpenseSnapshot, deleteExpense, updateExpenseCategory } from '@/lib/actions/expenseActions';
import { cashMoveHardDeleteSuccessMessage } from '@/lib/services/cashMoveHardDeleteService';

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

    const user = await getSession();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'سبب حذف المصروف مطلوب' },
        { status: 400 }
      );
    }

    const auditResult = await executeAuditedAction({
      actionType: 'delete_expense',
      user,
      entityId: expenseId,
      request: req,
      actionMethod: 'DELETE',
      endpointPath: `/api/expenses/${expenseId}/category`,
      reason,
      loadOldData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => deleteExpense(transaction, expenseId),
      loadNewData: async () => null,
    });

    const ledgerDeletedCount = auditResult.data.ledgerDeletedCount;
    return NextResponse.json({
      success: true,
      message: cashMoveHardDeleteSuccessMessage(ledgerDeletedCount),
      ledgerDeletedCount,
      deletedId: expenseId,
      auditId: auditResult.auditId,
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      const isValidation = err.message.includes('تتطلب سبباً') || err.message.includes('مطلوب');
      return NextResponse.json(
        { success: false, error: err.message, auditId: err.failedAuditId },
        { status: isValidation ? 400 : 500 }
      );
    }
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

    const user = await getSession();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const body = await req.json();
    const { ExpINID, reason } = body;

    if (!ExpINID) {
      return NextResponse.json({ error: 'يجب تحديد الفئة الجديدة' }, { status: 400 });
    }

    const auditResult = await executeAuditedAction({
      actionType: 'edit_expense',
      user,
      entityId: expenseId,
      request: req,
      actionMethod: 'PUT',
      endpointPath: `/api/expenses/${expenseId}/category`,
      reason: reason || null,
      loadOldData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => updateExpenseCategory(transaction, expenseId, Number(ExpINID)),
      loadNewData: async (transaction) => getExpenseSnapshot(transaction, expenseId) as unknown as Record<string, unknown> | null,
    });

    const data = auditResult.data as { ExpINID: number; invDate?: string | Date } | undefined;

    return NextResponse.json({
      success: true,
      message: 'تم تحديث تصنيف المصروف بنجاح',
      updatedId: expenseId,
      auditId: auditResult.auditId,
      expense: {
        ID: expenseId,
        ExpINID: data?.ExpINID ?? Number(ExpINID),
        invDate: data?.invDate,
      },
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/[id]/category] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
