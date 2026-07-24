import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  EmployeeTargetValidationError,
  getEmployeeDailyTargetsForDate,
  parseWorkDateQuery,
} from '@/lib/payroll/employee-target';

// GET /api/payroll/daily/targets?workDate=YYYY-MM-DD — scoped to active branch
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const workDate = parseWorkDateQuery(req.nextUrl.searchParams.get('workDate'));
    const data = await getEmployeeDailyTargetsForDate(
      workDate,
      null,
      branch.branchId,
    );
    return NextResponse.json({
      workDate: data.workDate,
      branchId: branch.branchId,
      totals: data.totals,
      employees: data.employees,
      planConflicts: data.planConflicts,
    });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    if (message.includes('workDate') || message.includes('YYYY-MM-DD')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('[api/payroll/daily/targets] GET error:', message);
    return NextResponse.json({ error: 'تعذّر تحميل تارجت اليوم' }, { status: 500 });
  }
}
