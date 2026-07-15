import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getEmployeeMonthlyPayrollReport } from '@/lib/reports/employee-monthly-payroll';
import { validateReportParams } from '@/lib/reports/employee-monthly-payroll.types';

/**
 * GET /api/admin/hr/employee-monthly-report?employeeId=&year=&month=
 * Monthly employee report: attendance, base wage, shortfall notes, deductions, targets.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const validated = validateReportParams(
      searchParams.get('employeeId'),
      searchParams.get('year'),
      searchParams.get('month'),
    );

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const report = await getEmployeeMonthlyPayrollReport({
      employeeId: validated.employeeId,
      year: validated.year,
      month: validated.month,
    });

    if (!report) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-monthly-report] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
