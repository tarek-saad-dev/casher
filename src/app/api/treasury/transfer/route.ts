import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { executeTreasuryTransfer, getPaymentMethodBalance } from '@/lib/actions/treasuryActions';

// POST /api/treasury/transfer — Transfer amount between payment methods
// Body: { amount: number, fromPaymentMethodId: number, toPaymentMethodId: number, notes?: string, transferDate?: string }
// If transferDate is provided, creates transfer for that date (past date support)
// If no transferDate, enforces active business day and shift
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const body = await req.json();
    const {
      transferDate,
      amount,
      fromPaymentMethodId,
      toPaymentMethodId,
      notes,
    } = body;

    // Validation
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "المبلغ يجب أن يكون أكبر من صفر" },
        { status: 400 },
      );
    }
    if (!fromPaymentMethodId) {
      return NextResponse.json(
        { error: "طريقة الدفع المصدر مطلوبة" },
        { status: 400 },
      );
    }
    if (!toPaymentMethodId) {
      return NextResponse.json(
        { error: "طريقة الدفع الهدف مطلوبة" },
        { status: 400 },
      );
    }
    if (fromPaymentMethodId === toPaymentMethodId) {
      return NextResponse.json(
        { error: "يجب اختيار طرق دفع مختلفة" },
        { status: 400 },
      );
    }

    const result = await executeAuditedAction({
      actionType: 'treasury_transfer',
      user: session,
      entityId: null,
      request: req,
      actionMethod: 'TRANSFER',
      endpointPath: '/api/treasury/transfer',
      reason: notes || null,
      loadOldData: async (transaction) => {
        const [fromBalance, toBalance] = await Promise.all([
          getPaymentMethodBalance(transaction, fromPaymentMethodId),
          getPaymentMethodBalance(transaction, toPaymentMethodId),
        ]);
        return {
          fromPaymentMethodId,
          toPaymentMethodId,
          fromBalanceBefore: fromBalance,
          toBalanceBefore: toBalance,
        };
      },
      execute: async (transaction) => executeTreasuryTransfer(transaction, {
        amount: Number(amount),
        fromPaymentMethodId,
        toPaymentMethodId,
        notes,
        transferDate,
        userId: session.UserID,
      }),
      loadNewData: async (transaction, result) => {
        const [fromBalance, toBalance] = await Promise.all([
          getPaymentMethodBalance(transaction, result.fromPaymentMethodId),
          getPaymentMethodBalance(transaction, result.toPaymentMethodId),
        ]);
        return {
          fromPaymentMethodId: result.fromPaymentMethodId,
          toPaymentMethodId: result.toPaymentMethodId,
          fromBalanceAfter: fromBalance,
          toBalanceAfter: toBalance,
          expenseId: result.expenseId,
          incomeId: result.incomeId,
          expenseInvID: result.expenseInvID,
          incomeInvID: result.incomeInvID,
          amount: result.amount,
          notes: result.notes,
          transferDate: result.transferDate,
          shiftMoveId: result.shiftMoveId,
        };
      },
    });

    return NextResponse.json({
      success: true,
      message: 'تم التحويل بنجاح',
      auditId: result.auditId,
      ...result.data,
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json(
        { error: err.message, auditId: err.failedAuditId },
        { status: 500 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/treasury/transfer] POST error:", message);
    return NextResponse.json(
      { error: "فشل التحويل: " + message },
      { status: 500 },
    );
  }
}
