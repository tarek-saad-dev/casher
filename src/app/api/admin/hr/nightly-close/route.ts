import { NextRequest, NextResponse } from 'next/server';
import { runNightlyClose } from '@/lib/hr/nightly-close.service';
import { resolveNightlyCloseWorkDate } from '@/lib/hr/nightly-close-work-date';
import { isSystemJobAuthResult, requireSystemJobAuth } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/admin/hr/nightly-close
 * Auth: Authorization: Bearer $CRON_SECRET  OR authenticated admin session
 * Body: { workDate?, dryRun?, skipWhatsApp? }
 *
 * Closes Cairo-yesterday by default (e.g. 01:00 on the 15th → workDate 14).
 */
export async function POST(req: NextRequest) {
  try {
    const jobAuth = await requireSystemJobAuth(req);
    if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

    const body = await req.json().catch(() => ({}));
    const workDate = resolveNightlyCloseWorkDate(body?.workDate);
    const dryRun = Boolean(body?.dryRun);
    const skipWhatsApp = Boolean(body?.skipWhatsApp);

    const result = await runNightlyClose({
      workDate,
      dryRun,
      skipWhatsApp,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/nightly-close] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const jobAuth = await requireSystemJobAuth(req);
    if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

    const { searchParams } = new URL(req.url);
    const workDate = resolveNightlyCloseWorkDate(searchParams.get('workDate'));

    const result = await runNightlyClose({
      workDate,
      dryRun: true,
      skipWhatsApp: false,
    });
    return NextResponse.json({ ...result, previewOnly: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
