import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listUserValidBranchAccess, listActiveBranches } from '@/lib/branch/repository';
import { validateMonthYear } from '@/lib/reportMonthUtils';
import { analyzeEmployeePayrollGaps } from '@/lib/hr/employeePayrollGapReview';

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
 * GET /api/admin/hr/payroll-gap-review?empId=&branchId=&year=&month=
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const empId = Number(searchParams.get('empId'));
    const branchId = Number(searchParams.get('branchId'));
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));

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

    const review = await analyzeEmployeePayrollGaps({ empId, branchId, year, month });
    return NextResponse.json(review);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/payroll-gap-review] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
