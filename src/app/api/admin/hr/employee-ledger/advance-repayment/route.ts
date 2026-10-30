import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import { finalizeHistoricalFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';
import { getCairoMonthCloseAwareDate } from '@/lib/businessDate';
import {
  EmployeeLedgerFundingError,
  executeEmployeeFunding,
} from '@/lib/services/employeeLedgerFundingService';

/**
 * Actual collection of an outstanding employee advance, never business revenue.
 * A partner-report viewer cannot mutate payroll without /admin/hr permission.
 * Branch, payment day and allowed month are server-authoritative.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const date = getCairoMonthCloseAwareDate();
    const month = String(body.month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month) || month !== date.slice(0, 7)) {
      return NextResponse.json(
        { error: 'سداد السلفة يُسجل بتاريخ التحصيل الفعلي فقط؛ اختر شهر التشغيل الحالي' },
        { status: 409 },
      );
    }

    const dayResolution = await resolveBranchDayForDate(branch.branchId, date);
    if (!dayResolution.ok) return dayResolution.response;
    // No client-supplied branch, backdate or historical override flags.
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, {});
    if (!historical.ok) return historical.response;

    const result = await executeEmployeeFunding({
      empId: Number(body.empId),
      amount: Number(body.amount),
      paymentMethodId: Number(body.paymentMethodId),
      date: historical.ownership.businessDate,
      notes: String(body.notes ?? '').slice(0, 300) || undefined,
      createdByUserId: auth.userId,
      branchId: historical.ownership.branchId,
      businessDayId: historical.ownership.businessDayId,
      purpose: 'advance_repayment',
      repaymentId: String(body.repaymentId ?? ''),
    });

    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerFundingError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('[advance-repayment] error:', error);
    return NextResponse.json({ error: 'تعذر تسجيل السداد؛ تحقق من الخزينة ودفتر الموظف قبل إعادة المحاولة' }, { status: 500 });
  }
}
