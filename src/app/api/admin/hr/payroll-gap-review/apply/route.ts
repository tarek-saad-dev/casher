import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
import { validateMonthYear } from '@/lib/reportMonthUtils';
import { applyEmployeePayrollGapFixes } from '@/lib/hr/employeePayrollGapReview';
import type { PayrollGapApplyOptions } from '@/lib/types/payroll-gap-review';

async function assertBranchAccess(userId: number, branchId: number): Promise<string | null> {
  const [access, active] = await Promise.all([
    listUserValidBranchAccess(userId),
    listActiveBranches(),
  ]);
  const activeIds = new Set(active.map((b) => b.branchId));
  const allowed = access.some(
    (a) =>
      a.branchId === branchId &&
      activeIds.has(a.branchId) &&
      (a.canOperate || a.canSwitch || a.canViewReports || a.isDefault),
  );
  return allowed ? null : 'لا تملك صلاحية على هذا الفرع';
}

/**
 * POST /api/admin/hr/payroll-gap-review/apply
 * Body: { empId, branchId, year, month, options? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const body = await req.json();
    const empId = Number(body.empId);
    const branchId = Number(body.branchId);
    const year = Number(body.year);
    const month = Number(body.month);
    const options = (body.options ?? {}) as PayrollGapApplyOptions;

    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId مطلوب' }, { status: 400 });
    }
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ error: 'branchId مطلوب' }, { status: 400 });
    }
    const monthError = validateMonthYear(year, month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    const branchError = await assertBranchAccess(auth.userId, branchId);
    if (branchError) {
      return NextResponse.json({ error: branchError }, { status: 403 });
    }

    const result = await applyEmployeePayrollGapFixes({
      empId,
      branchId,
      year,
      month,
      actorUserId: auth.userId,
      options,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/payroll-gap-review/apply] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
