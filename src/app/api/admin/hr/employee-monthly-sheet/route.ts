import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { getEmployeeMonthlySheet } from '@/lib/reports/employee-monthly-sheet';
import { validateReportParams } from '@/lib/reports/employee-monthly-sheet.types';

/**
 * GET /api/admin/hr/employee-monthly-sheet?employeeId=&year=&month=
 * Monthly employee follow-up sheet: attendance, allocated revenue, ledger expenses, payroll flags.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const validated = validateReportParams(
      searchParams.get('employeeId'),
      searchParams.get('year'),
      searchParams.get('month'),
    );

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const sheet = await getEmployeeMonthlySheet({
      employeeId: validated.employeeId,
      year: validated.year,
      month: validated.month,
      branchId: branch.branchId,
    });

    if (!sheet) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    return NextResponse.json({
      ...sheet,
      branch: {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-monthly-sheet] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
