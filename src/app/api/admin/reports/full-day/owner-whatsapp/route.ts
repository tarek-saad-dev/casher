import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  previewOwnerDailyWhatsApp,
  sendOwnerDailyWhatsApp,
} from '@/lib/hr/owner-daily-whatsapp-report.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = '/admin/reports/full-day';

/**
 * GET /api/admin/reports/full-day/owner-whatsapp?date=YYYY-MM-DD
 * Preview owner daily WhatsApp message.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const date = new URL(req.url).searchParams.get('date')?.trim() || '';
    if (!DATE_RE.test(date)) {
      return NextResponse.json(
        { error: 'date يجب أن يكون بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const preview = await previewOwnerDailyWhatsApp(date);
    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/full-day/owner-whatsapp] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/reports/full-day/owner-whatsapp
 * Body: { date: YYYY-MM-DD, dryRun?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const body = (await req.json()) as { date?: string; dryRun?: boolean };
    const date = String(body.date ?? '').trim();
    if (!DATE_RE.test(date)) {
      return NextResponse.json(
        { error: 'date يجب أن يكون بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const result = await sendOwnerDailyWhatsApp({
      workDate: date,
      dryRun: Boolean(body.dryRun),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/full-day/owner-whatsapp] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
