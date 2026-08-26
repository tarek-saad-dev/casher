import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isDailyPayrollViewScope,
  resolveDailyPayrollViewScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope';
import { getEmployeeMonthlyQuickReview } from '@/lib/reports/employeeMonthlyQuickReview';

/**
 * GET /api/admin/hr/employee-monthly-quick-review?year=&month=&employeeScope=all
 * One-button team snapshot: حضور · انصراف · الفرع · اليومية · التارجت حتى اليوم
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));

    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: 'سنة غير صالحة' }, { status: 400 });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'شهر غير صالح' }, { status: 400 });
    }

    const viewScope = await resolveDailyPayrollViewScope(
      searchParams.get('employeeScope') ?? 'all',
    );
    if (!isDailyPayrollViewScope(viewScope)) return viewScope;

    const report = await getEmployeeMonthlyQuickReview({
      year,
      month,
      branchIds: viewScope.branchIds,
    });

    return NextResponse.json({
      ...report,
      employeeScope: viewScope.employeeScope,
      branchIds: viewScope.branchIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-monthly-quick-review] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
