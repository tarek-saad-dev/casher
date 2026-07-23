import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolveReportBranchScope,
} from '@/lib/branch';
import {
  getFullDayReport,
  resolveDefaultBusinessDate,
} from '@/lib/reports/full-day-report';
import type { FullDayReport } from '@/lib/reports/full-day-report.types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = '/admin/reports/full-day';

function sumNumeric(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + (v || 0), 0) * 100) / 100;
}

function consolidateFullDayReports(reports: FullDayReport[]) {
  return {
    sales: { total: sumNumeric(reports.map((r) => r.sales.total)) },
    incomes: { total: sumNumeric(reports.map((r) => r.incomes.total)) },
    expenses: { total: sumNumeric(reports.map((r) => r.expenses.total)) },
    payroll: {
      wageTotal: sumNumeric(reports.map((r) => r.payroll.wageTotal)),
      targetTotal: sumNumeric(reports.map((r) => r.payroll.targetTotal)),
      staffCostTotal: sumNumeric(reports.map((r) => r.payroll.staffCostTotal)),
    },
    profit: {
      totalIn: sumNumeric(reports.map((r) => r.profit.totalIn)),
      totalOut: sumNumeric(reports.map((r) => r.profit.totalOut)),
      net: sumNumeric(reports.map((r) => r.profit.net)),
    },
    treasury: {
      inflows: { total: sumNumeric(reports.map((r) => r.treasury.inflows.total)) },
      outflows: { total: sumNumeric(reports.map((r) => r.treasury.outflows.total)) },
      net: sumNumeric(reports.map((r) => r.treasury.net)),
    },
  };
}

/**
 * GET /api/admin/reports/full-day?date=YYYY-MM-DD&branchId=&scope=all
 *
 * Phase 1E: branch-scoped. `branchId`/`scope=all` are hidden query params —
 * no branch switcher UI is exposed. Default = caller's active branch.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(searchParams);

    const scope = await resolveReportBranchScope({
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;

    let workDate = searchParams.get('date')?.trim() || '';

    if (scope.mode === 'single') {
      if (!workDate) {
        workDate = await resolveDefaultBusinessDate(scope.branchId);
      }
      if (!DATE_RE.test(workDate)) {
        return NextResponse.json(
          { error: 'date يجب أن يكون بصيغة YYYY-MM-DD' },
          { status: 400 },
        );
      }
      const report = await getFullDayReport(workDate, scope.branchId);
      return NextResponse.json({ ...report, scope: reportScopeMetadata(scope) });
    }

    // mode === 'all': compute each branch independently, then consolidate totals only.
    if (!workDate) {
      workDate = await resolveDefaultBusinessDate(scope.branchIds[0]);
    }
    if (!DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'date يجب أن يكون بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const branches = await Promise.all(
      scope.branches.map(async (b) => ({
        branch: b,
        report: await getFullDayReport(workDate, b.branchId),
      })),
    );

    return NextResponse.json({
      scope: reportScopeMetadata(scope),
      report: {
        workDate,
        branches: branches.map((b) => ({
          branchId: b.branch.branchId,
          branchCode: b.branch.branchCode,
          branchName: b.branch.branchName,
          shortName: b.branch.shortName,
          report: b.report,
        })),
        consolidated: consolidateFullDayReports(branches.map((b) => b.report)),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/full-day] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
