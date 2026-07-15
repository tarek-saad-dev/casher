import { NextRequest, NextResponse } from "next/server";
import { getPool, sql, allocateInvID } from "@/lib/db";
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

    // ──── Transaction (minimal: only invID allocation + insert) ────
    let transactionStarted = false;
    let transactionCompleted = false;
    const transaction = new sql.Transaction(db);

    try {
      log('before-transaction-begin');
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      transactionStarted = true;
      log('after-transaction-begin');

      // Idempotency: check for identical past-date expense
      log('before-idempotency-check');
      const dupCheck = await new sql.Request(transaction)
        .input('invDate', sql.Date, invDate)
        .input('expINID', sql.Int, expINID)
        .input('amount', sql.Decimal(10, 2), Number(amount))
        .input('paymentMethodId', sql.Int, paymentMethodId)
        .query(`
          SELECT TOP 1 ID, invID
          FROM [dbo].[TblCashMove]
          WHERE invType = N'مصروفات'
            AND invDate = @invDate
            AND ExpINID = @expINID
            AND GrandTolal = @amount
            AND PaymentMethodID = @paymentMethodId
            AND ShiftMoveID IS NULL
          ORDER BY ID DESC
        `);
      log('after-idempotency-check');
      if (dupCheck.recordset.length > 0) {
        const dup = dupCheck.recordset[0];
        log('idempotency-detected', { existingId: dup.ID, existingInvID: dup.invID });
        const ledgerResult = await maybeSyncAdvanceLedgerForExpenseCashMove(db, transaction, {
          cashMoveId: dup.ID,
          expINID,
          entryDate: formatLedgerEntryDate(invDate),
          amount: Number(amount),
          createdByUserId: session.UserID,
        });
        await transaction.commit();
        transactionCompleted = true;
        log('committed-duplicate');
        return NextResponse.json({
          success: true,
          message: "تم إضافة المصروف للتاريخ المحدد بنجاح",
          ledgerDualWrite: ledgerResult.ledgerDualWrite,
          ledgerSync: ledgerResult.outcome ?? null,
          data: { ID: dup.ID, invID: dup.invID, CategoryName: catName, duplicate: true },
        });
      }

      // Allocate invID safely (no TABLOCKX)
      log('before-invID-allocation');
      const newInvID = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);
      log('after-invID-allocation', { newInvID });

      // Prepare values
      const finalAmount = Math.max(0, Number(amount));
      const finalInvTime = invTime || "12:00";
      const notesText = notes?.trim() || catName;

      // Insert into TblCashMove for past date
      log('before-cash-move-insert');
      const cashReq = new sql.Request(transaction);
      cashReq
        .input("invID", sql.Int, newInvID)
        .input("invType", sql.NVarChar(20), "مصروفات")
        .input("invDate", sql.Date, invDate)
        .input("invTime", sql.NVarChar(50), finalInvTime)
        .input("ClientID", sql.Int, null)
        .input("expINID", sql.Int, expINID)
        .input("amount", sql.Decimal(10, 2), finalAmount)
        .input("inOut", sql.NVarChar(10), "out")
        .input("notes", sql.NVarChar(sql.MAX), notesText)
        .input("shiftMoveID", sql.Int, null)
        .input("paymentMethodID", sql.Int, paymentMethodId);

      const insertResult = await cashReq.query(`
        INSERT INTO [dbo].[TblCashMove]
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT
          INSERTED.ID, INSERTED.invID, INSERTED.invDate, INSERTED.invTime,
          INSERTED.ExpINID, INSERTED.GrandTolal AS Amount, INSERTED.Notes
        VALUES
          (@invID, @invType, @invDate, @invTime, @ClientID, @expINID, @amount, @inOut, @notes, @shiftMoveID, @paymentMethodID)
      `);
      log('after-cash-move-insert');

      const newRecord = insertResult.recordset[0];
      const ledgerResult = await maybeSyncAdvanceLedgerForExpenseCashMove(db, transaction, {
        cashMoveId: newRecord.ID,
        expINID,
        entryDate: formatLedgerEntryDate(invDate),
        amount: finalAmount,
        createdByUserId: session.UserID,
      });

      log('before-commit');
      await transaction.commit();
      transactionCompleted = true;
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
        data: {
          ID: newRecord.ID,
          invID: newRecord.invID,
          invDate: newRecord.invDate,
          invTime: newRecord.invTime,
          ExpINID: newRecord.ExpINID,
          Amount: newRecord.Amount,
          Notes: newRecord.Notes,
          CategoryName: catName,
        },
      });
    } catch (error) {
      if (error instanceof EmployeeLedgerDualWriteError) {
        log('ledger-dual-write-error', { error: error.message });
        if (transactionStarted && !transactionCompleted) {
          try { await transaction.rollback(); } catch { /* ignore */ }
        }
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
      if (transactionStarted && !transactionCompleted) {
        log('before-rollback');
        try { await transaction.rollback(); log('after-rollback'); } catch (rbErr) {
          log('rollback-failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
        }
      }

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
