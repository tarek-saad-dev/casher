import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeLedgerDuesSettlementError,
  executeEmployeeDuesSettlement,
} from '@/lib/services/employeeLedgerDuesSettlementService';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import { finalizeHistoricalFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';

/**
 * POST /api/admin/hr/employee-ledger/payout
 * Settle employee monthly dues as a final advance — one treasury cash-out + one ledger debit.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = Number(body.empId);
    const amount = Number(body.amount);
    const expectedBalance = Number(body.expectedBalance ?? body.amount);
    const payrollMonth = String(body.payrollMonth ?? '').trim();
    const paymentMethodId = Number(body.paymentMethodId);
    const payoutDate = String(body.payoutDate ?? '').trim();
    const idempotencyKey = body.idempotencyKey != null ? String(body.idempotencyKey) : undefined;
    const notes = body.notes != null ? String(body.notes) : undefined;
    // Ledger-scope confirmation only. Do not send BranchID — create-path ownership
    // rejects client BranchID / BusinessDayID / ShiftMoveID.
    const confirmedLedgerBranchId = Number(body.confirmedLedgerBranchId);

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    if (!Number.isInteger(confirmedLedgerBranchId) || confirmedLedgerBranchId !== branch.branchId) {
      return NextResponse.json(
        {
          error:
            'صرف المستحقات متاح فقط للفرع التشغيلي النشط. اختر ذلك الفرع، حدّث رصيد الشهر، ثم أعد المحاولة.',
        },
        { status: 400 },
      );
    }
    const dayResolution = await resolveBranchDayForDate(branch.branchId, payoutDate);
    if (!dayResolution.ok) return dayResolution.response;
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, body);
    if (!historical.ok) return historical.response;

    const result = await executeEmployeeDuesSettlement({
      empId,
      amount,
      expectedBalance,
      payrollMonth,
      paymentMethodId,
      payoutDate: historical.ownership.businessDate,
      idempotencyKey,
      notes,
      createdByUserId: auth.userId,
      branchId: historical.ownership.branchId,
      businessDayId: historical.ownership.businessDayId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerDuesSettlementError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/payout] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
