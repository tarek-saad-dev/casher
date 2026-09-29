import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { withUnitOfWork } from '@/platform/public';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import { buildTreasuryWritePorts } from '@/lib/treasuryComposition';
import { createExpenseThroughTreasury } from '@/apps/treasury/application/createExpense';
import { getSession } from '@/lib/session';
import type { CreateExpensePayload } from '@/lib/types';
import { randomUUID } from 'crypto';
import {
  EmployeeLedgerDualWriteError,
  formatLedgerEntryDate,
  maybeSyncAdvanceLedgerForExpenseCashMove,
} from '@/lib/services/employeeLedgerDualWrite';
import {
  maybeScheduleAdvanceWhatsAppFromExpenseCategory,
} from '@/lib/services/employeeAdvanceWhatsAppNotify';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';
import { branchErrorResponse } from '@/lib/branch/operationalGates';
import { liveCashMoveAndClause } from '@/lib/treasury/liveCashMoveSql';

// GET /api/expenses — List expenses with optional filters
export async function GET(req: NextRequest) {
  try {
    const { requireAuthenticatedBranchContext } = await import(
      '@/lib/branch/operationalGates'
    );
    const { isActiveBranchContext } = await import('@/lib/branch/context');
    const branch = await requireAuthenticatedBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    const url = new URL(req.url);
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const catId = url.searchParams.get('catId');
    const shiftId = url.searchParams.get('shiftId');
    const today = url.searchParams.get('today'); // "1" = today only
    const paymentMethodId = url.searchParams.get('paymentMethodId');

    // PHASE1D: never trust browser branchId — always filter by the session's active branch
    const liveClause = await liveCashMoveAndClause(db, 'cm');
    let whereClause = `WHERE cm.invType = N'مصروفات' AND cm.inOut = N'out' AND cm.BranchID = @branchId${liveClause}`;
    const request = db.request();
    request.input('branchId', sql.Int, branch.branchId);

    if (today === '1') {
      // Use the current open business day date for the active branch
      whereClause +=
        ' AND cm.invDate = (SELECT TOP 1 NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 AND BranchID = @branchId ORDER BY ID DESC)';
    } else {
      if (dateFrom) {
        whereClause += ' AND cm.invDate >= @dateFrom';
        request.input('dateFrom', sql.Date, dateFrom);
      }
      if (dateTo) {
        whereClause += ' AND cm.invDate <= @dateTo';
        request.input('dateTo', sql.Date, dateTo);
      }
    }

    if (catId) {
      whereClause += ' AND cm.ExpINID = @catId';
      request.input('catId', sql.Int, parseInt(catId));
    }

    if (shiftId) {
      whereClause += ' AND cm.ShiftMoveID = @shiftId';
      request.input('shiftId', sql.Int, parseInt(shiftId));
    }

    if (paymentMethodId && paymentMethodId !== 'all') {
      whereClause += ' AND cm.PaymentMethodID = @paymentMethodId';
      request.input('paymentMethodId', sql.Int, parseInt(paymentMethodId));
    }

    const result = await request.query(`
      SELECT
        cm.ID,
        cm.invID,
        cm.invDate,
        cm.invTime,
        cm.ExpINID,
        ISNULL(cat.CatName, N'—') AS CatName,
        cm.GrandTolal,
        cm.Notes,
        cm.ShiftMoveID,
        cm.PaymentMethodID,
        pm.PaymentMethod,
        u.UserName
      FROM [dbo].[TblCashMove] cm
      LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
      LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      ${whereClause}
      ORDER BY cm.ID DESC
    `);

    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/expenses — Create a new expense (single TblCashMove row)
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startTime = Date.now();
  const log = (step: string, data?: unknown) => {
    console.info('[expenses]', {
      requestId,
      step,
      elapsedMs: Date.now() - startTime,
      ...(data ? { data } : {}),
    });
  };

  try {
    const body: CreateExpensePayload = await req.json();
    log('request-received', { amount: body.amount, expINID: body.expINID, paymentMethodId: body.paymentMethodId });

    // ──── Validation (read-only, before transaction) ────
    if (!body.expINID || body.expINID <= 0) {
      log('validation-failed', { field: 'expINID', reason: 'missing or non-positive' });
      return NextResponse.json({ error: 'يجب اختيار فئة المصروف' }, { status: 400 });
    }
    if (!body.amount || body.amount <= 0) {
      log('validation-failed', { field: 'amount', reason: 'missing or non-positive' });
      return NextResponse.json({ error: 'يجب إدخال مبلغ صحيح أكبر من صفر' }, { status: 400 });
    }
    if (!body.paymentMethodId) {
      log('validation-failed', { field: 'paymentMethodId', reason: 'missing' });
      return NextResponse.json({ error: 'يجب اختيار طريقة الدفع' }, { status: 400 });
    }

    // ──── Session enforcement ────
    const sessionUser = await getSession();
    if (!sessionUser) {
      log('auth-failed', { reason: 'no session' });
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }
    const userID = sessionUser.UserID;
    log('session-ok', { userID });

    const db = await getPool();
    log('db-connected');

    // ──── Enforce active branch business day + user shift (Phase 1C) ────
    log('before-active-day-lookup');
    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(userID);
    if (!gated.ok) return gated.response;
    const { finalizeCurrentFinancialWrite } = await import('@/lib/branch/financialOwnershipPolicy');
    const owned = finalizeCurrentFinancialWrite('expense.create', gated, body);
    if (!owned.ok) return owned.response;
    if (!gated.shift || owned.ownership.shiftMoveId == null) {
      log('rejected', { reason: 'no active shift for user', userID });
      return NextResponse.json({ error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن تسجيل مصروف' }, { status: 400 });
    }
    const activeDay = { ID: owned.ownership.businessDayId!, NewDay: owned.ownership.businessDate! };
    const invDate = owned.ownership.businessDate!;
    const shiftMoveID = owned.ownership.shiftMoveId;
    log('active-day-resolved', { dayId: activeDay.ID, invDate, branchId: gated.branch.branchId });
    log('active-shift-resolved', { shiftMoveID, userID: gated.shift.userId });

    // ──── Validate category belongs to مصروفات ────
    log('before-category-lookup');
    const catResult = await db.request()
      .input('expINID', sql.Int, body.expINID)
      .query(`
        SELECT ExpINID, CatName FROM [dbo].[TblExpINCat]
        WHERE ExpINID = @expINID AND ExpINType = N'مصروفات'
      `);
    log('after-category-lookup');
    if (catResult.recordset.length === 0) {
      log('rejected', { reason: 'invalid expense category', expINID: body.expINID });
      return NextResponse.json({ error: 'فئة المصروف غير صالحة' }, { status: 400 });
    }
    const catName = catResult.recordset[0].CatName;
    log('category-resolved', { catName, expINID: body.expINID });

    // ──── Prepare values ────
    const amount = Math.max(0, body.amount);
    const invTime = getCairoInvTimeDotStr();
    const notesText = body.notes || catName;

    const actor = await buildStaffActorContext(userID);
    const treasuryPorts = await buildTreasuryWritePorts(actor);
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `expense:${owned.ownership.branchId}:${requestId}`;

    try {
      const created = await withUnitOfWork(async ({ transaction }) => {
        const result = await createExpenseThroughTreasury(transaction, treasuryPorts, {
          locationId: owned.ownership.branchId,
          amount,
          categoryId: body.expINID,
          paymentMethodId: body.paymentMethodId,
          notes: notesText,
          idempotencyKey,
          invTime,
        });

        const ledgerResult = await maybeSyncAdvanceLedgerForExpenseCashMove(db, transaction, {
          cashMoveId: result.cashMoveId,
          expINID: body.expINID,
          entryDate: formatLedgerEntryDate(invDate),
          amount,
          createdByUserId: userID,
        });

        const invRes = await new sql.Request(transaction)
          .input('id', sql.Int, result.cashMoveId)
          .query(`SELECT invID FROM dbo.TblCashMove WHERE ID = @id`);

        return {
          cashMoveId: result.cashMoveId,
          invID: invRes.recordset[0]?.invID as number,
          ledgerResult,
          idempotentReplay: result.idempotentReplay,
        };
      });

      const advanceWa = await maybeScheduleAdvanceWhatsAppFromExpenseCategory({
        expINID: body.expINID,
        invID: created.invID,
        amount,
        paymentMethodId: body.paymentMethodId,
        notes: notesText,
      });

      return NextResponse.json({
        invID: created.invID,
        cashMoveId: created.cashMoveId,
        catName,
        amount,
        duplicate: created.idempotentReplay,
        ledgerDualWrite: created.ledgerResult.ledgerDualWrite,
        ledgerSync: created.ledgerResult.outcome ?? null,
        advanceWhatsApp: advanceWa.scheduled,
      }, { status: created.idempotentReplay ? 200 : 201 });
    } catch (err) {
      if (err instanceof EmployeeLedgerDualWriteError) {
        log('ledger-dual-write-error', { error: err.message });
        return NextResponse.json({ error: err.message, requestId }, { status: 503 });
      }
      log('transaction-error', {
        error: err instanceof Error ? err.message : String(err),
        code: (err as any)?.code,
        number: (err as any)?.number,
      });

      const errCode = (err as any)?.code;
      const errStatus = (err as any)?.statusCode;
      const errNumber = (err as any)?.number;
      if (errCode === 'TREASURY_BUSY' || errStatus === 503) {
        return NextResponse.json(
          { success: false, code: 'TREASURY_BUSY', message: (err as Error).message, requestId },
          { status: 503 }
        );
      }
      if (errNumber === 1222 || errNumber === 1205) {
        return NextResponse.json(
          { success: false, code: errNumber === 1205 ? 'DEADLOCK' : 'LOCK_TIMEOUT', message: 'الخزينة مشغولة بعملية أخرى حاليًا. حاول مرة أخرى بعد لحظات.', requestId },
          { status: 503 }
        );
      }
      const mapped = branchErrorResponse(err);
      if (mapped) return mapped;
      throw err;
    }
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    log('unhandled-error', { error: message });
    console.error(`[expenses] ❌ POST /api/expenses FAILED: ${message}`);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع', requestId }, { status: 500 });
  }
}

// Helper: N() is just identity but clarifies intent for NVarChar literals
function N(s: string) { return s; }
