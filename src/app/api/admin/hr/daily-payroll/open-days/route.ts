import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { listDailyPayrollOpenDays } from '@/lib/hr/dailyPayrollReadiness.service';

/** Cairo calendar YYYY-MM-01 for "current month" scope. */
function cairoMonthStartYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}-01`;
}

/**
 * GET /api/admin/hr/daily-payroll/open-days
 * Query:
 *   - scope=current-month (default for UI) → from 1st of Cairo month
 *   - fromWorkDate=YYYY-MM-DD [& toWorkDate=]
 *   - lookbackDays=N (legacy)
 * Unresolved BranchID+WorkDate across GLEEM + CAMP_CAESAR (CLOSED excluded).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(request.url);
    const scope = (searchParams.get('scope') || '').trim().toLowerCase();
    const fromParam = (searchParams.get('fromWorkDate') || '').trim();
    const toParam = (searchParams.get('toWorkDate') || '').trim();
    const lookbackRaw = searchParams.get('lookbackDays');
    const lookbackDays = lookbackRaw ? Number(lookbackRaw) : undefined;

    const access = await listUserValidBranchAccess(branch.userId);
    const accessibleIds = access
      .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
      .map((a) => a.branchId);
    if (!accessibleIds.includes(branch.branchId)) {
      accessibleIds.push(branch.branchId);
    }

    let fromWorkDate: string | undefined;
    let toWorkDate: string | undefined;
    let lookback: number | undefined;

    if (fromParam) {
      fromWorkDate = fromParam;
      toWorkDate = toParam || undefined;
    } else if (scope === 'current-month' || (!lookbackRaw && scope !== 'lookback')) {
      // Default: current Cairo calendar month (UI "أيام تحتاج إقفال")
      fromWorkDate = cairoMonthStartYmd();
    } else if (Number.isFinite(lookbackDays)) {
      lookback = lookbackDays;
    } else {
      fromWorkDate = cairoMonthStartYmd();
    }

    const result = await listDailyPayrollOpenDays({
      fromWorkDate,
      toWorkDate,
      lookbackDays: lookback,
      branchIds: accessibleIds,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EmpBranchWorkDayCloseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/daily-payroll/open-days] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
