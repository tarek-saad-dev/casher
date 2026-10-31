import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { validatePartnersReportMinimumPeriod } from '@/lib/reports/partnersReportPeriod';
import { listStoreOtherBusinessIncomeForMonth } from '@/lib/services/storeIncomeService';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolvePartnersReportBranchScope,
} from '@/lib/branch';

const PARTNERS_REPORT_PATH = '/admin/reports/partners';

/**
 * GET /api/admin/reports/partners/store-income-details?year=&month=&branchId=
 * Profit-affecting «إيراد آخر للمحل» only (excludes non-revenue cash-in).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PARTNERS_REPORT_PATH);
    if (!isAuthResult(auth)) return auth;

    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month'),
    );
    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const minimumPeriodError = validatePartnersReportMinimumPeriod(year, month);
    if (minimumPeriodError) {
      return NextResponse.json({ error: minimumPeriodError }, { status: 400 });
    }

    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(url.searchParams);
    const scope = await resolvePartnersReportBranchScope(auth.roles, {
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;

    const branchIds = scope.mode === 'single' ? [scope.branchId] : scope.branchIds;
    const transactions = (
      await Promise.all(
        branchIds.map((branchId) => listStoreOtherBusinessIncomeForMonth(year, month, branchId)),
      )
    ).flat();

    return NextResponse.json({
      year,
      month,
      transactions,
      scope: reportScopeMetadata(scope),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners/store-income-details] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
