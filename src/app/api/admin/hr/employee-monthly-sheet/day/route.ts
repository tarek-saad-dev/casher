import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { getEmployeeMonthlySheetDay } from '@/lib/reports/employee-monthly-sheet';

/**
 * GET /api/admin/hr/employee-monthly-sheet/day?employeeId=&date=
 * Single-day patch after generate / attendance fix (no full UI reload required).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const employeeId = Number(searchParams.get('employeeId'));
    const workDate = String(searchParams.get('date') ?? '').trim();

    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return NextResponse.json({ error: 'employeeId مطلوب' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ error: 'date مطلوب (YYYY-MM-DD)' }, { status: 400 });
    }

    const patch = await getEmployeeMonthlySheetDay({
      employeeId,
      workDate,
      branchId: branch.branchId,
    });

    if (!patch) {
      return NextResponse.json({ error: 'اليوم أو الموظف غير موجود' }, { status: 404 });
    }

    return NextResponse.json(patch);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-monthly-sheet/day] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
