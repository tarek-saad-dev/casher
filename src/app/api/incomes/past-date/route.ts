import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
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
import { parseStoreIncomeKind } from '@/lib/accounting/storeIncome';
import {
  ensureStoreIncomeCategory,
  findDuplicateStoreIncome,
} from '@/lib/services/storeIncomeService';

// POST /api/incomes/past-date - Add income for past dates
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager', 'accountant']);
  if (!isAuthResult(auth)) return auth;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: '??? ????? ?????? ?????' }, { status: 401 });

    const body = await req.json();
    const { invDate, invTime, amount, paymentMethodId, notes } = body;
    const storeIncomeKind = parseStoreIncomeKind(body.storeIncomeKind);
    let expInId = body.expInId != null ? Number(body.expInId) : null;

    // Validation
    if (!invDate) return NextResponse.json({ error: '??????? ?????' }, { status: 400 });
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: '???? ??????? ??? ?? ???? ???? ?? ???' }, { status: 400 });
    if (!storeIncomeKind && !expInId) {
      return NextResponse.json({ error: '??? ?????? ????? ???????' }, { status: 400 });
    }
    if (!paymentMethodId) return NextResponse.json({ error: '??? ?????? ????? ?????' }, { status: 400 });

    // Validate that the date is in the past or today
    const inputDate = new Date(invDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (inputDate > today) {
      return NextResponse.json({ error: '?? ???? ????? ????? ?????? ?? ????????' }, { status: 400 });
    }

    // ???? Enforce active branch + matching business day for this date (Phase 1D) ????
    // Never trust browser branchId ? ownership comes only from validated session context.
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

    const actor = await buildStaffActorContext(session.UserID, session.TenantId);
    const treasuryPorts = await buildTreasuryWritePorts(actor);
    const amountNum = Number(amount);
    const notesText = typeof notes === 'string' ? notes.trim() : '';
    const businessDate = String(invDate).slice(0, 10);
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : storeIncomeKind
          ? `store-income.past:${branchId}:${businessDate}:${storeIncomeKind}:${amountNum}:${paymentMethodId}`
          : `income.past:${branchId}:${randomUUID()}`;

    const created = await withUnitOfWork(async ({ transaction }) => {
      let storeCategoryName: string | null = null;
      if (storeIncomeKind) {
        const ensured = await ensureStoreIncomeCategory(
          transaction,
          storeIncomeKind,
          session.TenantId,
        );
        expInId = ensured.expInId;
        storeCategoryName = ensured.categoryName;

        const dup = await findDuplicateStoreIncome(transaction, {
          branchId,
          invDate: businessDate,
          expInId: Number(expInId),
          amount: amountNum,
          paymentMethodId: Number(paymentMethodId),
        });
        if (dup) {
          return {
            newRecord: {
              ID: dup.ID,
              invID: dup.invID,
              invDate: businessDate,
              invTime: invTime || '12:00',
              ExpINID: expInId,
              Amount: amountNum,
              Notes: notesText || storeCategoryName,
              PaymentMethodID: Number(paymentMethodId),
              EmpID: null,
            },
            fundingSync: { ledgerDualWrite: false, outcome: 'skipped_store_income' as const },
            idempotentReplay: true,
            duplicate: true,
            resolvedExpInId: Number(expInId),
          };
        }
      }

      const result = await createIncomeThroughTreasury(transaction, treasuryPorts, {
        locationId: branchId,
        amount: amountNum,
        categoryId: Number(expInId),
        paymentMethodId: Number(paymentMethodId),
        notes: notesText || (storeIncomeKind ? (storeCategoryName ?? '????? ?????') : null),
        idempotencyKey,
        invTime: invTime || '12:00',
        historical: {
          businessDayId,
          businessDate,
          shiftInstanceId: historical.ownership.shiftMoveId,
        },
      });

      let fundingSync: { ledgerDualWrite: boolean; outcome: string } = {
        ledgerDualWrite: false,
        outcome: 'skipped_store_income',
      };
      if (!storeIncomeKind) {
        fundingSync = await syncEmployeeFundingFromCashMove(transaction, result.cashMoveId, {
          createdByUserId: session.UserID,
        });
      }

      const rowRes = await new sql.Request(transaction)
        .input('id', sql.Int, result.cashMoveId)
        .query(`
          SELECT
            ID, invID, invDate, invTime, ExpINID, GrandTolal AS Amount, Notes, PaymentMethodID, EmpID
          FROM dbo.TblCashMove WHERE ID = @id
        `);

      return {
        newRecord: rowRes.recordset[0],
        fundingSync,
        idempotentReplay: result.idempotentReplay,
        duplicate: false,
        resolvedExpInId: Number(expInId),
      };
    });

    const newRecord = created.newRecord;
    const fundingSync = created.fundingSync;

    const fundingWa = storeIncomeKind
      ? { scheduled: false }
      : await maybeScheduleFundingWhatsAppFromIncomeCategory({
          expINID: created.resolvedExpInId,
          invID: Number(newRecord.invID),
          amount: amountNum,
          paymentMethodId: Number(paymentMethodId),
          notes: notesText || undefined,
        });

    return NextResponse.json({
      success: true,
      message: '?? ????? ??????? ??????? ?????? ?????',
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
        EmpID: newRecord.EmpID ?? null,
        storeIncomeKind: storeIncomeKind ?? undefined,
        duplicate: created.duplicate || undefined,
      },
    }, { status: created.idempotentReplay || created.duplicate ? 200 : 201 });

  } catch (err: unknown) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/past-date] POST error:', message);
    return NextResponse.json({ error: '??? ????? ???????: ' + message }, { status: 500 });
  }
}
