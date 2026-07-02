import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getEmployeeMonthlyWorkRevenueReport,
} from '@/lib/reports/employee-monthly-work-revenue';
import { validateReportParams } from '@/lib/reports/employee-monthly-work-revenue.types';

const REPORT_PAGE_PATH = '/admin/reports/employee-monthly-work-revenue';

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(REPORT_PAGE_PATH);
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

    const report = await getEmployeeMonthlyWorkRevenueReport({
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
    console.error('[api/admin/reports/employee-monthly-work-revenue] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
