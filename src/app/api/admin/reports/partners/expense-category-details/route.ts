import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { validatePartnersReportMinimumPeriod } from '@/lib/reports/partnersReportPeriod';
import { getPartnersExpenseCategoryTransactions } from '@/lib/services/partnersExpenseCategoryDetailsService';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolveReportBranchScope,
} from '@/lib/branch';

const PARTNERS_REPORT_PATH = '/admin/reports/partners';

function parseCategoryId(value: string | null): number | null {
  if (value == null || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GET /api/admin/reports/partners/expense-category-details
 *   ?year=2026&month=6&categoryId=123&categoryName=بضاعة&branchId=&scope=all
 *
 * Phase 1E: branch-scoped. `branchId`/`scope=all` are hidden query params —
 * no branch switcher UI is exposed. Default = caller's active branch.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PARTNERS_REPORT_PATH);
    if (!isAuthResult(auth)) return auth;

    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month')
    );
    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const minimumPeriodError = validatePartnersReportMinimumPeriod(year, month);
    if (minimumPeriodError) {
      return NextResponse.json({ error: minimumPeriodError }, { status: 400 });
    }

    const categoryName = url.searchParams.get('categoryName')?.trim();
    if (!categoryName) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const categoryId = parseCategoryId(url.searchParams.get('categoryId'));

    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(url.searchParams);
    const scope = await resolveReportBranchScope({
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;

    const branchIds = scope.mode === 'single' ? [scope.branchId] : scope.branchIds;
    const transactionsByBranch = await Promise.all(
      branchIds.map((branchId) =>
        getPartnersExpenseCategoryTransactions(year, month, categoryId, categoryName, branchId),
      ),
    );
    const transactions = transactionsByBranch.flat();

    return NextResponse.json({
      year,
      month,
      categoryId,
      categoryName,
      transactions,
      scope: reportScopeMetadata(scope),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('مستبعدة') ? 400 : 500;
    console.error('[api/admin/reports/partners/expense-category-details] GET error:', message);
    return NextResponse.json({ error: message }, { status });
  }
}
