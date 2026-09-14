import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { completeEmployeeMonthlySheetAttendance } from '@/lib/hr/employeeMonthlySheetCompleteAttendance';

/**
 * POST /api/admin/hr/employee-monthly-sheet/complete-attendance
 * Body: { empId, workDate, confirm?: boolean }
 * Preview (confirm=false) or apply default-fill for missing check-in/out only.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    const empId = Number(body.empId);
    const workDate = String(body.workDate ?? '').trim();
    const confirm = body.confirm === true;

    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId مطلوب' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ error: 'workDate مطلوب (YYYY-MM-DD)' }, { status: 400 });
    }

    const result = await completeEmployeeMonthlySheetAttendance({
      empId,
      branchId: branch.branchId,
      workDate,
      actorUserId: auth.userId,
      confirm,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-monthly-sheet/complete-attendance] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
