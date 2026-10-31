import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getLateDeductionConfig,
  setLateDeductionEnabled,
} from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — global late deduction feature config */
export async function GET() {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const config = await getLateDeductionConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/config] GET', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** PUT — enable/disable automatic late deductions (admin/HR) */
export async function PUT(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const enabled = Boolean(body.enabled);
    const activatedOn =
      typeof body.activatedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.activatedOn)
        ? body.activatedOn
        : null;

    const config = await setLateDeductionEnabled({
      enabled,
      userId: auth.userId,
      activatedOn,
    });
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/config] PUT', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
