import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  EmployeeTargetValidationError,
  getEmployeeDailyTargetsForDate,
  parseWorkDateQuery,
} from '@/lib/payroll/employee-target';

// GET /api/payroll/daily/targets?workDate=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    // Match daily payroll route openness; session optional.
    await getSession();

    const workDate = parseWorkDateQuery(req.nextUrl.searchParams.get('workDate'));
    const data = await getEmployeeDailyTargetsForDate(workDate);
    return NextResponse.json({
      workDate: data.workDate,
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
