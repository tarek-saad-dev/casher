import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { isActiveBranchContext, requireBranchOperationAccess } from '@/lib/branch/context';
import {
  LateDeductionActionError,
  setEmployeeLateDeductionExempt,
} from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ empId: string }> };

/** PUT — toggle LateDeductionExempt for an active branch employee */
export async function PUT(req: NextRequest, context: RouteContext) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;
  if (branch.branchId !== auth.activeBranchId) {
    return NextResponse.json({ ok: false, error: 'اختلاف الفرع التشغيلي' }, { status: 403 });
  }

  try {
    const { empId: empIdRaw } = await context.params;
    const empId = Number(empIdRaw);
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ ok: false, error: 'معرّف موظف غير صالح' }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.exempt !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: 'حقل exempt مطلوب (true/false)' },
        { status: 400 },
      );
    }

    const updated = await setEmployeeLateDeductionExempt({
      empId,
      exempt: body.exempt,
      tenantId: auth.tenantId,
      branchId: branch.branchId,
    });
    return NextResponse.json({ ok: true, employee: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof LateDeductionActionError ? 400 : 500;
    console.error('[late-deduction/employees/exempt] PUT', message);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
