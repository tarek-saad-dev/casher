import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { evaluateDailyPayrollReadiness } from '@/lib/hr/dailyPayrollReadiness.service';

/**
 * GET /api/admin/hr/daily-payroll/readiness?branchId=&workDate=YYYY-MM-DD
 * Read-only readiness for one BranchID + WorkDate.
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
    const branchParam = searchParams.get('branchId');
    const branchId = branchParam ? Number(branchParam) : sessionBranch.branchId;

    if (!workDate) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ error: 'معرف الفرع غير صالح' }, { status: 400 });
    }

    const access = await listUserValidBranchAccess(sessionBranch.userId);
    const allowed = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    allowed.add(sessionBranch.branchId);
    if (!allowed.has(branchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
    }

    const result = await evaluateDailyPayrollReadiness({ branchId, workDate });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EmpBranchWorkDayCloseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/daily-payroll/readiness] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
