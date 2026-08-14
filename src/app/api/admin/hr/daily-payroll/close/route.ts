import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { closeEmpBranchWorkDay } from '@/lib/hr/dailyPayrollClose.service';
import {
  empBranchWorkDayCloseErrorResponse,
  isEmpBranchWorkDayCloseError,
} from '@/lib/hr/empBranchWorkDayClose.http';

/**
 * POST /api/admin/hr/daily-payroll/close
 * Body: { branchId, workDate }
 * Re-validates readiness; CLOSED only when READY_TO_CLOSE.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const workDate = String(record.workDate ?? '').trim();
    const branchId = Number(record.branchId ?? sessionBranch.branchId);

    if (!workDate) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ error: 'معرف الفرع غير صالح' }, { status: 400 });
    }

    const access = await listUserValidBranchAccess(sessionBranch.userId);
    const allowed = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    allowed.add(sessionBranch.branchId);
    if (!allowed.has(branchId)) {
      return NextResponse.json({ error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
    }

    const result = await closeEmpBranchWorkDay({
      branchId,
      workDate,
      actorUserId: auth.userId,
    });

    return NextResponse.json({
      success: true,
      branchId,
      workDate,
      state: result.view.state,
      closedAt: result.view.row?.closedAt ?? null,
      closedByUserId: result.view.row?.closedByUserId ?? null,
      readiness: result.readiness,
    });
  } catch (error: unknown) {
    if (isEmpBranchWorkDayCloseError(error)) {
      return empBranchWorkDayCloseErrorResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/daily-payroll/close] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
