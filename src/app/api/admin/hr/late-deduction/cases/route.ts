import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listLateDeductionManagerQueue } from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — pending manager-review late deduction cases */
export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const branchId = Number(searchParams.get('branchId'));
    const workDate = searchParams.get('workDate') || undefined;
    const cases = await listLateDeductionManagerQueue({
      branchId: branchId > 0 ? branchId : undefined,
      workDate: workDate && /^\d{4}-\d{2}-\d{2}$/.test(workDate) ? workDate : undefined,
    });
    return NextResponse.json({ ok: true, cases });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/cases] GET', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
