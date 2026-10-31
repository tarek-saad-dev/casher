import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  EmployeeLedgerAdvanceRepaymentError,
  executeAdvanceRepayment,
} from '@/lib/services/employeeLedgerAdvanceRepaymentService';
import { getEmployeeBranchBalance } from '@/lib/services/employeeLedgerService';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import { resolveBranchDayForDate } from '@/lib/branch/operationalGates';
import { finalizeHistoricalFinancialWrite } from '@/lib/branch/financialOwnershipPolicy';
import { userCanWriteOpsOnBranch } from '@/lib/branch/opsWriteBranch';
import { roundMoney } from '@/lib/reportMonthUtils';

function parsePositiveInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EmployeeLedgerAdvanceRepaymentError(`${label} غير صالح`);
  }
  return Math.trunc(n);
}

async function resolveTargetBranchId(params: {
  requestedBranchId: number | null;
  sessionBranchId: number;
  userId: number;
  tenantId: string;
}): Promise<number | NextResponse> {
  const targetBranchId = params.requestedBranchId ?? params.sessionBranchId;
  const allowed = await userCanWriteOpsOnBranch(
    params.userId,
    targetBranchId,
    params.tenantId,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: 'غير مصرح بتشغيل/كتابة هذا الفرع', code: 'OPERATION_NOT_ALLOWED' },
      { status: 403 },
    );
  }
  return targetBranchId;
}

/**
 * GET /api/admin/hr/employee-ledger/advance-repayment?empId=&branchId=
 * Preview outstanding advance debt on the requested (accessible) branch.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const empId = parsePositiveInt(
      request.nextUrl.searchParams.get('empId'),
      'الموظف',
    );
    const branchParam = request.nextUrl.searchParams.get('branchId');
    const requestedBranchId =
      branchParam != null && String(branchParam).trim() !== ''
        ? parsePositiveInt(branchParam, 'الفرع')
        : null;

    const session = await requireBranchOperationAccess();
    if (!isActiveBranchContext(session)) return session;

    const target = await resolveTargetBranchId({
      requestedBranchId,
      sessionBranchId: session.branchId,
      userId: auth.userId,
      tenantId: auth.tenantId,
    });
    if (target instanceof NextResponse) return target;

    const balance = await getEmployeeBranchBalance(empId, target);
    const outstandingDebt = roundMoney(Math.max(0, -balance));
    return NextResponse.json({
      empId,
      branchId: target,
      balance,
      outstandingDebt,
    });
  } catch (error: unknown) {
    if (error instanceof EmployeeLedgerAdvanceRepaymentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/employee-ledger/advance-repayment
 * Employee pays back an advance — Cash IN + ledger credit (advance_repayment)
 * on body.branchId when the caller may operate/switch that branch.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json();
    const empId = parsePositiveInt(body.empId, 'الموظف');
    const amount = Number(body.amount);
    const paymentMethodId = Number(body.paymentMethodId);
    const date = String(body.date ?? '').trim();
    const notes = body.notes != null ? String(body.notes) : undefined;
    const idempotencyKey =
      body.idempotencyKey != null ? String(body.idempotencyKey) : undefined;
    const requestedBranchId =
      body.branchId != null && String(body.branchId).trim() !== ''
        ? parsePositiveInt(body.branchId, 'الفرع')
        : null;

    const session = await requireBranchOperationAccess();
    if (!isActiveBranchContext(session)) return session;

    const targetBranchId = await resolveTargetBranchId({
      requestedBranchId,
      sessionBranchId: session.branchId,
      userId: auth.userId,
      tenantId: auth.tenantId,
    });
    if (targetBranchId instanceof NextResponse) return targetBranchId;

    const dayResolution = await resolveBranchDayForDate(targetBranchId, date);
    if (!dayResolution.ok) return dayResolution.response;
    const historical = finalizeHistoricalFinancialWrite(
      targetBranchId,
      dayResolution.day,
      body,
    );
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
