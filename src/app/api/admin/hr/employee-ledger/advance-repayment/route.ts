import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  EmployeeLedgerAdvanceRepaymentError,
  executeAdvanceRepayment,
} from '@/lib/services/employeeLedgerAdvanceRepaymentService';
import { getEmployeeBranchBalance } from '@/lib/services/employeeLedgerService';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import { finalizeHistoricalFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';
import { roundMoney } from '@/lib/reportMonthUtils';

/**
 * GET /api/admin/hr/employee-ledger/advance-repayment?empId=
 * Preview outstanding advance debt on the operating branch (all-time, includes carry-forward).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const empId = Number(request.nextUrl.searchParams.get('empId'));
    if (!empId || empId <= 0) {
      return NextResponse.json({ error: 'empId مطلوب' }, { status: 400 });
    }
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const balance = await getEmployeeBranchBalance(empId, branch.branchId);
    const outstandingDebt = roundMoney(Math.max(0, -balance));
    return NextResponse.json({
      empId,
      branchId: branch.branchId,
      balance,
      outstandingDebt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/employee-ledger/advance-repayment
 * Employee pays back an advance — Cash IN + ledger credit (advance_repayment).
 * Admin-only; open business day required.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = Number(body.empId);
    const amount = Number(body.amount);
    const paymentMethodId = Number(body.paymentMethodId);
    const date = String(body.date ?? '').trim();
    const notes = body.notes != null ? String(body.notes) : undefined;
    const idempotencyKey =
      body.idempotencyKey != null ? String(body.idempotencyKey) : undefined;

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const dayResolution = await resolveBranchDayForDate(branch.branchId, date);
    if (!dayResolution.ok) return dayResolution.response;
    const historical = finalizeHistoricalFinancialWrite(branch.branchId, dayResolution.day, body);
    if (!historical.ok) return historical.response;

    const result = await executeAdvanceRepayment({
      empId,
      amount,
      paymentMethodId,
      date: historical.ownership.businessDate,
      notes,
      createdByUserId: auth.userId,
      branchId: historical.ownership.branchId,
      businessDayId: historical.ownership.businessDayId,
      idempotencyKey,
    });

    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerAdvanceRepaymentError) {
      const status = error.message.includes('EMP_LEDGER_DUAL_WRITE_ENABLED') ? 503 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/employee-ledger/advance-repayment] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
