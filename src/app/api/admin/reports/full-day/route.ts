import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getFullDayReport,
  resolveDefaultBusinessDate,
} from '@/lib/reports/full-day-report';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = '/admin/reports/full-day';

/**
 * GET /api/admin/reports/full-day?date=YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    let workDate = searchParams.get('date')?.trim() || '';
    if (!workDate) {
      workDate = await resolveDefaultBusinessDate();
    }
    if (!DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'date يجب أن يكون بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const report = await getFullDayReport(workDate);
    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/full-day] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
