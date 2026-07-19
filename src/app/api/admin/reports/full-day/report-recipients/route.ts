import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { resolveOwnerReportRecipients } from '@/lib/hr/owner-daily-whatsapp-report.service';

const PAGE = '/admin/reports/full-day';

/**
 * GET /api/admin/reports/full-day/report-recipients
 * من الذي يستلم تقرير المالك اليومي ودوره في النظام (Job=مدير).
 */
export async function GET() {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const data = await resolveOwnerReportRecipients();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(
      '[api/admin/reports/full-day/report-recipients] GET error:',
      message,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
