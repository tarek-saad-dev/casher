import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessPath } from '@/lib/permissions-server';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { buildPartnersMonthlyReport } from '@/lib/services/partnersReportService';

const PARTNERS_REPORT_PATH = '/admin/reports/partners';

/**
 * GET /api/admin/reports/partners?year=2026&month=6
 * Consolidated monthly partners financial report.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح — يرجى تسجيل الدخول' }, { status: 401 });
    }

    const allowed = await canAccessPath(
      session.UserID,
      session.UserName,
      session.UserLevel,
      PARTNERS_REPORT_PATH
    );
    if (!allowed) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية عرض هذا التقرير' }, { status: 403 });
    }

    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month')
    );

    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const report = await buildPartnersMonthlyReport(year, month);
    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
