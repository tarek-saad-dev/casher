import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { isActiveBranchContext, requireBranchOperationAccess } from '@/lib/branch/context';
import { listLateDeductionManagerQueue } from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — pending manager-review late deduction cases */
export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;
  if (branch.branchId !== auth.activeBranchId) {
    return NextResponse.json({ ok: false, error: 'اختلاف الفرع التشغيلي' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate') || undefined;
    const cases = await listLateDeductionManagerQueue({
      branchId: branch.branchId,
      tenantId: auth.tenantId,
      workDate: workDate && /^\d{4}-\d{2}-\d{2}$/.test(workDate) ? workDate : undefined,
    });
    return NextResponse.json({ ok: true, cases });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/cases] GET', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
