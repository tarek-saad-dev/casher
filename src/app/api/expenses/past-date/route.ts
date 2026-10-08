import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { withUnitOfWork } from '@/platform/public';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import { buildTreasuryWritePorts } from '@/lib/treasuryComposition';
import { createExpenseThroughTreasury } from '@/apps/treasury/application/createExpense';
import { getSession } from "@/lib/session";
import { requireRole, isAuthResult } from '@/lib/api-auth';
import { randomUUID } from 'crypto';
import {
  EmployeeLedgerDualWriteError,
  formatLedgerEntryDate,
  maybeSyncAdvanceLedgerForExpenseCashMove,
} from '@/lib/services/employeeLedgerDualWrite';
import {
  maybeScheduleAdvanceWhatsAppFromExpenseCategory,
} from '@/lib/services/employeeAdvanceWhatsAppNotify';

// POST /api/expenses/past-date - Add expense for past dates
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startTime = Date.now();
  const log = (step: string, data?: unknown) => {
    console.info('[expenses/past-date]', {
      requestId,
      step,
      elapsedMs: Date.now() - startTime,
      ...(data ? { data } : {}),
    });
  };

  const auth = await requireRole(['admin', 'manager', 'accountant']);
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session) {
      log('auth-failed');
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    const body = await req.json();
    const { invDate, invTime, amount, expINID, paymentMethodId, notes } = body;
    log('request-received', { invDate, amount, expINID, paymentMethodId });

    // Validation (read-only, before transaction)
    if (!invDate) {
      log('validation-failed', { field: 'invDate' });
      return NextResponse.json({ error: "التاريخ مطلوب" }, { status: 400 });
    }
    if (!amount || Number(amount) <= 0) {
      log('validation-failed', { field: 'amount' });
      return NextResponse.json(
        { error: "قيمة المصروف يجب أن تكون أكبر من صفر" },
        { status: 400 },
      );
    }
    if (!expINID) {
      log('validation-failed', { field: 'expINID' });
      return NextResponse.json(
        { error: "يجب اختيار تصنيف المصروف" },
        { status: 400 },
      );
    }
    if (!paymentMethodId) {
      log('validation-failed', { field: 'paymentMethodId' });
      return NextResponse.json(
        { error: "يجب اختيار طريقة الدفع" },
        { status: 400 },
      );
    }

    // Validate that the date is in the past or today
    const inputDate = new Date(invDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (inputDate > today) {
      log('validation-failed', { field: 'invDate', reason: 'future date' });
      return NextResponse.json(
        { error: "لا يمكن إضافة مصروف لتاريخ في المستقبل" },
        { status: 400 },
      );
    }

    // ──── Enforce active branch + matching business day for this date (Phase 1D) ────
    // Never trust browser branchId — ownership comes only from validated session context.
    // Does NOT attach to the open day and does NOT auto-create a day for this date.
    const { requireBranchOperationAccess } = await import('@/lib/branch/context');
    const { resolveBranchDayForDate } = await import('@/lib/branch/operationalGates');
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveBranchDayForDate(branch.branchId, invDate);
    if (!dayResolution.ok) {
      log('rejected', { reason: 'no business day for date', invDate, branchId: branch.branchId });
      return dayResolution.response;
    }
    const { finalizeHistoricalFinancialWrite } = await import('@/lib/branch/financialOwnershipPolicy');
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, body);
    if (!historical.ok) return historical.response;
    const branchId = historical.ownership.branchId;
    const businessDayId = historical.ownership.businessDayId;

    const db = await getPool();
    log('db-connected');

    // Validate category BEFORE transaction (read-only)
    log('before-category-lookup');
    const catResult = await db.request()
      .input('expINID', sql.Int, expINID)
      .query(`
        SELECT ExpINID, CatName FROM [dbo].[TblExpINCat]
        WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
      `);
    log('after-category-lookup');
    if (catResult.recordset.length === 0) {
      log('rejected', { reason: 'invalid expense category' });
      return NextResponse.json({ error: "فئة المصروف غير صالحة" }, { status: 400 });
    }
    const catName = catResult.recordset[0].CatName;

    const finalAmount = Math.max(0, Number(amount));
    const finalInvTime = invTime || '12:00';
    const notesText = notes?.trim() || catName;
    const actor = await buildStaffActorContext(session.UserID, session.TenantId);
    const treasuryPorts = await buildTreasuryWritePorts(actor);
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `expense.past:${branchId}:${requestId}`;

    try {
      const created = await withUnitOfWork(async ({ transaction }) => {
        const result = await createExpenseThroughTreasury(transaction, treasuryPorts, {
          locationId: branchId,
          amount: finalAmount,
          categoryId: expINID,
          paymentMethodId,
          notes: notesText,
          idempotencyKey,
          invTime: finalInvTime,
          historical: {
            businessDayId,
            businessDate: String(invDate).slice(0, 10),
            shiftInstanceId: historical.ownership.shiftMoveId,
          },
        });

        const ledgerResult = await maybeSyncAdvanceLedgerForExpenseCashMove(db, transaction, {
          cashMoveId: result.cashMoveId,
          expINID,
          entryDate: formatLedgerEntryDate(invDate),
          amount: finalAmount,
          createdByUserId: session.UserID,
        });

        const rowRes = await new sql.Request(transaction)
          .input('id', sql.Int, result.cashMoveId)
          .query(`
            SELECT ID, invID, invDate, invTime, ExpINID, GrandTolal AS Amount, Notes
            FROM dbo.TblCashMove WHERE ID = @id
          `);

        return {
          newRecord: rowRes.recordset[0],
          ledgerResult,
          idempotentReplay: result.idempotentReplay,
        };
      });

      const newRecord = created.newRecord;
      const ledgerResult = created.ledgerResult;
      log('after-commit');

      const advanceWa = await maybeScheduleAdvanceWhatsAppFromExpenseCategory({
        expINID,
        invID: newRecord.invID,
        amount: finalAmount,
        paymentMethodId,
        notes: notesText,
      });

      return NextResponse.json({
        success: true,
        message: "تم إضافة المصروف للتاريخ المحدد بنجاح",
        ledgerDualWrite: ledgerResult.ledgerDualWrite,
        ledgerSync: ledgerResult.outcome ?? null,
        advanceWhatsApp: advanceWa.scheduled,
        idempotentReplay: created.idempotentReplay,
        data: {
          ID: newRecord.ID,
          invID: newRecord.invID,
          invDate: newRecord.invDate,
          invTime: newRecord.invTime,
          ExpINID: newRecord.ExpINID,
          Amount: newRecord.Amount,
          Notes: newRecord.Notes,
          CategoryName: catName,
          duplicate: created.idempotentReplay,
        },
      }, { status: created.idempotentReplay ? 200 : 201 });
    } catch (error) {
      if (error instanceof EmployeeLedgerDualWriteError) {
        log('ledger-dual-write-error', { error: error.message });
        return NextResponse.json(
          { error: error.message, requestId },
          { status: 503 },
        );
      }
      log('transaction-error', {
        error: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        number: (error as any)?.number,
      });

      const errCode = (error as any)?.code;
      const errStatus = (error as any)?.statusCode;
      const errNumber = (error as any)?.number;
      if (errCode === 'TREASURY_BUSY' || errStatus === 503) {
        return NextResponse.json(
          { success: false, code: 'TREASURY_BUSY', message: (error as Error).message, requestId },
          { status: 503 }
        );
      }
      if (errNumber === 1222 || errNumber === 1205) {
        return NextResponse.json(
          { success: false, code: errNumber === 1205 ? 'DEADLOCK' : 'LOCK_TIMEOUT', message: 'الخزينة مشغولة بعملية أخرى حاليًا. حاول مرة أخرى بعد لحظات.', requestId },
          { status: 503 }
        );
      }
      throw error;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/expenses/past-date] POST error:", message);
    return NextResponse.json(
      { error: "فشل إضافة المصروف: " + message, requestId },
      { status: 500 },
    );
  }
}
