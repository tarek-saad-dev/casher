import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { withUnitOfWork } from '@/platform/public';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import { buildTreasuryWritePorts } from '@/lib/treasuryComposition';
import { createIncomeThroughTreasury } from '@/apps/treasury/application/createIncome';
import { randomUUID } from 'crypto';
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

    // ──── Enforce active branch + matching business day for this date (Phase 1D) ────
    // Never trust browser branchId — ownership comes only from validated session context.
    // Does NOT attach to the open day and does NOT auto-create a day for this date.
    const { requireBranchOperationAccess } = await import('@/lib/branch/context');
    const { resolveBranchDayForDate } = await import('@/lib/branch/operationalGates');
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveBranchDayForDate(branch.branchId, invDate);
    if (!dayResolution.ok) return dayResolution.response;
    const { finalizeHistoricalFinancialWrite } = await import('@/lib/branch/financialOwnershipPolicy');
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, body);
    if (!historical.ok) return historical.response;
    const branchId = historical.ownership.branchId;
    const businessDayId = historical.ownership.businessDayId;

    const actor = await buildStaffActorContext(session.UserID);
    const treasuryPorts = await buildTreasuryWritePorts(actor);
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `income.past:${branchId}:${randomUUID()}`;
    const notesText = typeof notes === 'string' ? notes.trim() : '';

    const created = await withUnitOfWork(async ({ transaction }) => {
      const result = await createIncomeThroughTreasury(transaction, treasuryPorts, {
        locationId: branchId,
        amount: Number(amount),
        categoryId: Number(expInId),
        paymentMethodId: Number(paymentMethodId),
        notes: notesText || null,
        idempotencyKey,
        invTime: invTime || '12:00',
        historical: {
          businessDayId,
          businessDate: String(invDate).slice(0, 10),
          shiftInstanceId: historical.ownership.shiftMoveId,
        },
      });

      const fundingSync = await syncEmployeeFundingFromCashMove(transaction, result.cashMoveId, {
        createdByUserId: session.UserID,
      });

      const rowRes = await new sql.Request(transaction)
        .input('id', sql.Int, result.cashMoveId)
        .query(`
          SELECT
            ID, invID, invDate, invTime, ExpINID, GrandTolal AS Amount, Notes, PaymentMethodID
          FROM dbo.TblCashMove WHERE ID = @id
        `);

      return { newRecord: rowRes.recordset[0], fundingSync, idempotentReplay: result.idempotentReplay };
    });

    const newRecord = created.newRecord;
    const fundingSync = created.fundingSync;

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
      idempotentReplay: created.idempotentReplay,
      data: {
        ID: newRecord.ID,
        invID: newRecord.invID,
        invDate: newRecord.invDate,
        invTime: newRecord.invTime,
        ExpINID: newRecord.ExpINID,
        Amount: newRecord.Amount,
        Notes: newRecord.Notes,
        PaymentMethodID: newRecord.PaymentMethodID,
      },
    }, { status: created.idempotentReplay ? 200 : 201 });

  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/past-date] POST error:', message);
    return NextResponse.json({ error: 'فشل إضافة الإيراد: ' + message }, { status: 500 });
  }
}
