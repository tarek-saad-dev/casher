import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { isActiveBranchContext, requireBranchOperationAccess } from '@/lib/branch/context';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { listActiveEmployeesForLateDeduction } from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — active branch employees with schedules + late-deduction exempt flags */
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
    const rawDate = searchParams.get('workDate');
    const workDate =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getCairoBusinessDate();
    const employees = await listActiveEmployeesForLateDeduction({
      branchId: branch.branchId,
      tenantId: auth.tenantId,
      workDate,
    });
    return NextResponse.json({ ok: true, workDate, employees });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/employees] GET', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
