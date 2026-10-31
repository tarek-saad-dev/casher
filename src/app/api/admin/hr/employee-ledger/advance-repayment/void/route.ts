import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  EmployeeLedgerAdvanceRepaymentError,
  voidAdvanceRepayment,
} from '@/lib/services/employeeLedgerAdvanceRepaymentService';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import { finalizeHistoricalFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';
import { getCairoMonthCloseAwareDate } from '@/lib/businessDate';

/**
 * POST /api/admin/hr/employee-ledger/advance-repayment/void
 * Void repayment ledger credit and reverse the treasury cash-in.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const ledgerEntryId = Number(body.ledgerEntryId);
    const reason = String(body.reason ?? '').trim();
    const date = String(body.date ?? getCairoMonthCloseAwareDate()).trim();

    if (!ledgerEntryId || Number.isNaN(ledgerEntryId) || ledgerEntryId <= 0) {
      return NextResponse.json({ error: 'ledgerEntryId غير صالح' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'سبب الإلغاء مطلوب' }, { status: 400 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveBranchDayForDate(branch.branchId, date);
    if (!dayResolution.ok) return dayResolution.response;
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, body);
    if (!historical.ok) return historical.response;

    const result = await voidAdvanceRepayment({
      ledgerEntryId,
      reason,
      createdByUserId: auth.userId,
      branchId: historical.ownership.branchId,
      businessDayId: historical.ownership.businessDayId,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerAdvanceRepaymentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[advance-repayment/void] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
