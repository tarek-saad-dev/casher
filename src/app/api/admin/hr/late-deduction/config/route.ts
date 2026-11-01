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
    const config = await getLateDeductionConfig(auth.activeBranchId);
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
    const config = await setLateDeductionEnabled({
      enabled,
      branchId: auth.activeBranchId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/config] PUT', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
