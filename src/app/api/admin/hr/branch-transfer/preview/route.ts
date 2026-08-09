import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireTemporaryTransferAccess } from '@/lib/api-auth';
import { previewTemporaryBranchTransfer } from '@/lib/hr/temporaryBranchTransfer';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';
import {
  resolveDestinationBranchId,
  resolveTransferAccessFlags,
} from '@/lib/hr/branchTransferApiHelpers';

export const runtime = 'nodejs';

/**
 * POST /api/admin/hr/branch-transfer/preview
 */
export async function POST(req: NextRequest) {
  const auth = await requireTemporaryTransferAccess();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const workDate = String(body.workDate || '');
    const toBranchId = await resolveDestinationBranchId(body);

    if (!Number.isFinite(empId) || !toBranchId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ ok: false, error: 'معاملات ناقصة' }, { status: 400 });
    }

    const draft = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      relocateAttendance: body.relocateAttendance === true,
    });
    const flags = await resolveTransferAccessFlags(
      auth,
      draft.sourceBranch?.branchId ?? auth.activeBranchId,
      toBranchId,
    );
    const preview = await previewTemporaryBranchTransfer({
      empId,
      workDate,
      toBranchId,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      relocateAttendance: body.relocateAttendance === true,
      ...flags,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[admin/hr/branch-transfer/preview]', err);
    return NextResponse.json({ ok: false, error: 'فشل معاينة النقل' }, { status: 500 });
  }
}
