import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { validatePartnersReportMinimumPeriod } from '@/lib/reports/partnersReportPeriod';
import { buildPartnersMonthlyReport } from '@/lib/services/partnersReportService';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolveReportBranchScope,
  type ReportBranchRef,
} from '@/lib/branch';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { roundMoney } from '@/lib/reportMonthUtils';

const PARTNERS_REPORT_PATH = '/admin/reports/partners';

/**
 * Consolidate per-branch partner entitlements. Each branch's net is multiplied
 * by that branch's OWN effective shares before summing across branches — never
 * mix a partner % from one branch onto another branch's net.
 */
function consolidatePartnerEntitlements(
  perBranch: Array<{ branch: ReportBranchRef; report: PartnersMonthlyReportResponse }>,
) {
  const net = perBranch.reduce((s, b) => s + b.report.summary.operatingNet, 0);
  const entitlementByCode = new Map<string, { partnerCode: string; name: string; total: number }>();

  for (const { report } of perBranch) {
    const branchNet = report.summary.operatingNet;
    for (const partner of report.partners) {
      const existing = entitlementByCode.get(partner.partnerCode) ?? {
        partnerCode: partner.partnerCode,
        name: partner.name,
        total: 0,
      };
      existing.total = roundMoney(existing.total + branchNet * (partner.percentage / 100));
      entitlementByCode.set(partner.partnerCode, existing);
    }
  }

  return {
    operatingNet: roundMoney(net),
    entitlements: [...entitlementByCode.values()],
  };
}

/**
 * GET /api/admin/reports/partners?year=2026&month=6&branchId=&scope=all
 * Consolidated monthly partners financial report.
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

    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(url.searchParams);
    const scope = await resolveReportBranchScope({
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;

    if (scope.mode === 'single') {
      const report = await buildPartnersMonthlyReport(year, month, scope.branchId);
      return NextResponse.json({ ...report, scope: reportScopeMetadata(scope) });
    }

    const perBranch = await Promise.all(
      scope.branches.map(async (b) => ({
        branch: b,
        report: await buildPartnersMonthlyReport(year, month, b.branchId),
      })),
    );

    return NextResponse.json({
      scope: reportScopeMetadata(scope),
      branches: perBranch.map((b) => ({
        branchId: b.branch.branchId,
        branchCode: b.branch.branchCode,
        branchName: b.branch.branchName,
        shortName: b.branch.shortName,
        report: b.report,
      })),
      consolidated: consolidatePartnerEntitlements(perBranch),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
