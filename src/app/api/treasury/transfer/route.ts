import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { executeTreasuryTransfer, getPaymentMethodBalance } from '@/lib/actions/treasuryActions';
import { randomUUID } from 'crypto';

const YYYY_MM_DD_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isMssqlError(err: unknown): err is { number?: number; state?: number; class?: number; lineNumber?: number; procName?: string; message: string } {
  return err instanceof Error && typeof (err as any).number === 'number';
}

function extractSqlErrorDetails(err: unknown): Record<string, unknown> {
  if (!isMssqlError(err)) return { message: err instanceof Error ? err.message : String(err) };
  return {
    message: err.message,
    number: err.number,
    state: err.state,
    class: err.class,
    lineNumber: err.lineNumber,
    procName: err.procName,
  };
}

// POST /api/treasury/transfer — Transfer amount between payment methods
// Body: { amount: number, fromPaymentMethodId: number, toPaymentMethodId: number, notes?: string, transferDate?: string }
// If transferDate is provided, creates transfer for that date (past date support)
// If no transferDate, enforces active business day and shift
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const log = (msg: string, data?: unknown) => {
    console.log(`[api/treasury/transfer:${requestId}] ${msg}`, data ?? '');
  };
  const logError = (msg: string, err: unknown) => {
    console.error(`[api/treasury/transfer:${requestId}] ${msg}`, extractSqlErrorDetails(err));
  };

  try {
    const session = await getSession();
    if (!session) {
      log('Unauthenticated request');
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    const body = await req.json();
    const {
      transferDate,
      amount,
      fromPaymentMethodId,
      toPaymentMethodId,
      notes,
    } = body;

    log('Received request body', {
      transferDate: transferDate ?? null,
      amount: amount ?? null,
      fromPaymentMethodId: fromPaymentMethodId ?? null,
      toPaymentMethodId: toPaymentMethodId ?? null,
      notes: notes?.slice(0, 200) ?? null,
    });

    // ─── Strict input validation ───
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || isNaN(parsedAmount) || parsedAmount <= 0) {
      log('Validation failed: invalid amount', { amount });
      return NextResponse.json(
        { error: 'المبلغ يجب أن يكون عدداً صحيحاً أكبر من صفر', requestId },
        { status: 400 },
      );
    }
    if (parsedAmount > 99999999.99) {
      log('Validation failed: amount exceeds decimal(10,2)', { parsedAmount });
      return NextResponse.json(
        { error: 'المبلغ يتجاوز الحد المسموح به', requestId },
        { status: 400 },
      );
    }
    const roundedAmount = Math.round(parsedAmount * 100) / 100;
    if (roundedAmount !== parsedAmount) {
      log('Validation failed: amount has more than 2 decimals', { parsedAmount });
      return NextResponse.json(
        { error: 'المبلغ يجب أن يحتوي على منزلتين عشريتين كحد أقصى', requestId },
        { status: 400 },
      );
    }

    const fromPmId = Number(fromPaymentMethodId);
    const toPmId = Number(toPaymentMethodId);
    if (!Number.isInteger(fromPmId) || fromPmId <= 0) {
      log('Validation failed: invalid fromPaymentMethodId', { fromPaymentMethodId });
      return NextResponse.json(
        { error: 'طريقة الدفع المصدر مطلوبة ويجب أن تكون رقماً صحيحاً موجباً', requestId },
        { status: 400 },
      );
    }
    if (!Number.isInteger(toPmId) || toPmId <= 0) {
      log('Validation failed: invalid toPaymentMethodId', { toPaymentMethodId });
      return NextResponse.json(
        { error: 'طريقة الدفع الهدف مطلوبة ويجب أن تكون رقماً صحيحاً موجباً', requestId },
        { status: 400 },
      );
    }
    if (fromPmId === toPmId) {
      log('Validation failed: same source and destination', { fromPmId, toPmId });
      return NextResponse.json(
        { error: 'يجب اختيار طرق دفع مختلفة', requestId },
        { status: 400 },
      );
    }

    if (transferDate) {
      if (!YYYY_MM_DD_REGEX.test(transferDate)) {
        log('Validation failed: transferDate not YYYY-MM-DD', { transferDate });
        return NextResponse.json(
          { error: 'تاريخ التحويل يجب أن يكون بالصيغة YYYY-MM-DD', requestId },
          { status: 400 },
        );
      }
      const [y, m, d] = transferDate.split('-').map(Number);
      const checkDate = new Date(y, m - 1, d);
      if (
        checkDate.getFullYear() !== y ||
        checkDate.getMonth() !== m - 1 ||
        checkDate.getDate() !== d
      ) {
        log('Validation failed: impossible date', { transferDate });
        return NextResponse.json(
          { error: 'تاريخ التحويل غير صالح', requestId },
          { status: 400 },
        );
      }
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (checkDate > today) {
        log('Validation failed: future date', { transferDate });
        return NextResponse.json(
          { error: 'لا يمكن التحويل لتاريخ في المستقبل', requestId },
          { status: 400 },
        );
      }
    }

    // ─── Pre-transaction payment method validation ───
    const db = await getPool();
    const pmCheck = await db.request()
      .input('fromPmId', sql.Int, fromPmId)
      .input('toPmId', sql.Int, toPmId)
      .query(`
        SELECT PaymentID, PaymentMethod FROM dbo.TblPaymentMethods
        WHERE PaymentID IN (@fromPmId, @toPmId)
      `);
    if (pmCheck.recordset.length !== 2) {
      log('Validation failed: payment method not found', {
        found: pmCheck.recordset.map((r) => r.PaymentID),
        requested: [fromPmId, toPmId],
      });
      return NextResponse.json(
        { error: 'إحدى طرق الدفع غير موجودة', requestId },
        { status: 404 },
      );
    }

    log('Validation passed', { parsedAmount: roundedAmount, fromPmId, toPmId, transferDate: transferDate ?? null });

    // ──── Never trust browser branchId — resolve ownership from gated session context ────
    const { requireBranchOperationAccess } = await import('@/lib/branch/context');
    let branchId: number;
    let businessDayId: number | null;
    let shiftMoveId: number | null = null;
    let resolvedInvDate: string | undefined;

    if (transferDate) {
      // Past-date transfer: branch comes from the session, day must already exist for that date.
      const { resolveBranchDayForDate } = await import('@/lib/branch/operationalGates');
      const branch = await requireBranchOperationAccess();
      if (branch instanceof NextResponse) return branch;
      const dayResolution = await resolveBranchDayForDate(branch.branchId, transferDate);
      if (!dayResolution.ok) {
        log('Validation failed: no business day for transferDate', { transferDate, branchId: branch.branchId });
        return dayResolution.response;
      }
      branchId = branch.branchId;
      businessDayId = dayResolution.day.id;
    } else {
      // Current-day transfer: branch, open day and open shift come from the gated write context.
      const { resolveBranchDayAndShiftForWrite } = await import('@/lib/branch/operationalGates');
      const gated = await resolveBranchDayAndShiftForWrite(session.UserID);
      if (!gated.ok) return gated.response;
      if (!gated.shift) {
        log('Validation failed: no open shift for current-day transfer', { userId: session.UserID });
        return NextResponse.json(
          { error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تنفيذ التحويل', requestId },
          { status: 400 },
        );
      }
      branchId = gated.branch.branchId;
      businessDayId = gated.day.id;
      shiftMoveId = gated.shift.id;
      resolvedInvDate = gated.day.newDay;
    }

    const result = await executeAuditedAction({
      actionType: 'treasury_transfer',
      user: session,
      entityId: null,
      request: req,
      actionMethod: 'TRANSFER',
      endpointPath: '/api/treasury/transfer',
      reason: notes || null,
      requestId,
      loadOldData: async (transaction) => {
        const balanceOpts = transferDate ? { asOfDate: transferDate } : undefined;
        log('loadOldData:from-balance:start', { fromPmId, asOfDate: transferDate ?? 'all-time' });
        const fromBalance = await getPaymentMethodBalance(transaction, fromPmId, balanceOpts);
        log('loadOldData:from-balance:complete', { fromBalance });
        log('loadOldData:to-balance:start', { toPmId });
        const toBalance = await getPaymentMethodBalance(transaction, toPmId, balanceOpts);
        log('loadOldData:to-balance:complete', { toBalance });
        log('Loaded pre-transfer balances', { fromBalance, toBalance, asOfDate: transferDate ?? 'all-time' });
        return {
          fromPaymentMethodId: fromPmId,
          toPaymentMethodId: toPmId,
          fromBalanceBefore: fromBalance,
          toBalanceBefore: toBalance,
        };
      },
      execute: async (transaction) => executeTreasuryTransfer(transaction, {
        amount: roundedAmount,
        fromPaymentMethodId: fromPmId,
        toPaymentMethodId: toPmId,
        notes,
        transferDate,
        invDate: resolvedInvDate,
        shiftMoveId,
        userId: session.UserID,
        requestId,
        branchId,
        businessDayId,
      }),
      loadNewData: async (transaction, result) => {
        const balanceOpts = transferDate ? { asOfDate: transferDate } : undefined;
        log('loadNewData:from-balance:start', { fromPmId: result.fromPaymentMethodId });
        const fromBalance = await getPaymentMethodBalance(transaction, result.fromPaymentMethodId, balanceOpts);
        log('loadNewData:from-balance:complete', { fromBalance });
        log('loadNewData:to-balance:start', { toPmId: result.toPaymentMethodId });
        const toBalance = await getPaymentMethodBalance(transaction, result.toPaymentMethodId, balanceOpts);
        log('loadNewData:to-balance:complete', { toBalance });
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

    log('Transfer succeeded', { auditId: result.auditId });

    return NextResponse.json({
      success: true,
      message: 'تم التحويل بنجاح',
      auditId: result.auditId,
      requestId,
      ...result.data,
    });
  } catch (err: unknown) {
    logError('Unhandled error in transfer route', err);

    if (isAuditedActionError(err)) {
      return NextResponse.json(
        { error: err.message, auditId: err.failedAuditId, requestId },
        { status: err.statusCode || 500 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'فشل التحويل: ' + message, requestId },
      { status: 500 },
    );
  }
}
