import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql, allocateInvID } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isAuthResult } from '@/lib/api-auth';
import {
  EmployeeLedgerDualWriteError,
} from '@/lib/services/employeeLedgerDualWrite';
import { syncEmployeeFundingFromCashMove } from '@/lib/services/employeeLedgerFundingSyncService';
import { maybeScheduleFundingWhatsAppFromIncomeCategory } from '@/lib/services/employeeAdvanceWhatsAppNotify';

// POST /api/incomes/past-date - Add income for past dates
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager', 'accountant']);
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const body = await req.json();
    const { invDate, invTime, amount, expInId, paymentMethodId, notes } = body;

    // Validation
    if (!invDate) return NextResponse.json({ error: 'التاريخ مطلوب' }, { status: 400 });
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'قيمة الإيراد يجب أن تكون أكبر من صفر' }, { status: 400 });
    if (!expInId) return NextResponse.json({ error: 'يجب اختيار تصنيف الإيراد' }, { status: 400 });
    if (!paymentMethodId) return NextResponse.json({ error: 'يجب اختيار طريقة الدفع' }, { status: 400 });

    // Validate that the date is in the past or today
    const inputDate = new Date(invDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    
    if (inputDate > today) {
      return NextResponse.json({ error: 'لا يمكن إضافة إيراد لتاريخ في المستقبل' }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1. Validate category exists and is income type
      const catRes = await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId AND ExpINType = N'ايرادات'`);
      
      if (catRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'تصنيف الإيراد غير موجود' }, { status: 400 });
      }

      // 2. Validate payment method exists
      const pmRes = await new sql.Request(transaction)
        .input('pmId', sql.Int, paymentMethodId)
        .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId`);
      
      if (pmRes.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'طريقة الدفع غير موجودة' }, { status: 400 });
      }

      // 3. Allocate next invID safely (no UPDLOCK/HOLDLOCK)
      const nextInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

      // 4. Insert the income record for past date
      const notesText = typeof notes === 'string' ? notes.trim() : '';
      const insertReq = new sql.Request(transaction)
        .input('invID', sql.Int, nextInvID)
        .input('invDate', sql.Date, invDate)
        .input('invTime', sql.NVarChar(10), invTime || '12:00')
        .input('expInId', sql.Int, expInId)
        .input('amount', sql.Decimal(10, 2), Number(amount))
        .input('notes', sql.NVarChar(sql.MAX), notesText || null)
        .input('paymentMethodId', sql.Int, paymentMethodId);

      const insertRes = await insertReq.query(`
        INSERT INTO dbo.TblCashMove
          (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
        OUTPUT
          INSERTED.ID, INSERTED.invID, INSERTED.invDate, INSERTED.invTime,
          INSERTED.ExpINID, INSERTED.GrandTolal AS Amount, INSERTED.Notes,
          INSERTED.PaymentMethodID
        VALUES
          (@invID, N'ايرادات', @invDate, @invTime, NULL, @expInId, @amount, N'in', @notes, NULL, @paymentMethodId)
      `);

      const newRecord = insertRes.recordset[0];
      const fundingSync = await syncEmployeeFundingFromCashMove(transaction, Number(newRecord.ID), {
        createdByUserId: session.UserID,
      });

      await transaction.commit();

      const fundingWa = await maybeScheduleFundingWhatsAppFromIncomeCategory({
        expINID: Number(expInId),
        invID: Number(newRecord.invID),
        amount: Number(amount),
        paymentMethodId: Number(paymentMethodId),
        notes: notesText || undefined,
      });
      
      return NextResponse.json({
        success: true,
        message: 'تم إضافة الإيراد للتاريخ المحدد بنجاح',
        ledgerDualWrite: fundingSync.ledgerDualWrite,
        ledgerSync: fundingSync.outcome,
        advanceWhatsApp: fundingWa.scheduled,
        data: {
          ID: newRecord.ID,
          invID: newRecord.invID,
          invDate: newRecord.invDate,
          invTime: newRecord.invTime,
          ExpINID: newRecord.ExpINID,
          Amount: newRecord.Amount,
          Notes: newRecord.Notes,
          PaymentMethodID: newRecord.PaymentMethodID,
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/past-date] POST error:', message);
    return NextResponse.json({ error: 'فشل إضافة الإيراد: ' + message }, { status: 500 });
  }
}
