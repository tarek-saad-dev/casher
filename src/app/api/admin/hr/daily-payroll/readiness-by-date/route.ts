import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { evaluateDailyPayrollReadinessByDate } from '@/lib/hr/dailyPayrollReadiness.service';

/**
 * GET /api/admin/hr/daily-payroll/readiness-by-date?workDate=YYYY-MM-DD
 * Read-only readiness cards for all accessible smoke branches on one WorkDate.
 * Never mutates TblEmpBranchWorkDayClose.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const { searchParams } = new URL(request.url);
    const workDate = (searchParams.get('workDate') || '').trim();
    if (!workDate) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const access = await listUserValidBranchAccess(sessionBranch.userId);
    const accessibleIds = access
      .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
      .map((a) => a.branchId);
    if (!accessibleIds.includes(sessionBranch.branchId)) {
      accessibleIds.push(sessionBranch.branchId);
    }

    const result = await evaluateDailyPayrollReadinessByDate({
      workDate,
      branchIds: accessibleIds,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EmpBranchWorkDayCloseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/daily-payroll/readiness-by-date] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
