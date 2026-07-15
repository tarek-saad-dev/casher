import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { runNightlyClose } from '@/lib/hr/nightly-close.service';
import { resolveNightlyCloseWorkDate } from '@/lib/hr/nightly-close-work-date';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorizeCronOrSession(
  req: NextRequest,
  session: Awaited<ReturnType<typeof getSession>>,
): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (secret && token === secret) return true;
  if (!secret && token === 'dev') return true;
  if (session) return true;
  return false;
}

/**
 * POST /api/admin/hr/nightly-close
 * Auth: Authorization: Bearer $CRON_SECRET  OR logged-in session
 * Body: { workDate?, dryRun?, skipWhatsApp? }
 *
 * Closes Cairo-yesterday by default (e.g. 01:00 on the 15th → workDate 14).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!authorizeCronOrSession(req, session)) {
      return NextResponse.json(
        { error: 'Unauthorized — Bearer CRON_SECRET or login required' },
        { status: 401 },
      );
    }

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
    const session = await getSession();
    if (!authorizeCronOrSession(req, session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
