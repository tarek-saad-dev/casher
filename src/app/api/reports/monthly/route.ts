import { NextRequest, NextResponse } from 'next/server';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { getMonthlyFinancialSummary } from '@/lib/services/TreasurySummaryService';
import { getAllEmployeesRevenueTotal } from '@/lib/reports/employeeServicesRevenue';
import { isFinancialReportClassificationEnabled } from '@/lib/accounting/financialReportFlags';
import { maybeBuildClassificationPayload } from '@/lib/accounting/financialReportClassificationService';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolveReportBranchScope,
  getEffectiveBranchPartnerShares,
  toPartnerPercentageList,
  PartnerShareConfigError,
  type ReportBranchRef,
} from '@/lib/branch';

const PAGE = '/reports/monthly';

/**
 * Simplified Monthly Profit Report API
 *
 * Revenue Source: Employee Services Report (TblinvServDetail)
 * Net Profit Source: Treasury (TblCashMove)
 * Expenses: Calculated as Revenue - Net Profit
 *
 * Phase 1E: branch-scoped. `branchId`/`scope=all` are hidden query params —
 * no branch switcher UI is exposed. Default = caller's active branch.
 *
 * GET /api/reports/monthly?month=5&year=2026
 */

async function resolvePartnersForBranch(
  branchId: number,
  endDate: string,
): Promise<ReturnType<typeof toPartnerPercentageList>> {
  try {
    const shares = await getEffectiveBranchPartnerShares(branchId, endDate);
    return toPartnerPercentageList(shares);
  } catch (err) {
    if (err instanceof PartnerShareConfigError) {
      return [];
    }
    throw err;
  }
}

async function buildSingleBranchReport(year: number, month: number, branchId: number) {
  const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const lastDayOfMonth = new Date(year, month, 0);
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth.getDate()).padStart(2, '0')}`;

  const [revenue, treasuryData, partners] = await Promise.all([
    getAllEmployeesRevenueTotal(fromDate, endDateExclusive, branchId),
    getMonthlyFinancialSummary(year, month, branchId),
    resolvePartnersForBranch(branchId, endDate),
  ]);

  const netProfit = treasuryData.netAmount;
  const totalExpenses = revenue - netProfit;

  return {
    totalRevenue: revenue,
    totalExpenses,
    netProfit,
    totalInvoices: treasuryData.transactionsCount,
    partners,
    _meta: {
      revenueSource: 'EmployeeServices (TblinvServDetail)',
      netProfitSource: 'Treasury (TblCashMove)',
      expensesCalculation: 'Revenue - Net Profit',
      employeeServicesMatch: true,
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
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

    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(url.searchParams);
    const scope = await resolveReportBranchScope({
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;

    if (scope.mode === 'single') {
      const report = await buildSingleBranchReport(year, month, scope.branchId);

      if (!isFinancialReportClassificationEnabled()) {
        return NextResponse.json({ ...report, scope: reportScopeMetadata(scope) });
      }

      const classification = await maybeBuildClassificationPayload({
        year,
        month,
        salesRevenueOverride: report.totalRevenue,
        legacyTotals: {
          totalRevenue: report.totalRevenue,
          totalExpenses: report.totalExpenses,
          netProfit: report.netProfit,
        },
      });

      return NextResponse.json({
        ...report,
        ...classification,
        scope: reportScopeMetadata(scope),
      });
    }

    // mode === 'all': compute each branch independently, then consolidate totals only.
    const perBranch = await Promise.all(
      scope.branches.map(async (b: ReportBranchRef) => ({
        branch: b,
        report: await buildSingleBranchReport(year, month, b.branchId),
      })),
    );

    const consolidated = {
      totalRevenue: perBranch.reduce((s, b) => s + b.report.totalRevenue, 0),
      totalExpenses: perBranch.reduce((s, b) => s + b.report.totalExpenses, 0),
      netProfit: perBranch.reduce((s, b) => s + b.report.netProfit, 0),
      totalInvoices: perBranch.reduce((s, b) => s + b.report.totalInvoices, 0),
    };

    return NextResponse.json({
      scope: reportScopeMetadata(scope),
      branches: perBranch.map((b) => ({
        branchId: b.branch.branchId,
        branchCode: b.branch.branchCode,
        branchName: b.branch.branchName,
        shortName: b.branch.shortName,
        report: b.report,
      })),
      consolidated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/monthly] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
